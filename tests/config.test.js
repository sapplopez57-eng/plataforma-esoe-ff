'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cargarConfig, dominioDeClerk } = require('../src/config');

const LLAVE_PUBLICA = `pk_live_${Buffer.from('clerk.esoe.example$').toString('base64')}`;
const PRODUCCION = Object.freeze({
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://esoe_admin:Zx9-clave-propia-larga@esoe-db:5432/esoe_sms',
  CLERK_PUBLISHABLE_KEY: LLAVE_PUBLICA,
  CLERK_SECRET_KEY: `sk_live_${'s'.repeat(40)}`,
  ORIGEN_PUBLICO: 'https://esoe.example',
  CLAVE_CIFRADO: 'ab'.repeat(32)
});

function sin(variable) {
  const copia = { ...PRODUCCION };
  delete copia[variable];
  return copia;
}

test('config: desarrollo arranca sin nada configurado', () => {
  const config = cargarConfig({});
  assert.equal(config.puerto, 8080);
  assert.equal(config.esProduccion, false);
  assert.equal(config.clerk.habilitado, false);
  assert.equal(config.integraciones.permitirRedPrivada, false);
  assert.deepEqual(config.origenesPermitidos, []);
});

test('config: produccion valida arranca', () => {
  const config = cargarConfig({ ...PRODUCCION, CORS_ORIGINS: 'https://a.example, https://b.example' });
  assert.equal(config.esProduccion, true);
  assert.equal(config.clerk.habilitado, true);
  assert.equal(config.clerk.dominio, 'clerk.esoe.example');
  assert.deepEqual(config.clerk.origenesAutorizados, ['https://esoe.example']);
  assert.deepEqual(config.origenesPermitidos, ['https://a.example', 'https://b.example']);
});

test('config: produccion exige cada pieza de seguridad', () => {
  assert.throws(() => cargarConfig(sin('CLERK_SECRET_KEY')), /deben definirse juntas/);
  assert.throws(() => cargarConfig({ NODE_ENV: 'production' }), /CLERK_PUBLISHABLE_KEY y CLERK_SECRET_KEY son obligatorias/);
  assert.throws(() => cargarConfig(sin('ORIGEN_PUBLICO')), /ORIGEN_PUBLICO/);
  assert.throws(() => cargarConfig(sin('CLAVE_CIFRADO')), /CLAVE_CIFRADO es obligatoria/);
  assert.throws(() => cargarConfig(sin('DATABASE_URL')), /DATABASE_URL es obligatoria/);
});

test('config: produccion rechaza la contrasena de ejemplo', () => {
  assert.throws(() => cargarConfig({
    ...PRODUCCION, DATABASE_URL: 'postgresql://esoe_admin:esoe_secure_2026@esoe-db:5432/esoe_sms'
  }), /contrasena de ejemplo/);
});

test('config: rechaza llaves mal formadas en cualquier entorno', () => {
  assert.throws(() => cargarConfig({ CLERK_PUBLISHABLE_KEY: 'no-es-una-llave', CLERK_SECRET_KEY: 'x' }), /formato esperado/);
  assert.throws(() => cargarConfig({ CLAVE_CIFRADO: 'corta' }), /64 caracteres hexadecimales/);
});

test('config: el dominio de Clerk sale de la llave publica', () => {
  assert.equal(dominioDeClerk(LLAVE_PUBLICA), 'clerk.esoe.example');
  assert.equal(dominioDeClerk('pk_test_' + Buffer.from('<script>$').toString('base64')), '');
  assert.equal(dominioDeClerk(''), '');
});

test('config: valores numericos invalidos caen al valor por defecto', () => {
  const config = cargarConfig({ PORT: 'abc', RATE_LIMIT_MAX: '-5' });
  assert.equal(config.puerto, 8080);
  assert.equal(config.limitePeticiones.maximo, 300);
});

test('config: el pool tiene limites finitos y configurables sin cambiar Clerk', () => {
  const configurada = cargarConfig({ ...PRODUCCION, DB_POOL_MAX: '4', DB_CONNECTION_TIMEOUT_MS: '1000', DB_STATEMENT_TIMEOUT_MS: '2000' });
  assert.deepEqual(configurada.baseDeDatos, { max: 4, connectionTimeoutMillis: 1000, idleTimeoutMillis: 30000, statement_timeout: 2000, ssl: false });
  assert.deepEqual(configurada.clerk, cargarConfig(PRODUCCION).clerk);
  for (const valor of ['0', '-1', '101', '2.5', '12abc', 'Infinity']) {
    assert.throws(() => cargarConfig({ DB_POOL_MAX: valor }), /DB_POOL_MAX/);
  }
  for (const variable of ['DB_CONNECTION_TIMEOUT_MS', 'DB_IDLE_TIMEOUT_MS', 'DB_STATEMENT_TIMEOUT_MS']) {
    assert.throws(() => cargarConfig({ [variable]: '0' }), new RegExp(variable));
  }
});

test('config: produccion comparte cuotas y el despliegue sin servidor usa un pool pequeno', () => {
  assert.equal(cargarConfig(PRODUCCION).limitePeticiones.almacen, 'postgres');
  assert.equal(cargarConfig({}).limitePeticiones.almacen, 'memory');
  assert.throws(() => cargarConfig({ ...PRODUCCION, RATE_LIMIT_STORE: 'memory' }), /RATE_LIMIT_STORE/);
  assert.throws(() => cargarConfig({ RATE_LIMIT_STORE: 'desconocido' }), /RATE_LIMIT_STORE/);
  assert.equal(cargarConfig({ VERCEL: '1' }).baseDeDatos.max, 2);
  assert.equal(cargarConfig({ VERCEL: '1', DB_POOL_MAX: '4' }).baseDeDatos.max, 4);
});

test('config: la publicacion exige origen HTTPS sin rutas ni credenciales', () => {
  for (const origen of ['http://esoe.example', 'https://esoe.example/ruta', 'https://usuario:clave@esoe.example']) {
    assert.throws(() => cargarConfig({ ...PRODUCCION, ORIGEN_PUBLICO: origen }), /ORIGEN_PUBLICO/);
  }
});
