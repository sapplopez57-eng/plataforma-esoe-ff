'use strict';

const { Client } = require('pg');
const { migrar, ErrorDeMigracion } = require('../src/migraciones');
const { tlsDeBaseDeDatos } = require('../src/config');
const { crearRegistro } = require('../src/registro');
const { conReintentos } = require('../src/seguridad/red');

const CODIGOS_DE_ARRANQUE = new Set([
  'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET', '57P03', '53300'
]);
const INTENTOS_DE_CONEXION = 6;
const ESPERA_BASE_MS = 500;
const ESPERA_MAXIMA_MS = 8000;

const registro = crearRegistro({
  entorno: process.env.NODE_ENV || 'development',
  nivel: (process.env.LOG_NIVEL || 'info').trim().toLowerCase()
}).hijo({ proceso: 'migrar' });

function esFalloDeArranque(error) {
  const codigos = [error && error.code, ...((error && error.errors) || []).map((e) => e && e.code)];
  return codigos.some((codigo) => CODIGOS_DE_ARRANQUE.has(String(codigo)));
}

function conectarConEspera(crearCliente) {
  return conReintentos(async () => {
    const cliente = crearCliente();
    try {
      await cliente.connect();
      return cliente;
    } catch (error) {
      await cliente.end().catch(() => {});
      throw error;
    }
  }, {
    intentos: INTENTOS_DE_CONEXION,
    baseMs: ESPERA_BASE_MS,
    maximoMs: ESPERA_MAXIMA_MS,
    transitorio: esFalloDeArranque,
    anotar: (detalle) => registro.aviso('la base aun no acepta conexiones, reintentando', detalle)
  });
}

async function principal() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    registro.error('falta DATABASE_URL: no hay base que migrar');
    process.exitCode = 1;
    return;
  }

  const { modo, ssl } = tlsDeBaseDeDatos(process.env);
  registro.info('conexion a la base de datos', { tls: modo });
  const cliente = await conectarConEspera(() => new Client({ connectionString: url, ssl }));
  try {
    const resultado = await migrar({ cliente, registrar: (m) => registro.info(m) });
    registro.info('esquema al dia', {
      version: resultado.version,
      aplicadas: resultado.aplicadas,
      yaEstaban: resultado.yaEstaban,
      adoptada: resultado.adoptada
    });
  } finally {
    await cliente.end();
  }
}

function mensajeDeFallo(error) {
  if (error instanceof ErrorDeMigracion) return error.message;
  const internos = (error && error.errors) || [];
  const detalle = (error && error.message)
    || [error && error.code, ...internos.map((e) => e.code || e.message)].filter(Boolean).join(', ')
    || String(error);
  return `No se pudo migrar: ${detalle}`;
}

if (require.main === module) {
  principal().catch((error) => {
    registro.error(mensajeDeFallo(error), { fallo: error });
    process.exitCode = 1;
  });
}

module.exports = { mensajeDeFallo, esFalloDeArranque, conectarConEspera };
