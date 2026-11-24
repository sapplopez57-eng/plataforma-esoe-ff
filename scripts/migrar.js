'use strict';

const { Client } = require('pg');
const { migrar, ErrorDeMigracion } = require('../src/migraciones');
const { tlsDeBaseDeDatos } = require('../src/config');

async function principal() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('[ESOE-SMS] Falta DATABASE_URL: no hay base que migrar.');
    process.exitCode = 1;
    return;
  }

  const { modo, ssl } = tlsDeBaseDeDatos(process.env);
  console.log(`[ESOE-SMS] Conexion TLS en modo ${modo}.`);
  const cliente = new Client({ connectionString: url, ssl });
  await cliente.connect();
  try {
    const resultado = await migrar({ cliente, registrar: (m) => console.log(`[ESOE-SMS] ${m}`) });
    const nuevas = resultado.aplicadas.length;
    console.log(`[ESOE-SMS] Esquema en la version ${resultado.version}: `
      + (nuevas ? `${nuevas} migracion(es) aplicada(s).` : 'nada que aplicar.'));
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
    console.error(`[ESOE-SMS] ${mensajeDeFallo(error)}`);
    process.exitCode = 1;
  });
}

module.exports = { mensajeDeFallo };
