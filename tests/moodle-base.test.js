'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Client } = require('pg');
const { URL_ADMIN } = require('./ayuda');
const {
  comprobar, leerObjetivo, compararVersiones, partesDeVersion, prefijoDe, revisarVersion
} = require('../scripts/comprobar-moodle-base');

const sinBase = { skip: URL_ADMIN ? false : 'PRUEBAS_DATABASE_URL no definida' };
const OBJETIVO = { version: '2026100501.02', rama: 'MOODLE_503_STABLE', release: '5.3.1+' };

async function conBaseDesechable(preparar, usar) {
  const nombre = `moodle_prueba_${crypto.randomBytes(6).toString('hex')}`;
  const admin = new Client({ connectionString: URL_ADMIN });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${nombre}`);
  const url = new URL(URL_ADMIN);
  url.pathname = `/${nombre}`;
  const cliente = new Client({ connectionString: url.toString() });
  await cliente.connect();
  try {
    await preparar(cliente);
    return await usar(url.toString());
  } finally {
    await cliente.end().catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS ${nombre} WITH (FORCE)`).catch(() => {});
    await admin.end().catch(() => {});
  }
}

function conConfig(version, release) {
  return async (cliente) => {
    await cliente.query('CREATE TABLE mdl_config (id SERIAL PRIMARY KEY, name TEXT NOT NULL, value TEXT)');
    if (version !== null) {
      await cliente.query('INSERT INTO mdl_config (name, value) VALUES ($1, $2)', ['version', version]);
    }
    if (release) {
      await cliente.query('INSERT INTO mdl_config (name, value) VALUES ($1, $2)', ['release', release]);
    }
  };
}

function entornoCon(url) {
  return { MOODLE_DB_URL: url, DB_SSL: 'desactivado', NODE_ENV: 'test' };
}

test('la version de desarrollo por delante del objetivo bloquea el despliegue', { ...sinBase }, async () => {
  const informe = await conBaseDesechable(
    conConfig('2026112500.01', '6.0dev (Build: 20261124)'),
    (url) => comprobar(entornoCon(url), { objetivo: OBJETIVO })
  );
  assert.equal(informe.fallos.length, 1);
  assert.match(informe.fallos[0], /arrastra el esquema 2026112500\.01/);
  assert.match(informe.fallos[0], /no baja de version/);
  assert.equal(informe.datos.releaseInstalado, '6.0dev (Build: 20261124)');
});

test('la misma version que el objetivo pasa y queda marcada como alineada', { ...sinBase }, async () => {
  const informe = await conBaseDesechable(
    conConfig('2026100501.02', '5.3.1+ (Build: 20261124)'),
    (url) => comprobar(entornoCon(url), { objetivo: OBJETIVO })
  );
  assert.deepEqual(informe.fallos, []);
  assert.deepEqual(informe.avisos, []);
  assert.equal(informe.datos.alineada, true);
});

test('una version por detras pasa con aviso de actualizacion hacia adelante', { ...sinBase }, async () => {
  const informe = await conBaseDesechable(
    conConfig('2025041400.05', '5.0 (Build: 20250414)'),
    (url) => comprobar(entornoCon(url), { objetivo: OBJETIVO })
  );
  assert.deepEqual(informe.fallos, []);
  assert.equal(informe.avisos.length, 1);
  assert.match(informe.avisos[0], /por detras/);
  assert.match(informe.avisos[0], /actualizara/);
});

test('una base sin la tabla de configuracion se declara limpia y pasa', { ...sinBase }, async () => {
  const informe = await conBaseDesechable(
    async () => {},
    (url) => comprobar(entornoCon(url), { objetivo: OBJETIVO })
  );
  assert.deepEqual(informe.fallos, []);
  assert.equal(informe.avisos.length, 1);
  assert.match(informe.avisos[0], /No existe la tabla mdl_config/);
  assert.equal(informe.datos.esquemaInstalado, null);
});

test('la tabla sin fila de version avisa que la base esta a medio instalar', { ...sinBase }, async () => {
  const informe = await conBaseDesechable(
    conConfig(null, null),
    (url) => comprobar(entornoCon(url), { objetivo: OBJETIVO })
  );
  assert.deepEqual(informe.fallos, []);
  assert.match(informe.avisos[0], /a medio instalar/);
});

