'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cargarConfig } = require('../src/config');

const SECRETO_VALIDO = 'a'.repeat(48);
const BASE_VALIDA = 'postgresql://esoe_admin:Zx9-clave-propia-larga@esoe-db:5432/esoe_sms';

test('config: desarrollo arranca con valores por defecto', () => {
  const config = cargarConfig({});
  assert.equal(config.puerto, 8080);
  assert.equal(config.esProduccion, false);
  assert.deepEqual(config.origenesPermitidos, []);
});

test('config: produccion exige secretos propios', () => {
  assert.throws(() => cargarConfig({ NODE_ENV: 'production' }), /JWT_SECRET/);
  assert.throws(
    () => cargarConfig({ NODE_ENV: 'production', JWT_SECRET: SECRETO_VALIDO }),
    /DATABASE_URL es obligatoria/
  );
});

test('config: produccion rechaza los secretos de ejemplo', () => {
  assert.throws(() => cargarConfig({
    NODE_ENV: 'production',
    JWT_SECRET: 'esoe_jwt_secret_key_change_in_prod',
    DATABASE_URL: BASE_VALIDA
  }), /JWT_SECRET/);
  assert.throws(() => cargarConfig({
    NODE_ENV: 'production',
    JWT_SECRET: SECRETO_VALIDO,
    DATABASE_URL: 'postgresql://esoe_admin:esoe_secure_2026@esoe-db:5432/esoe_sms'
  }), /contrasena de ejemplo/);
});

test('config: produccion valida arranca', () => {
  const config = cargarConfig({
    NODE_ENV: 'production',
    JWT_SECRET: SECRETO_VALIDO,
    DATABASE_URL: BASE_VALIDA,
    CORS_ORIGINS: 'https://a.example, https://b.example'
  });
  assert.equal(config.esProduccion, true);
  assert.deepEqual(config.origenesPermitidos, ['https://a.example', 'https://b.example']);
});

test('config: valores numericos invalidos caen al valor por defecto', () => {
  const config = cargarConfig({ PORT: 'abc', RATE_LIMIT_MAX: '-5' });
  assert.equal(config.puerto, 8080);
  assert.equal(config.limitePeticiones.maximo, 300);
});
