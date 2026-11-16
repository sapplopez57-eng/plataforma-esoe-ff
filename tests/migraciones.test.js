'use strict';

/* SMS-01. Criterio de aceptacion: cuando se ejecuta la migracion sobre una base
   vacia o ya migrada, queda en la ultima version sin errores ni cambios
   duplicados. Ademas, cada forma conocida de romper una migracion tiene que
   detenerse con un mensaje claro, no a medias. */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Client } = require('pg');
const { migrar, leerMigraciones, ErrorDeMigracion, DIRECTORIO } = require('../src/migraciones');
const { URL_ADMIN } = require('./ayuda');

const sinBase = URL_ADMIN ? false : { skip: 'Sin PRUEBAS_DATABASE_URL' };

let admin;
const creadas = [];

async function baseNueva() {
  const nombre = `esoe_migra_${crypto.randomBytes(5).toString('hex')}`;
  await admin.query(`CREATE DATABASE ${nombre}`);
  creadas.push(nombre);
  const url = new URL(URL_ADMIN);
  url.pathname = `/${nombre}`;
  const cliente = new Client({ connectionString: url.toString() });
  await cliente.connect();
  return cliente;
}

// Un directorio de migraciones de mentira, para probar los fallos sin tocar
// las migraciones reales del proyecto.
function directorioCon(archivos) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'esoe-migraciones-'));
  for (const [nombre, contenido] of Object.entries(archivos)) fs.writeFileSync(path.join(dir, nombre), contenido);
  return dir;
}

const tablas = async (c) => (await c.query(
  "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
)).rows.map((r) => r.table_name);

before(async () => {
  if (!URL_ADMIN) return;
  admin = new Client({ connectionString: URL_ADMIN });
  await admin.connect();
});

after(async () => {
  if (!admin) return;
  for (const nombre of creadas) await admin.query(`DROP DATABASE IF EXISTS ${nombre} WITH (FORCE)`);
  await admin.end();
});

// --- El criterio de aceptacion ---------------------------------------------

test('migraciones: una base vacia queda en la ultima version', sinBase, async () => {
  const c = await baseNueva();
  try {
    const r = await migrar({ cliente: c });
    const total = leerMigraciones().length;
    assert.equal(r.version, total);
    assert.equal(r.aplicadas.length, total);
    assert.equal(r.adoptada, false);
    const registradas = (await c.query('SELECT version FROM migraciones_aplicadas ORDER BY version')).rows.map((x) => x.version);
    assert.deepEqual(registradas, Array.from({ length: total }, (_, i) => i + 1));
    assert.ok((await tablas(c)).includes('usuarios'));
  } finally {
    await c.end();
  }
});

test('migraciones: ejecutarla otra vez no aplica ni duplica nada', sinBase, async () => {
  const c = await baseNueva();
  try {
    await migrar({ cliente: c });
    const antes = await tablas(c);
    const segunda = await migrar({ cliente: c });
    const tercera = await migrar({ cliente: c });
    assert.deepEqual(segunda.aplicadas, []);
    assert.deepEqual(tercera.aplicadas, []);
    assert.equal(segunda.yaEstaban, leerMigraciones().length);
    assert.deepEqual(await tablas(c), antes);
    const { rows } = await c.query('SELECT COUNT(*)::int AS n FROM migraciones_aplicadas');
    assert.equal(rows[0].n, leerMigraciones().length, 'una fila por migracion, sin repetidas');
  } finally {
    await c.end();
  }
});

// --- Lo que tiene que detenerse ----------------------------------------------

test('migraciones: una migracion que falla se deshace entera y no se registra', sinBase, async () => {
  const c = await baseNueva();
  const dir = directorioCon({
    '0001_buena.sql': 'CREATE TABLE uno (id INTEGER PRIMARY KEY);',
    '0002_rota.sql': 'CREATE TABLE dos (id INTEGER PRIMARY KEY);\nINSERT INTO tabla_que_no_existe VALUES (1);'
  });
  try {
    await assert.rejects(migrar({ cliente: c, directorio: dir }), (e) => e instanceof ErrorDeMigracion && e.codigo === 'FALLO_AL_APLICAR' && /0002_rota/.test(e.message));
    const hay = await tablas(c);
    assert.ok(hay.includes('uno'), 'la 0001 si quedo aplicada');
    assert.ok(!hay.includes('dos'), 'la 0002 no deja ni la tabla que alcanzo a crear');
    const versiones = (await c.query('SELECT version FROM migraciones_aplicadas')).rows.map((x) => x.version);
    assert.deepEqual(versiones, [1]);
    // y la conexion queda usable: no se quedo dentro de una transaccion abortada
    assert.equal((await c.query('SELECT 1 AS ok')).rows[0].ok, 1);
  } finally {
    await c.end();
  }
});

