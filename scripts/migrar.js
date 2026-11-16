'use strict';

// npm run migrar — lleva la base de DATABASE_URL a la ultima version del esquema.
// Se puede ejecutar cuantas veces se quiera: lo ya aplicado no se repite.
// En Docker lo ejecuta el contenedor antes de arrancar el servidor.

const { Client } = require('pg');
const { migrar, ErrorDeMigracion } = require('../src/migraciones');

async function principal() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('[ESOE-SMS] Falta DATABASE_URL: no hay base que migrar.');
    process.exitCode = 1;
    return;
  }

  const cliente = new Client({ connectionString: url });
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

principal().catch((error) => {
  // Los errores de migracion ya traen un mensaje para personas; los demas
  // (sin conexion, credenciales) se muestran sin la traza completa.
  const mensaje = error instanceof ErrorDeMigracion ? error.message : `No se pudo migrar: ${error.message}`;
  console.error(`[ESOE-SMS] ${mensaje}`);
  process.exitCode = 1;
});
