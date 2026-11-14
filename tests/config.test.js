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
