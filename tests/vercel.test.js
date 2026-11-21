'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');

function cargarEntrada(env) {
  const ruta = path.join(__dirname, '..', 'api', 'index.js');
  const anterior = { ...process.env };
  Object.assign(process.env, env);
  try {
    delete require.cache[require.resolve(ruta)];
    return require(ruta);
  } finally {
    for (const clave of Object.keys(env)) {
      if (clave in anterior) process.env[clave] = anterior[clave];
      else delete process.env[clave];
    }
  }
}

test('vercel: la entrada exporta la aplicacion y sirve interfaz y API con cabeceras', async () => {
  const app = cargarEntrada({ NODE_ENV: 'test', DATABASE_URL: '' });
  assert.equal(typeof app, 'function');
  const servidor = http.createServer(app).listen(0, '127.0.0.1');
  await new Promise((r) => servidor.once('listening', r));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  try {
    const pagina = await fetch(`${base}/`);
    assert.equal(pagina.status, 200);
    assert.match(await pagina.text(), /<html/i);
    assert.match(pagina.headers.get('content-security-policy') || '', /script-src 'self'/);
    assert.equal((await fetch(`${base}/js/servidor.js`)).status, 200);
    const salud = await fetch(`${base}/api/health`);
    assert.equal(salud.status, 200);
    assert.equal((await salud.json()).status, 'OK');
  } finally {
    await new Promise((r) => servidor.close(r));
  }
});

test('vercel: en produccion sin configuracion completa, la entrada no arranca', () => {
  assert.throws(() => cargarEntrada({ NODE_ENV: 'production', DATABASE_URL: '' }), /Configuracion invalida/);
});
