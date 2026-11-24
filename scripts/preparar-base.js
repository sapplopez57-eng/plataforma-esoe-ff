'use strict';

const { Client } = require('pg');
const { tlsDeBaseDeDatos } = require('../src/config');
const { migrar } = require('../src/migraciones');

async function prepararPermisos(cliente, clave, rol = 'esoe_app') {
  if (!/^[a-z][a-z0-9_]{1,62}$/.test(rol) || !/^[A-Za-z0-9_-]{24,128}$/.test(clave || '')) {
    throw new Error('El rol y la clave de aplicacion deben cumplir los requisitos de configuracion.');
  }
  await cliente.query('BEGIN');
  try {
    await cliente.query("SELECT pg_advisory_xact_lock(hashtext('esoe:permisos'))");
    const { rows: existentes } = await cliente.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [rol]);
    const instruccion = existentes.length ? 'ALTER ROLE' : 'CREATE ROLE';
    const { rows: creacion } = await cliente.query(
      `SELECT format($1::text, $2::text, $3::text) AS sql`,
      [`${instruccion} %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L`, rol, clave]);
    await cliente.query(creacion[0].sql);
    for (const sentencia of [
      'GRANT CONNECT ON DATABASE %I TO %I',
      'REVOKE CREATE ON SCHEMA public FROM PUBLIC',
      'GRANT USAGE ON SCHEMA public TO %I',
      'GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO %I',
      'GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO %I',
      'REVOKE ALL ON migraciones_aplicadas FROM %I',
      'REVOKE UPDATE,DELETE ON auditoria FROM %I'
    ]) {
      const { rows } = sentencia.includes('ON DATABASE')
        ? await cliente.query('SELECT format($1::text,current_database(),$2::text) AS sql', [sentencia, rol])
        : await cliente.query('SELECT format($1::text,$2::text) AS sql', [sentencia, rol]);
      await cliente.query(rows[0].sql);
    }
    await cliente.query('COMMIT');
  } catch (error) {
    await cliente.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function principal() {
  if (!process.env.DATABASE_URL || !process.env.APP_DB_PASSWORD) throw new Error('Falta configuracion de base de datos.');
  if (!/^[A-Za-z0-9_-]{24,128}$/.test(process.env.APP_DB_PASSWORD)) throw new Error('Clave de aplicacion invalida.');
  if (decodeURIComponent(new URL(process.env.DATABASE_URL).password) === process.env.APP_DB_PASSWORD) {
    throw new Error('La clave de aplicacion debe ser distinta de la administrativa.');
  }
  const cliente = new Client({ connectionString: process.env.DATABASE_URL, ssl: tlsDeBaseDeDatos(process.env).ssl, connectionTimeoutMillis: 5000 });
  await cliente.connect();
  try {
    await migrar({ cliente });
    await prepararPermisos(cliente, process.env.APP_DB_PASSWORD);
    console.log('Esquema actualizado y permisos de aplicacion preparados.');
  } finally { await cliente.end(); }
}

if (require.main === module) {
  principal().catch(() => {
    console.error('No se pudo preparar la base. Revise la conexion administrativa y APP_DB_PASSWORD. No se iniciaran nuevas instancias hasta completar este paso.');
    process.exitCode = 1;
  });
}

module.exports = { prepararPermisos };
