'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { datosRoot } = require('../scripts/crear-root');

const valido = { ESOE_ROOT_USUARIO: 'Ares', ESOE_ROOT_CLAVE: 'clave-de-prueba-1', ESOE_ROOT_CORREO: 'root+clerk_test@example.com', CLERK_SECRET_KEY: 'sk_test_x' };

test('root: con todo en orden no falta nada y el usuario va en minusculas', () => {
  const d = datosRoot(valido);
  assert.deepEqual(d.faltan, []);
  assert.equal(d.usuario, 'ares');
  assert.equal(d.nombre, 'ares', 'sin nombre, usa el usuario');
});

test('root: rechaza usuario, clave, correo o llave que no sirven', () => {
  const casos = [
    [{ ESOE_ROOT_USUARIO: 'a b' }, 'ESOE_ROOT_USUARIO'],
    [{ ESOE_ROOT_CLAVE: 'corta' }, 'ESOE_ROOT_CLAVE'],
    [{ ESOE_ROOT_CORREO: 'sin-arroba' }, 'ESOE_ROOT_CORREO'],
    [{ CLERK_SECRET_KEY: '' }, 'CLERK_SECRET_KEY']
  ];
  for (const [cambio, campo] of casos) {
    const { faltan } = datosRoot({ ...valido, ...cambio });
    assert.ok(faltan.some((f) => f.startsWith(campo)), `deberia faltar ${campo}`);
  }
});

test('root: la contrasena no aparece en el codigo del script', () => {
  const fuente = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'scripts', 'crear-root.js'), 'utf8');
  assert.doesNotMatch(fuente, /password:\s*['"`]/, 'la contrasena sale de .env, no de un literal');
});
