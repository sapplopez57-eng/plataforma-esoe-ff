'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { levantar } = require('./ayuda');

let app;
before(async () => { app = await levantar(); });
after(async () => { await app.cerrar(); });

test('salud: responde OK sin cache', async () => {
  const res = await app.pedir('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const cuerpo = await res.json();
  assert.equal(cuerpo.status, 'OK');
  assert.ok(!Number.isNaN(Date.parse(cuerpo.timestamp)));
});

test('interfaz: sirve la pagina principal y sus recursos', async () => {
  const inicio = await app.pedir('/');
  assert.equal(inicio.status, 200);
  assert.match(await inicio.text(), /<title>ESOE/);
  for (const ruta of ['/css/styles.css', '/js/app.js', '/js/data.js', '/js/icons.js']) {
    assert.equal((await app.pedir(ruta)).status, 200, ruta);
  }
});

test('interfaz: una ruta inexistente responde 404 real', async () => {
  const res = await app.pedir('/pagina-que-no-existe');
  assert.equal(res.status, 404);
  assert.doesNotMatch(await res.text(), /<html/i);
});

test('seguridad: no se expone codigo ni configuracion del servidor', async () => {
  const privados = [
    '/src/server.js', '/src/app.js', '/src/config.js', '/server.js',
    '/package.json', '/package-lock.json', '/database/schema.sql',
    '/docker-compose.yml', '/Dockerfile', '/.env', '/.env.example',
    '/.git/config', '/.gitignore', '/README.md', '/tests/servidor.test.js'
  ];
  for (const ruta of privados) {
    const res = await app.pedir(ruta);
    const cuerpo = await res.text();
    assert.equal(res.status, 404, `${ruta} deberia responder 404`);
    assert.doesNotMatch(cuerpo, /require\(|CREATE TABLE|POSTGRES_|"dependencies"/, ruta);
  }
});

test('seguridad: no admite recorrido de directorios', async () => {
  for (const ruta of ['/..%2fpackage.json', '/%2e%2e/package.json', '/js/..%2f..%2fpackage.json']) {
    const res = await app.pedir(ruta);
    assert.notEqual(res.status, 200, ruta);
  }
});

test('seguridad: cabeceras de proteccion presentes', async () => {
  const res = await app.pedir('/');
  const csp = res.headers.get('content-security-policy');
  assert.ok(csp, 'falta Content-Security-Policy');
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /script-src [^;]*'unsafe-inline'/);
  assert.match(csp, /script-src-attr 'none'/);
  assert.match(csp, /font-src 'self'(;|$)/);
  assert.doesNotMatch(csp, /googleapis|gstatic/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(res.headers.get('x-powered-by'), null);
  assert.ok(res.headers.get('strict-transport-security'));
});

test('seguridad: CORS cerrado por defecto', async () => {
  const res = await app.pedir('/api/health', { headers: { Origin: 'https://sitio-ajeno.example' } });
  assert.equal(res.headers.get('access-control-allow-origin'), null);
});

test('seguridad: CORS solo para origenes declarados', async () => {
  const conLista = await levantar({ CORS_ORIGINS: 'https://portal.example' });
  try {
    const permitido = await conLista.pedir('/api/health', { headers: { Origin: 'https://portal.example' } });
    assert.equal(permitido.headers.get('access-control-allow-origin'), 'https://portal.example');
    const ajeno = await conLista.pedir('/api/health', { headers: { Origin: 'https://sitio-ajeno.example' } });
    assert.equal(ajeno.headers.get('access-control-allow-origin'), null);
  } finally {
    await conLista.cerrar();
  }
});

test('api: ruta inexistente responde 404 en JSON', async () => {
  const res = await app.pedir('/api/no-existe');
  assert.equal(res.status, 404);
  assert.match(res.headers.get('content-type'), /application\/json/);
});

test('api: JSON malformado responde 400 sin detalles internos', async () => {
  const res = await app.pedir('/api/health', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"roto":'
  });
  assert.equal(res.status, 400);
  const texto = await res.text();
  assert.doesNotMatch(texto, /SyntaxError|at JSON|node_modules/);
});

test('api: rechaza cuerpos mayores al limite', async () => {
  const res = await app.pedir('/api/health', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ relleno: 'x'.repeat(200 * 1024) })
  });
  assert.equal(res.status, 413);
});

test('api: limite de peticiones activo', async () => {
  const limitado = await levantar({ RATE_LIMIT_MAX: '3' });
  try {
    const estados = [];
    for (let i = 0; i < 5; i += 1) estados.push((await limitado.pedir('/api/health')).status);
    assert.deepEqual(estados, [200, 200, 200, 429, 429]);
  } finally {
    await limitado.cerrar();
  }
});
