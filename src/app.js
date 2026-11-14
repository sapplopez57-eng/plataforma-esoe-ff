'use strict';

const path = require('node:path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');

const DIRECTORIO_PUBLICO = path.join(__dirname, '..', 'public');

function politicaDeContenido() {
  return {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'"],
      // Deuda registrada (BACKLOG SEC-04): la interfaz aun usa manejadores en linea.
      'script-src-attr': ["'unsafe-inline'"],
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'https://fonts.gstatic.com'],
      'img-src': ["'self'", 'data:'],
      'connect-src': ["'self'"],
      'object-src': ["'none'"],
      'frame-ancestors': ["'none'"],
      'base-uri': ["'self'"],
      'form-action': ["'self'"]
    }
  };
}

function crearApp(config) {
  const app = express();

  app.disable('x-powered-by');
  if (config.proxiesDeConfianza > 0) app.set('trust proxy', config.proxiesDeConfianza);

  app.use(helmet({
    contentSecurityPolicy: politicaDeContenido(),
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginEmbedderPolicy: false
  }));

  // Sin lista de origenes la API solo se consume desde el mismo origen.
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

  app.get('/api/health', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ status: 'OK', service: 'ESOE-SMS-Platform', timestamp: new Date().toISOString() });
  });

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

  // Express identifica el manejador de errores por sus cuatro parametros.
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
