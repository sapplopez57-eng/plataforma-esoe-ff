'use strict';

const path = require('node:path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { getAuth } = require('@clerk/express');
const { AlmacenLimitesPostgres } = require('./limites');
const { crearRegistro, registroDePeticiones } = require('./registro');
const { crearAutenticacion } = require('./auth');
const { crearPermisos } = require('./permisos');
const { crearRutasDeIntegraciones } = require('./integraciones/rutas');
const { crearRutasAcademicas } = require('./academico/rutas');
const { crearRutasEstructura } = require('./academico/estructura');
const { crearRutasExpedientes } = require('./academico/expedientes');
const { crearRutasDeClases } = require('./academico/clases');
const { crearRutasInstituciones } = require('./academico/instituciones');
const { crearRutasDeBorrado } = require('./academico/borrado');
const { crearRutasLms } = require('./lms/rutas');
const { crearRutasDeVoz } = require('./voz/rutas');

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
  const registro = dependencias.registro || crearRegistro({
    entorno: config.entorno,
    version: config.version,
    nivel: config.registro.nivel
  });
  const auth = dependencias.auth || crearAutenticacion(config);
  const db = dependencias.db || null;
  const crearAlmacenLimites = (prefijo) => config.limitePeticiones.almacen === 'postgres'
    ? new AlmacenLimitesPostgres(db, prefijo) : undefined;
  app.locals.aceptaTrafico = true;
  app.locals.registro = registro;

  app.disable('x-powered-by');
  if (config.proxiesDeConfianza > 0) app.set('trust proxy', config.proxiesDeConfianza);

  app.use(registroDePeticiones(registro));

  app.use(helmet({
    contentSecurityPolicy: politicaDeContenido(config),
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginEmbedderPolicy: false
  }));

  if (config.origenesPermitidos.length > 0) {
    app.use('/api', cors({ origin: config.origenesPermitidos, credentials: true }));
  }

  const usuarioParaLimite = Symbol('usuarioParaLimite');
  const limitarApi = rateLimit({
    store: crearAlmacenLimites('api'),
    windowMs: config.limitePeticiones.ventanaMs,
    limit: (req) => req[usuarioParaLimite]
      ? config.limitePeticiones.maximo : config.limitePeticiones.maximoPublico,
    keyGenerator: (req) => req[usuarioParaLimite]
      ? `usuario:${req[usuarioParaLimite]}` : `ip:${ipKeyGenerator(req.ip)}`,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Demasiadas peticiones. Intente de nuevo mas tarde.' }
  });

  app.get('/api/live', (req, res) => {
    res.set('Cache-Control', 'no-store').json({ status: 'OK' });
  });

  app.get('/api/ready', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!db || !app.locals.aceptaTrafico) return res.status(503).json({ status: 'NO_DISPONIBLE' });
    let reloj;
    try {
      const comprobar = async () => {
        const { rows } = await db.consultar("SELECT NOT pg_is_in_recovery() AND current_setting('transaction_read_only')='off' AS disponible");
        if (rows[0].disponible !== true) throw new Error('Base no disponible para escritura.');
        if (config.limitePeticiones.almacen === 'postgres') await db.consultar('SELECT 1 FROM limites_peticion LIMIT 0');
      };
      await Promise.race([comprobar(), new Promise((_, rechazar) => {
        reloj = setTimeout(() => rechazar(new Error('Tiempo de comprobacion agotado.')), 3000);
      })]);
      res.json({ status: 'OK' });
    } catch {
      res.status(503).json({ status: 'NO_DISPONIBLE' });
    } finally { clearTimeout(reloj); }
  });

  app.get('/api/health', limitarApi, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const cuerpo = { status: 'OK', service: 'ESOE-SMS-Platform', timestamp: new Date().toISOString(), ...(config.version ? { version: config.version } : {}) };
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

  app.get('/api/config', limitarApi, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({
      autenticacion: auth.habilitada
        ? { proveedor: 'clerk', llavePublica: config.clerk.llavePublica, dominio: config.clerk.dominio }
        : null,
      integraciones: Boolean(db && config.integraciones.claveCifrado)
    });
  });

  app.use('/api/voz', limitarApi, express.json({ limit: '100kb' }), crearRutasDeVoz({ config, db, crearAlmacenLimites }));

  app.use('/api', (req, res, next) => {
    auth.middleware(req, res, (error) => {
      if (!error && config.clerk.habilitado && /^Bearer \S+$/.test(req.get('authorization') || '')) {
        try {
          const sesion = getAuth(req);
          if (sesion.isAuthenticated && sesion.userId) req[usuarioParaLimite] = sesion.userId;
        } catch {}
      }
      limitarApi(req, res, (errorDeLimite) => next(error || errorDeLimite));
    });
  });
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/sesion', auth.exigirSesion, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ usuarioId: req.identidad.usuarioId, rol: req.identidad.rol });
  });

  const permisos = db ? crearPermisos(db) : null;
  app.use('/api/integraciones', crearRutasDeIntegraciones({ config, auth, db, permisos, crearAlmacenLimites, correoVerificado: dependencias.correoVerificado }));

  app.use('/api', crearRutasAcademicas({ auth, db, permisos }));
  app.use('/api', crearRutasEstructura({ auth, db, permisos }));
  app.use('/api', crearRutasExpedientes({ auth, db, permisos }));
  app.use('/api', crearRutasDeClases({ auth, db, permisos }));
  app.use('/api', crearRutasInstituciones({ auth, db, permisos }));
  app.use('/api', crearRutasDeBorrado({ auth, db, permisos }));
  app.use('/api', crearRutasLms({ auth, db, permisos }));

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
    const estado = err.status === 503 ? 503 : err.status && err.status >= 400 && err.status < 500 ? err.status : 500;
    if (estado === 500) (req.registro || registro).error('error no controlado', { fallo: err });
    if (estado === 503) res.set('Retry-After', '5');
    const cuerpo = { error: estado === 503 ? 'Servicio temporalmente no disponible.' : estado === 500 ? 'Error interno del servidor.' : 'Solicitud invalida.' };
    if (req.path.startsWith('/api')) return res.status(estado).json(cuerpo);
    res.status(estado).type('text/plain').send(cuerpo.error);
  });

  return app;
}

module.exports = { crearApp };
