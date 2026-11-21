'use strict';

const path = require('node:path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { crearAutenticacion } = require('./auth');
const { crearPermisos } = require('./permisos');
const { crearRutasDeIntegraciones } = require('./integraciones/rutas');
const { crearRutasAcademicas } = require('./academico/rutas');
const { crearRutasEstructura } = require('./academico/estructura');
const { crearRutasExpedientes } = require('./academico/expedientes');
const { crearRutasDeClases } = require('./academico/clases');
const { crearRutasInstituciones } = require('./academico/instituciones');

const DIRECTORIO_PUBLICO = path.join(__dirname, '..', 'public');

function politicaDeContenido(config) {
  const clerk = config.clerk.habilitado ? [`https://${config.clerk.dominio}`] : [];
  const desafio = config.clerk.habilitado ? ['https://challenges.cloudflare.com'] : [];
  return {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'", ...clerk, ...desafio],
      'script-src-attr': ["'none'"],
      'style-src': ["'self'", "'unsafe-inline'"],
      'font-src': ["'self'"],
      'img-src': ["'self'", 'data:', ...(config.clerk.habilitado ? ['https://img.clerk.com'] : [])],
      'connect-src': ["'self'", ...clerk],
      'worker-src': ["'self'", 'blob:'],
      'frame-src': ["'self'", ...desafio],
      'object-src': ["'none'"],
      'frame-ancestors': ["'none'"],
      'base-uri': ["'self'"],
      'form-action': ["'self'"]
    }
  };
}

function crearApp(config, dependencias = {}) {
  const app = express();
  const auth = dependencias.auth || crearAutenticacion(config);
  const db = dependencias.db || null;

  app.disable('x-powered-by');
  if (config.proxiesDeConfianza > 0) app.set('trust proxy', config.proxiesDeConfianza);

  app.use(helmet({
    contentSecurityPolicy: politicaDeContenido(config),
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginEmbedderPolicy: false
  }));

  if (config.origenesPermitidos.length > 0) {
    app.use('/api', cors({ origin: config.origenesPermitidos, credentials: true }));
  }

  app.use('/api', rateLimit({
    windowMs: config.limitePeticiones.ventanaMs,
    limit: config.limitePeticiones.maximo,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Demasiadas peticiones. Intente de nuevo mas tarde.' }
  }));

  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const cuerpo = { status: 'OK', service: 'ESOE-SMS-Platform', timestamp: new Date().toISOString() };
    if (!db) return res.json({ ...cuerpo, baseDeDatos: 'SIN_CONFIGURAR' });
    let espera;
    try {
      await Promise.race([
        db.consultar('SELECT 1'),
        new Promise((_, rechazar) => { espera = setTimeout(() => rechazar(new Error('tiempo agotado')), 3000); })
      ]);
      res.json({ ...cuerpo, baseDeDatos: 'OK' });
    } catch {
      res.status(503).json({ ...cuerpo, status: 'DEGRADADO', baseDeDatos: 'SIN_CONEXION' });
    } finally {
      clearTimeout(espera);
    }
  });

  app.get('/api/config', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({
      autenticacion: auth.habilitada
        ? { proveedor: 'clerk', llavePublica: config.clerk.llavePublica, dominio: config.clerk.dominio }
        : null,
      integraciones: Boolean(db && config.integraciones.claveCifrado)
    });
  });

  app.use('/api', auth.middleware);

  app.get('/api/sesion', auth.exigirSesion, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ usuarioId: req.identidad.usuarioId, rol: req.identidad.rol });
  });

  app.use('/api/integraciones', crearRutasDeIntegraciones({ config, auth, db }));

  const permisos = db ? crearPermisos(db) : null;
  app.use('/api', crearRutasAcademicas({ auth, db, permisos }));
  app.use('/api', crearRutasEstructura({ auth, db, permisos }));
  app.use('/api', crearRutasExpedientes({ auth, db, permisos }));
  app.use('/api', crearRutasDeClases({ auth, db, permisos }));
  app.use('/api', crearRutasInstituciones({ auth, db, permisos }));

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Recurso no encontrado.' });
  });

  app.use(express.static(DIRECTORIO_PUBLICO, {
    dotfiles: 'ignore',
    index: 'index.html',
    maxAge: config.esProduccion ? '1h' : 0
  }));

  app.use((req, res) => {
    res.status(404).type('text/plain').send('No encontrado');
  });

  app.use((err, req, res, _next) => {
    const estado = err.status && err.status >= 400 && err.status < 500 ? err.status : 500;
    if (estado === 500) console.error('[ESOE-SMS] Error no controlado:', err.message);
    const cuerpo = { error: estado === 500 ? 'Error interno del servidor.' : 'Solicitud invalida.' };
    if (req.path.startsWith('/api')) return res.status(estado).json(cuerpo);
    res.status(estado).type('text/plain').send(cuerpo.error);
  });

  return app;
}

module.exports = { crearApp };