test('sin permiso de lectura sobre la tabla el fallo dice que falta la lectura', { ...sinBase }, async () => {
  const rol = `moodle_lector_${crypto.randomBytes(4).toString('hex')}`;
  const clave = crypto.randomBytes(18).toString('base64url');
  const informe = await conBaseDesechable(
    async (cliente) => {
      await conConfig('2026100501.02', null)(cliente);
      await cliente.query(`CREATE ROLE ${rol} LOGIN PASSWORD '${clave}'`);
      await cliente.query('REVOKE ALL ON mdl_config FROM PUBLIC');
      await cliente.query(`GRANT CONNECT ON DATABASE ${cliente.database} TO ${rol}`);
      await cliente.query(`GRANT USAGE ON SCHEMA public TO ${rol}`);
    },
    async (url) => {
      const comoRol = new URL(url);
      comoRol.username = rol;
      comoRol.password = clave;
      const salida = await comprobar(entornoCon(comoRol.toString()), { objetivo: OBJETIVO });
      const admin = new Client({ connectionString: url });
      await admin.connect();
      await admin.query(`DROP ROLE IF EXISTS ${rol}`).catch(() => {});
      await admin.end().catch(() => {});
      return salida;
    }
  );
  assert.equal(informe.fallos.length, 1);
  assert.match(informe.fallos[0], /no puede leer mdl_config/);
});

test('sin MOODLE_DB_URL falla sin salir a la red', async () => {
  let intentos = 0;
  const informe = await comprobar({ NODE_ENV: 'test' }, {
    objetivo: OBJETIVO,
    conectar: async () => { intentos += 1; }
  });
  assert.equal(intentos, 0);
  assert.match(informe.fallos[0], /MOODLE_DB_URL no esta definida/);
});

test('un prefijo que no es un identificador de Moodle se rechaza antes de consultar', async () => {
  let intentos = 0;
  const informe = await comprobar(
    { MOODLE_DB_URL: 'postgresql://u:p@localhost:5432/moodle', MOODLE_DB_PREFIX: 'mdl_"; DROP TABLE x; --' },
    { objetivo: OBJETIVO, conectar: async () => { intentos += 1; } }
  );
  assert.equal(intentos, 0);
  assert.match(informe.fallos[0], /MOODLE_DB_PREFIX no sirve/);
});

test('el prefijo por defecto es el de Moodle y los validos se aceptan', () => {
  assert.equal(prefijoDe({}), 'mdl_');
  assert.equal(prefijoDe({ MOODLE_DB_PREFIX: 'esoe_' }), 'esoe_');
  assert.throws(() => prefijoDe({ MOODLE_DB_PREFIX: '1mdl' }), /no sirve/);
  assert.throws(() => prefijoDe({ MOODLE_DB_PREFIX: 'MDL_' }), /no sirve/);
  assert.throws(() => prefijoDe({ MOODLE_DB_PREFIX: 'mdl-' }), /no sirve/);
});

test('las versiones se comparan por partes y no como numero de coma flotante', () => {
  assert.equal(compararVersiones('2026100501.02', '2026100501.02'), 0);
  assert.equal(compararVersiones('2026112500.01', '2026100501.02'), 1);
  assert.equal(compararVersiones('2025041400.05', '2026100501.02'), -1);
  assert.equal(compararVersiones('2026100501.10', '2026100501.02'), 1);
  assert.equal(compararVersiones('2026100501.2', '2026100501.02'), 1);
  assert.equal(compararVersiones('2026100501', '2026100501.02'), -1);
  assert.equal(compararVersiones('no es version', '2026100501.02'), null);
  assert.equal(compararVersiones('', '2026100501.02'), null);
});

test('el decimal se compara por posicion, no por valor entero', () => {
  assert.deepEqual(partesDeVersion('2026100501.02'), [2026100501, 20000]);
  assert.deepEqual(partesDeVersion('2026100501.2'), [2026100501, 200000]);
  assert.deepEqual(partesDeVersion('2026100501'), [2026100501, 0]);
  assert.equal(partesDeVersion('2026100501.02.03'), null);
});

test('una version instalada que no se puede comparar es fallo, no aviso', () => {
  const informe = { datos: {}, fallos: [], avisos: [] };
  revisarVersion('MOODLE_503_STABLE', OBJETIVO, informe);
  assert.equal(informe.avisos.length, 0);
  assert.match(informe.fallos[0], /no se puede comparar/);
});

test('el objetivo se lee del archivo versionado y es una version comparable', () => {
  const objetivo = leerObjetivo();
  assert.match(objetivo.version, /^\d+(\.\d+)?$/);
  assert.equal(objetivo.rama, 'MOODLE_503_STABLE');
  assert.notEqual(partesDeVersion(objetivo.version), null);
});

test('el objetivo con una version ilegible no se acepta en silencio', () => {
  assert.throws(() => leerObjetivo('/dev/null'), Error);
});
