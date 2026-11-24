'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { tlsDeBaseDeDatos, cargarConfig, validarConfig, esHostLocal, MODOS_TLS } = require('../src/config');

const PEM = '-----BEGIN CERTIFICATE-----\nMIIBkTCB+wIBADANBgkqhkiG9w0BAQsFADA=\n-----END CERTIFICATE-----';
const ADMINISTRADO = 'postgresql://u:c@aws-0-us-east-1.pooler.supabase.com';

test('tls: sin base de datos no se pide cifrado', () => {
  assert.deepEqual(tlsDeBaseDeDatos({}), { modo: 'desactivado', ssl: false });
});

test('tls: una base local o de red interna sigue sin cifrado', () => {
  for (const host of ['127.0.0.1', 'localhost', 'db', 'postgres']) {
    const { modo, ssl } = tlsDeBaseDeDatos({ DATABASE_URL: `postgresql://u:c@${host}:5432/esoe` });
    assert.equal(modo, 'desactivado', host);
    assert.equal(ssl, false, host);
    assert.equal(esHostLocal(host), true, host);
  }
});

test('tls: una base remota o administrada se verifica sin configurar nada', () => {
  const urls = [`${ADMINISTRADO}:6543/postgres`, 'postgresql://u:c@base.ejemplo.hn:5432/esoe',
    'postgresql://u:c@127.0.0.1:5432/esoe?sslmode=require'];
  for (const DATABASE_URL of urls) {
    const { modo, ssl } = tlsDeBaseDeDatos({ DATABASE_URL });
    assert.equal(modo, 'verificado', DATABASE_URL);
    assert.deepEqual(ssl, { rejectUnauthorized: true }, DATABASE_URL);
  }
});

test('tls: sslmode=disable no activa el cifrado por si solo', () => {
  assert.equal(tlsDeBaseDeDatos({ DATABASE_URL: 'postgresql://u:c@127.0.0.1:5432/esoe?sslmode=disable' }).modo, 'desactivado');
});

test('tls: el modo requerido cifra sin comprobar el certificado', () => {
  const { ssl } = tlsDeBaseDeDatos({ DATABASE_URL: 'postgresql://u:c@db:5432/esoe', DB_SSL: 'requerido' });
  assert.deepEqual(ssl, { rejectUnauthorized: false });
});

test('tls: una autoridad propia se entrega al cliente ya verificado', () => {
  const { modo, ssl } = tlsDeBaseDeDatos({ DATABASE_URL: `${ADMINISTRADO}:6543/postgres`, DB_CA_CERT: PEM });
  assert.equal(modo, 'verificado');
  assert.equal(ssl.rejectUnauthorized, true);
  assert.equal(ssl.ca, PEM);
});

test('tls: la autoridad admite saltos de linea escapados', () => {
  const { ssl } = tlsDeBaseDeDatos({ DB_SSL: 'verificado', DB_CA_CERT: PEM.replace(/\n/g, '\\n') });
  assert.equal(ssl.ca, PEM);
});

test('tls: se rechaza un modo desconocido, una autoridad mal formada y una autoridad sin verificacion', () => {
  for (const env of [{ DB_SSL: 'quizas' }, { DB_CA_CERT: 'no-es-un-certificado' },
    { DB_SSL: 'requerido', DB_CA_CERT: PEM }]) {
    assert.throws(() => tlsDeBaseDeDatos(env), (error) => {
      assert.equal(error.code, 'CONFIG_INVALIDA');
      return true;
    }, JSON.stringify(env));
  }
  assert.deepEqual(MODOS_TLS, ['desactivado', 'requerido', 'verificado']);
});

test('tls: la configuracion lleva el cifrado al grupo de conexiones', () => {
  const config = cargarConfig({ NODE_ENV: 'test', DATABASE_URL: `${ADMINISTRADO}:6543/postgres` });
  assert.deepEqual(config.baseDeDatos.ssl, { rejectUnauthorized: true });
  assert.equal(config.tlsBaseDeDatos, 'verificado');
  assert.equal(config.sinEstado, false);
});

test('tls: en produccion una base remota sin cifrado no pasa la validacion', () => {
  const errores = validarConfig({
    esProduccion: true, databaseUrl: 'postgresql://u:c@base.ejemplo.hn:5432/esoe',
    tlsBaseDeDatos: 'desactivado', clerk: { habilitado: true, origenesAutorizados: ['https://esoe.ejemplo.hn'] },
    integraciones: { claveCifrado: 'a'.repeat(64) }, voz: {}, limitePeticiones: { almacen: 'postgres' }
  });
  assert.ok(errores.some((e) => e.includes('DB_SSL')), errores.join(' | '));
});

test('tls: en un despliegue sin estado se exige el agrupador de conexiones', () => {
  const base = {
    esProduccion: true, tlsBaseDeDatos: 'verificado', sinEstado: true,
    clerk: { habilitado: true, origenesAutorizados: ['https://esoe.ejemplo.hn'] },
    integraciones: { claveCifrado: 'a'.repeat(64) }, voz: {}, limitePeticiones: { almacen: 'postgres' }
  };
  const directo = validarConfig({ ...base, databaseUrl: 'postgresql://u:c@db.abcdefghijkl.supabase.co:5432/postgres' });
  assert.ok(directo.some((e) => e.includes('6543')), directo.join(' | '));
  assert.deepEqual(validarConfig({ ...base, databaseUrl: `${ADMINISTRADO}:6543/postgres` }), []);
});

test('tls: una base en red privada no exige certificado verificado', () => {
  for (const host of ['10.0.0.5', '172.20.1.3', '192.168.1.10', '127.0.0.1', 'db.interno.local']) {
    assert.equal(esHostLocal(host), true, host);
    assert.equal(tlsDeBaseDeDatos({ DATABASE_URL: `postgresql://u:c@${host}:5432/esoe` }).modo, 'desactivado', host);
  }
});

test('tls: una url sin puerto cuenta como conexion directa', () => {
  const errores = validarConfig({
    esProduccion: true, tlsBaseDeDatos: 'verificado', sinEstado: true,
    databaseUrl: 'postgresql://db.abcdefghijkl.supabase.co/postgres',
    clerk: { habilitado: true, origenesAutorizados: ['https://esoe.ejemplo.hn'] },
    integraciones: { claveCifrado: 'a'.repeat(64) }, voz: {}, limitePeticiones: { almacen: 'postgres' }
  });
  assert.ok(errores.some((e) => e.includes('6543')), errores.join(' | '));
});
