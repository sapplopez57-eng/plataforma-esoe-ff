'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { levantar, firmarSesion, como, ENTORNO_CON_SESION, DOMINIO_CLERK, otrasLlaves } = require('./ayuda');

let app;
before(async () => { app = await levantar(ENTORNO_CON_SESION); });
after(async () => { await app.cerrar(); });

const portador = (token) => ({ Authorization: `Bearer ${token}` });

test('sesion: la configuracion publica no revela secretos', async () => {
  const res = await app.pedir('/api/config');
  assert.equal(res.status, 200);
  const texto = await res.text();
  assert.doesNotMatch(texto, /sk_test_|BEGIN PUBLIC KEY/);
  const cuerpo = JSON.parse(texto);
  assert.equal(cuerpo.autenticacion.proveedor, 'clerk');
  assert.equal(cuerpo.autenticacion.dominio, DOMINIO_CLERK);
  assert.match(cuerpo.autenticacion.llavePublica, /^pk_test_/);
});

test('sesion: sin Clerk configurado la API protegida responde 503', async () => {
  const sinClerk = await levantar();
  try {
    assert.equal((await sinClerk.pedir('/api/config').then((r) => r.json())).autenticacion, null);
    assert.equal((await sinClerk.pedir('/api/sesion', { headers: como('ADMIN') })).status, 503);
    assert.equal((await sinClerk.pedir('/api/integraciones/plataformas')).status, 503);
  } finally {
    await sinClerk.cerrar();
  }
});

test('sesion: una sesion valida devuelve su identidad y su rol', async () => {
  for (const rol of ['ADMIN', 'CATEDRATICO', 'ESTUDIANTE']) {
    const res = await app.pedir('/api/sesion', { headers: como(rol, `user_${rol}`) });
    assert.equal(res.status, 200, rol);
    assert.deepEqual(await res.json(), { usuarioId: `user_${rol}`, rol });
    assert.equal(res.headers.get('cache-control'), 'no-store');
  }
});

test('sesion: se rechaza todo lo que no sea una sesion valida', async () => {
  const hace = Math.floor(Date.now() / 1000) - 3600;
  const [cabecera, cuerpo, firma] = firmarSesion({ rol: 'ESTUDIANTE' }).split('.');
  const cuerpoAlterado = Buffer.from(JSON.stringify({
    ...JSON.parse(Buffer.from(cuerpo, 'base64url').toString()), metadata: { rol: 'ADMIN' }
  })).toString('base64url');
  const sinFirma = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT', cat: 'cl_B7d4PD111AAA' })).toString('base64url')}.${cuerpo}.`;

  const casos = {
    'sin cabecera': {},
    'cabecera vacia': { Authorization: 'Bearer ' },
    'esquema distinto': { Authorization: `Basic ${firmarSesion({ rol: 'ADMIN' })}` },
    'texto cualquiera': portador('no-es-un-token'),
    'vencida': portador(firmarSesion({ rol: 'ADMIN', iat: hace, nbf: hace, exp: hace + 60 })),
    'aun no vigente': portador(firmarSesion({ rol: 'ADMIN', nbf: hace + 7200, exp: hace + 9000 })),
    'firmada por otro': portador(firmarSesion({ rol: 'ADMIN', firmante: otrasLlaves })),
    'emitida para otro sitio': portador(firmarSesion({ rol: 'ADMIN', azp: 'https://sitio-ajeno.example' })),
    'rol alterado tras firmar': portador(`${cabecera}.${cuerpoAlterado}.${firma}`),
    'algoritmo none': portador(sinFirma)
  };
  for (const [nombre, cabeceras] of Object.entries(casos)) {
    const res = await app.pedir('/api/sesion', { headers: cabeceras });
    assert.equal(res.status, 401, nombre);
    assert.deepEqual(await res.json(), { error: 'Debe iniciar sesion.' }, nombre);
  }
});

test('sesion: una cookie de sesion no basta sin la cabecera', async () => {
  const res = await app.pedir('/api/sesion', { headers: { Cookie: `__session=${firmarSesion({ rol: 'ADMIN' })}` } });
  assert.notEqual(res.status, 200);
});

test('sesion: una cuenta sin rol o con rol desconocido no entra', async () => {
  for (const reclamos of [{}, { metadata: { rol: 'SUPERUSUARIO' } }, { metadata: { rol: 'admin' } }, { metadata: 'ADMIN' }]) {
    const res = await app.pedir('/api/sesion', { headers: portador(firmarSesion(reclamos)) });
    assert.equal(res.status, 403, JSON.stringify(reclamos));
  }
});

test('sesion: las respuestas no exponen el diagnostico del proveedor', async () => {
  const res = await app.pedir('/api/sesion', { headers: portador('a.b.c') });
  for (const cabecera of ['x-clerk-auth-reason', 'x-clerk-auth-message', 'x-clerk-auth-status']) {
    assert.equal(res.headers.get(cabecera), null, cabecera);
  }
});

test('sesion: la politica de contenido admite solo el dominio de Clerk configurado', async () => {
  const csp = (await app.pedir('/')).headers.get('content-security-policy');
  assert.match(csp, new RegExp(`script-src 'self' https://${DOMINIO_CLERK.replaceAll('.', '\\.')} https://challenges\\.cloudflare\\.com(;|$)`));
  assert.match(csp, new RegExp(`connect-src 'self' https://${DOMINIO_CLERK.replaceAll('.', '\\.')}(;|$)`));
  assert.doesNotMatch(csp, /script-src [^;]*('unsafe-inline'|'unsafe-eval'|\*)/);
});
