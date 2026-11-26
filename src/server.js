'use strict';

const http = require('node:http');

const { cargarConfig } = require('./config');
const { crearApp } = require('./app');
const { crearBaseDeDatos } = require('./db');
const { crearRegistro } = require('./registro');
const { atenderErroresDeCliente } = require('./errores-de-cliente');

const MARGEN_DE_DRENAJE_MS = 30000;

let config;
try {
  config = cargarConfig();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    t: new Date().toISOString(), nivel: 'error', servicio: 'ESOE-SMS',
    mensaje: 'configuracion invalida', detalle: error.message
  })}\n`);
  process.exit(1);
}

const registro = crearRegistro({
  entorno: config.entorno,
  version: config.version,
  nivel: config.registro.nivel
});

const db = crearBaseDeDatos(config.databaseUrl, config.baseDeDatos, { registro });

const app = crearApp(config, { db, registro });

const servidor = http.createServer({
  keepAliveTimeout: config.tiemposHttp.keepAliveMs,
  headersTimeout: config.tiemposHttp.cabecerasMs,
  requestTimeout: config.tiemposHttp.peticionMs,
  connectionsCheckingInterval: config.tiemposHttp.revisionMs
}, app);
atenderErroresDeCliente(servidor, registro);

servidor.listen(config.puerto, config.host, () => {
  registro.info('servidor activo', {
    host: config.host,
    puerto: servidor.address().port,
    baseDeDatos: db ? config.tlsBaseDeDatos : 'SIN_CONFIGURAR',
    tiemposHttp: config.tiemposHttp
  });
});

let apagando = false;
function apagar(senal, codigo = 0) {
  if (apagando) return;
  apagando = true;
  app.locals.aceptaTrafico = false;
  registro.info('apagado solicitado', { senal });
  servidor.close(async () => {
    if (db) await db.cerrar().catch(() => {});
    registro.info('apagado completo', { senal, codigo });
    process.exit(codigo);
  });
  setTimeout(() => {
    registro.error('apagado forzado: el drenaje no termino a tiempo', { senal, margenMs: MARGEN_DE_DRENAJE_MS });
    process.exit(codigo || 1);
  }, MARGEN_DE_DRENAJE_MS).unref();
}

process.on('SIGTERM', () => apagar('SIGTERM'));
process.on('SIGINT', () => apagar('SIGINT'));

process.on('unhandledRejection', (razon) => {
  registro.error('promesa rechazada sin manejador: se inicia el apagado', {
    fallo: razon instanceof Error ? razon : new Error(String(razon))
  });
  apagar('unhandledRejection', 1);
});

process.on('uncaughtException', (error) => {
  registro.error('excepcion no capturada: se inicia el apagado', { fallo: error });
  apagar('uncaughtException', 1);
});
