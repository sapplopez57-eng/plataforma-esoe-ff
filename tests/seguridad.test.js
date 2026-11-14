'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { crearCifrador } = require('../src/seguridad/cifrado');
const { normalizarUrlBase, esDireccionInterna, enviar, ErrorDeRed } = require('../src/seguridad/red');

test('cifrado: ida y vuelta, y cada cifrado es distinto', () => {
  const cifrador = crearCifrador(crypto.randomBytes(32).toString('hex'));
  const a = cifrador.cifrar('token-secreto-ñ');
  const b = cifrador.cifrar('token-secreto-ñ');
  assert.notEqual(a, b);
  assert.doesNotMatch(a, /token-secreto/);
  assert.equal(cifrador.descifrar(a), 'token-secreto-ñ');
});

test('cifrado: detecta alteraciones y claves equivocadas', () => {
  const cifrador = crearCifrador(crypto.randomBytes(32).toString('hex'));
  const otro = crearCifrador(crypto.randomBytes(32).toString('hex'));
  const cifrado = cifrador.cifrar('dato');
  const partes = cifrado.split('.');
  partes[3] = Buffer.from('otro').toString('base64url');
  assert.throws(() => cifrador.descifrar(partes.join('.')));
  assert.throws(() => otro.descifrar(cifrado));
  assert.throws(() => cifrador.descifrar('texto-plano'), /Formato/);
});

test('cifrado: sin clave valida no hay cifrador', () => {
  assert.equal(crearCifrador(''), null);
  assert.equal(crearCifrador('abc'), null);
});

test('red: reconoce direcciones internas', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.11.80', '169.254.169.254', '100.68.1.1',
    '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', 'no-es-ip']) {
    assert.equal(esDireccionInterna(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '190.4.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
    assert.equal(esDireccionInterna(ip), false, ip);
  }
});

test('red: normaliza direcciones validas', () => {
  assert.equal(normalizarUrlBase(' https://plataformavirtual.infop.hn/ '), 'https://plataformavirtual.infop.hn');
  assert.equal(normalizarUrlBase('https://campus.example/moodle//'), 'https://campus.example/moodle');
  assert.equal(normalizarUrlBase('http://192.168.11.50:8080', { permitirRedPrivada: true }), 'http://192.168.11.50:8080');
});

test('red: rechaza direcciones peligrosas', () => {
  const malas = [
    'http://campus.example', 'ftp://campus.example', 'file:///etc/passwd', 'javascript:alert(1)',
    'https://usuario:clave@campus.example', 'https://campus.example/?a=1', 'https://campus.example/#x',
    'https://127.0.0.1', 'https://[::1]', 'https://169.254.169.254', 'no es una url', ''
  ];
  for (const url of malas) {
    assert.throws(() => normalizarUrlBase(url), ErrorDeRed, url);
  }
});

test('red: no conecta con la red interna aunque el nombre resuelva alli', async () => {
  const servidor = http.createServer((req, res) => res.end('{"secreto":true}'));
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  try {
    await assert.rejects(
      enviar(`http://localhost:${servidor.address().port}/`, { formulario: {} }),
      (e) => e instanceof ErrorDeRed && e.codigo === 'DESTINO_NO_PERMITIDO');
    const permitido = await enviar(`http://localhost:${servidor.address().port}/`, { formulario: {}, permitirRedPrivada: true });
    assert.deepEqual(permitido, { secreto: true });
  } finally {
    await new Promise((r) => servidor.close(r));
  }
});

test('red: no sigue redirecciones, corta por tiempo y por tamano', async () => {
  const servidor = http.createServer((req, res) => {
    if (req.url === '/redirige') { res.writeHead(302, { Location: 'http://169.254.169.254/' }); return res.end(); }
    if (req.url === '/lento') return;
    if (req.url === '/enorme') { res.writeHead(200); return res.end('x'.repeat(3 * 1024 * 1024)); }
    if (req.url === '/html') { res.writeHead(200); return res.end('<html>'); }
    res.writeHead(500); res.end();
  });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const opciones = { formulario: {}, permitirRedPrivada: true, tiempoMaximoMs: 300 };
  const codigo = (c) => (e) => e instanceof ErrorDeRed && e.codigo === c;
  try {
    await assert.rejects(enviar(`${base}/redirige`, opciones), codigo('REDIRECCION'));
    await assert.rejects(enviar(`${base}/lento`, opciones), codigo('TIEMPO_AGOTADO'));
    await assert.rejects(enviar(`${base}/enorme`, opciones), codigo('RESPUESTA_DEMASIADO_GRANDE'));
    await assert.rejects(enviar(`${base}/html`, opciones), codigo('RESPUESTA_INESPERADA'));
    await assert.rejects(enviar(`${base}/falla`, opciones), codigo('RESPUESTA_INESPERADA'));
    await assert.rejects(enviar('http://127.0.0.1:1/', opciones), codigo('SIN_CONEXION'));
  } finally {
    servidor.closeAllConnections();
    await new Promise((r) => servidor.close(r));
  }
});
