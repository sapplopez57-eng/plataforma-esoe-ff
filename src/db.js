'use strict';

const { Pool } = require('pg');

function crearBaseDeDatos(databaseUrl, opciones = {}, entorno = {}) {
  if (!databaseUrl) return null;
  const registro = entorno.registro || null;
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 10,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 30000,
    statement_timeout: 10000,
    ...opciones
  });
  pool.on('error', (error) => {
    if (registro) return registro.error('fallo en la conexion a la base de datos', { fallo: error });
    process.stderr.write(`${JSON.stringify({ nivel: 'error', mensaje: 'fallo en la conexion a la base de datos', detalle: error.message })}\n`);
  });
  let cierre;
  return {
    consultar: (texto, parametros) => pool.query(texto, parametros),
    estado: () => ({ conexiones: pool.totalCount, libres: pool.idleCount, enEspera: pool.waitingCount }),
    transaccion: async (trabajo) => {
      const cliente = await pool.connect();
      try {
        await cliente.query('BEGIN');
        const resultado = await trabajo((texto, parametros) => cliente.query(texto, parametros));
        await cliente.query('COMMIT');
        return resultado;
      } catch (error) {
        await cliente.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        cliente.release();
      }
    },
    cerrar: () => { cierre ||= pool.end(); return cierre; }
  };
}

module.exports = { crearBaseDeDatos };