test('migraciones: editar una migracion ya aplicada detiene todo', sinBase, async () => {
  const c = await baseNueva();
  const dir = directorioCon({ '0001_inicial.sql': 'CREATE TABLE uno (id INTEGER PRIMARY KEY);' });
  try {
    await migrar({ cliente: c, directorio: dir });
    fs.writeFileSync(path.join(dir, '0001_inicial.sql'), 'CREATE TABLE uno (id INTEGER PRIMARY KEY, extra TEXT);');
    fs.writeFileSync(path.join(dir, '0002_siguiente.sql'), 'CREATE TABLE dos (id INTEGER PRIMARY KEY);');
    await assert.rejects(migrar({ cliente: c, directorio: dir }), (e) => e.codigo === 'MIGRACION_ALTERADA');
    assert.ok(!(await tablas(c)).includes('dos'), 'no aplica nada despues de detectar la alteracion');
  } finally {
    await c.end();
  }
});

test('migraciones: una base de un codigo mas nuevo no se toca', sinBase, async () => {
  const c = await baseNueva();
  try {
    await migrar({ cliente: c, directorio: directorioCon({ '0001_a.sql': 'SELECT 1;', '0002_b.sql': 'SELECT 1;' }) });
    await assert.rejects(
      migrar({ cliente: c, directorio: directorioCon({ '0001_a.sql': 'SELECT 1;' }) }),
      (e) => e.codigo === 'BASE_MAS_NUEVA'
    );
  } finally {
    await c.end();
  }
});

test('migraciones: dos instancias a la vez aplican cada migracion una sola vez', sinBase, async () => {
  const c1 = await baseNueva();
  const url = new URL(URL_ADMIN);
  url.pathname = `/${creadas[creadas.length - 1]}`;
  const c2 = new Client({ connectionString: url.toString() });
  await c2.connect();
  try {
    const [a, b] = await Promise.all([migrar({ cliente: c1 }), migrar({ cliente: c2 })]);
    const total = leerMigraciones().length;
    assert.equal(a.aplicadas.length + b.aplicadas.length, total, 'entre las dos aplicaron todo exactamente una vez');
    assert.ok(a.aplicadas.length === 0 || b.aplicadas.length === 0, 'una espero a la otra');
  } finally {
    await c1.end();
    await c2.end();
  }
});

// --- Bases creadas antes de las migraciones ----------------------------------

test('migraciones: una base creada con el antiguo schema.sql se adopta sin reaplicar', sinBase, async () => {
  const c = await baseNueva();
  try {
    // Asi quedaba una base levantada con docker compose antes de SMS-01: el
    // esquema completo y ningun registro de migraciones.
    await c.query(leerMigraciones()[0].contenido);
    const r = await migrar({ cliente: c });
    assert.equal(r.adoptada, true);
    assert.ok(!r.aplicadas.includes('0001_esquema_inicial.sql'), 'la 0001 no se ejecuta otra vez');
    assert.equal(r.version, leerMigraciones().length);
  } finally {
    await c.end();
  }
});

test('migraciones: una base con el esquema a medias no se adopta', sinBase, async () => {
  const c = await baseNueva();
  try {
    await c.query('CREATE TABLE usuarios (id INTEGER PRIMARY KEY);');
    await assert.rejects(migrar({ cliente: c }), (e) => e.codigo === 'ESQUEMA_PARCIAL' && /faltan tablas/.test(e.message));
  } finally {
    await c.end();
  }
});

// --- Validacion del directorio, sin base ------------------------------------

test('migraciones: el directorio real es valido y empieza en 0001', () => {
  const lista = leerMigraciones(DIRECTORIO);
  assert.ok(lista.length >= 1);
  assert.equal(lista[0].archivo, '0001_esquema_inicial.sql');
  lista.forEach((m, i) => assert.equal(m.version, i + 1));
});

test('migraciones: nombres invalidos y secuencias rotas se rechazan antes de tocar la base', () => {
  assert.throws(() => leerMigraciones(directorioCon({ '0001_Inicial.sql': '' })), (e) => e.codigo === 'NOMBRE_INVALIDO');
  assert.throws(() => leerMigraciones(directorioCon({ '1_inicial.sql': '' })), (e) => e.codigo === 'NOMBRE_INVALIDO');
  assert.throws(() => leerMigraciones(directorioCon({ '0001_a.sql': '', '0003_c.sql': '' })), (e) => e.codigo === 'SECUENCIA_ROTA');
  assert.throws(() => leerMigraciones(directorioCon({ '0002_b.sql': '' })), (e) => e.codigo === 'SECUENCIA_ROTA');
  // lo que no es .sql se ignora (una nota, un README)
  assert.equal(leerMigraciones(directorioCon({ '0001_a.sql': '', 'LEEME.md': '' })).length, 1);
});

test('migraciones: sin cliente no hace nada', async () => {
  await assert.rejects(migrar({}), (e) => e.codigo === 'SIN_CLIENTE');
  await assert.rejects(migrar({ cliente: {} }), (e) => e.codigo === 'SIN_CLIENTE');
});
