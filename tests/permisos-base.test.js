'use strict';

const crypto = require('node:crypto');
const { Client } = require('pg');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { crearBaseDePrueba, URL_ADMIN } = require('./ayuda');
const { prepararPermisos } = require('../scripts/preparar-base');
const { AlmacenLimitesPostgres } = require('../src/limites');

test('operacion: la aplicacion opera con permisos limitados y no puede alterar el esquema ni la auditoria', URL_ADMIN ? false : { skip: 'Sin PRUEBAS_DATABASE_URL' }, async () => {
  const base = await crearBaseDePrueba();
  const rol = `app_${crypto.randomBytes(6).toString('hex')}`;
  const clave = crypto.randomBytes(24).toString('hex');
  const { rows } = await base.db.consultar('SELECT current_database() AS nombre');
  const url = new URL(URL_ADMIN);
  url.pathname = `/${rows[0].nombre}`;
  const propietario = new Client({ connectionString: url.toString() });
  let aplicacion;
  await propietario.connect();
  try {
    await prepararPermisos(propietario, clave, rol);
    await prepararPermisos(propietario, clave, rol);
    url.username = rol;
    url.password = clave;
    aplicacion = new Client({ connectionString: url.toString() });
    await aplicacion.connect();
    assert.equal((await aplicacion.query('SELECT current_user AS usuario')).rows[0].usuario, rol);
    assert.equal((await aplicacion.query('SELECT rolsuper,rolcreatedb,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0].rolsuper, false);
    assert.ok((await aplicacion.query('SELECT id FROM instituciones')).rows.length > 0);
    await assert.rejects(aplicacion.query('CREATE TABLE fuera_del_alcance (id integer)'), { code: '42501' });
    await assert.rejects(aplicacion.query('SELECT * FROM pg_authid'), { code: '42501' });
    const version = await aplicacion.query('SELECT MAX(version) AS version FROM migraciones_aplicadas');
    assert.ok(Number(version.rows[0].version) > 0, 'la aplicacion debe poder leer la version del esquema');
    await assert.rejects(aplicacion.query(
      "INSERT INTO migraciones_aplicadas (version, nombre, huella) VALUES (999, 'falsa', repeat('0', 64))"), { code: '42501' });
    await assert.rejects(aplicacion.query('UPDATE migraciones_aplicadas SET nombre = $1', ['alterada']), { code: '42501' });
    await assert.rejects(aplicacion.query('DELETE FROM migraciones_aplicadas'), { code: '42501' });
    await assert.rejects(aplicacion.query('DELETE FROM auditoria'), { code: '42501' });
    const almacen = new AlmacenLimitesPostgres({ consultar: (...args) => aplicacion.query(...args) }, 'permisos');
    almacen.init({ windowMs: 60000 });
    assert.equal((await almacen.increment('cuenta')).totalHits, 1);
  } finally {
    await aplicacion?.end();
    await propietario.query('SELECT format($1::text,$2::text) AS sql', ['DROP OWNED BY %I', rol]).then(({ rows: consultas }) => propietario.query(consultas[0].sql));
    await propietario.query('SELECT format($1::text,$2::text) AS sql', ['DROP ROLE %I', rol]).then(({ rows: consultas }) => propietario.query(consultas[0].sql));
    await propietario.end();
    await base.cerrar();
  }
});
