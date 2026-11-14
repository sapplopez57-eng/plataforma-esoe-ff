'use strict';

// Conexion con otras plataformas, de punta a punta: API real, base de datos real
// y un Moodle de imitacion. Requiere PRUEBAS_DATABASE_URL.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  levantar, como, crearBaseDePrueba, crearMoodleFalso, ENTORNO_CON_SESION, URL_ADMIN
} = require('./ayuda');

const omitir = URL_ADMIN ? false : 'PRUEBAS_DATABASE_URL no definida';
const RUTA = '/api/integraciones';
const NO_EXISTE = '11111111-1111-4111-8111-111111111111';

let app;
let base;
let moodle;
let plataformaId;

before(async () => {
  if (omitir) return;
  base = await crearBaseDePrueba();
  moodle = await crearMoodleFalso();
  app = await levantar(ENTORNO_CON_SESION, { db: base.db });
});

after(async () => {
  if (omitir) return;
  await app.cerrar();
  await moodle.cerrar();
  await base.cerrar();
});

test('integraciones: todo exige sesion', { skip: omitir }, async () => {
  const rutas = [
    ['GET', '/catalogo'], ['GET', '/plataformas'], ['POST', '/plataformas'], ['GET', '/mis-cursos'],
    ['POST', `/plataformas/${NO_EXISTE}/probar`], ['DELETE', `/plataformas/${NO_EXISTE}`],
    ['POST', `/plataformas/${NO_EXISTE}/cuenta`], ['DELETE', `/plataformas/${NO_EXISTE}/cuenta`]
  ];
  for (const [metodo, ruta] of rutas) {
    const res = await app.enviar(RUTA + ruta, metodo === 'GET' ? undefined : {}, {}, metodo);
    assert.equal(res.status, 401, `${metodo} ${ruta}`);
  }
});

test('integraciones: solo administracion gestiona plataformas', { skip: omitir }, async () => {
  for (const rol of ['CATEDRATICO', 'ESTUDIANTE']) {
    const cabeceras = como(rol);
    assert.equal((await app.pedir(`${RUTA}/catalogo`, { headers: cabeceras })).status, 403, rol);
    assert.equal((await app.enviar(`${RUTA}/plataformas`, { nombre: 'X', tipo: 'MOODLE', urlBase: moodle.url }, cabeceras)).status, 403, rol);
    assert.equal((await app.enviar(`${RUTA}/plataformas/${NO_EXISTE}/probar`, {}, cabeceras)).status, 403, rol);
    assert.equal((await app.enviar(`${RUTA}/plataformas/${NO_EXISTE}`, undefined, cabeceras, 'DELETE')).status, 403, rol);
  }
  assert.equal(moodle.estado.peticiones.length, 0, 'no debe haberse contactado la plataforma');
});

test('integraciones: el catalogo ofrece las plataformas de INFOP', { skip: omitir }, async () => {
  const { plataformas } = await app.pedir(`${RUTA}/catalogo`, { headers: como('ADMIN') }).then((r) => r.json());
  assert.deepEqual(plataformas.map((p) => p.urlBase), [
    'https://plataformavirtual.infop.hn', 'https://academias.infop.hn'
  ]);
  assert.ok(plataformas.every((p) => p.tipo === 'MOODLE'));
});

test('integraciones: valida los datos al registrar una plataforma', { skip: omitir }, async () => {
  const admin = como('ADMIN');
  const casos = [
    [{ tipo: 'MOODLE', urlBase: moodle.url }, 'nombre'],
    [{ nombre: 'x'.repeat(121), tipo: 'MOODLE', urlBase: moodle.url }, 'nombre'],
    [{ nombre: 'Campus', tipo: 'CANVAS', urlBase: moodle.url }, 'tipo'],
    [{ nombre: 'Campus', tipo: 'MOODLE', urlBase: 'ftp://campus.example' }, 'urlBase'],
    [{ nombre: 'Campus', tipo: 'MOODLE', urlBase: 'https://u:c@campus.example' }, 'urlBase'],
    [{ nombre: 'Campus', tipo: 'MOODLE' }, 'urlBase']
  ];
  for (const [cuerpo, campo] of casos) {
    const res = await app.enviar(`${RUTA}/plataformas`, cuerpo, admin);
    assert.equal(res.status, 422, JSON.stringify(cuerpo));
    assert.equal((await res.json()).campo, campo);
  }
});

test('integraciones: no registra un sitio que no es Moodle o sin servicios web', { skip: omitir }, async () => {
  const admin = como('ADMIN');
  const noMoodle = await app.enviar(`${RUTA}/plataformas`, { nombre: 'Otro', tipo: 'MOODLE', urlBase: app.base }, admin);
  assert.equal(noMoodle.status, 502);

  const apagado = await crearMoodleFalso({ serviciosWeb: false });
  try {
    const res = await app.enviar(`${RUTA}/plataformas`, { nombre: 'Apagado', tipo: 'MOODLE', urlBase: apagado.url }, admin);
    assert.equal(res.status, 422);
    assert.match((await res.json()).error, /servicios web/);
  } finally {
    await apagado.cerrar();
  }
});

test('integraciones: administracion registra y prueba una plataforma', { skip: omitir }, async () => {
  const admin = como('ADMIN', 'user_admin');
  const res = await app.enviar(`${RUTA}/plataformas`, { nombre: ' Campus de pruebas ', tipo: 'moodle', urlBase: `${moodle.url}/` }, admin);
  assert.equal(res.status, 201);
  const cuerpo = await res.json();
  assert.equal(cuerpo.plataforma.nombre, 'Campus de pruebas');
  assert.equal(cuerpo.plataforma.urlBase, moodle.url);
  assert.equal(cuerpo.sitio.nombre, 'Moodle de pruebas');
  plataformaId = cuerpo.plataforma.id;

  const repetida = await app.enviar(`${RUTA}/plataformas`, { nombre: 'Otra vez', tipo: 'MOODLE', urlBase: moodle.url }, admin);
  assert.equal(repetida.status, 409);

  const prueba = await app.enviar(`${RUTA}/plataformas/${plataformaId}/probar`, {}, admin);
  assert.equal(prueba.status, 200);
  assert.equal((await prueba.json()).disponible, true);

  assert.equal((await app.enviar(`${RUTA}/plataformas/${NO_EXISTE}/probar`, {}, admin)).status, 404);
  assert.equal((await app.enviar(`${RUTA}/plataformas/no-es-uuid/probar`, {}, admin)).status, 404);
});

test('integraciones: credenciales incorrectas no vinculan nada', { skip: omitir }, async () => {
  const alumno = como('ESTUDIANTE', 'user_alumno');
  const res = await app.enviar(`${RUTA}/plataformas/${plataformaId}/cuenta`, { usuario: 'alumno.prueba', clave: 'equivocada' }, alumno);
  assert.equal(res.status, 422);
  assert.equal((await res.json()).codigo, 'CREDENCIAL_RECHAZADA');
  assert.equal((await app.enviar(`${RUTA}/plataformas/${plataformaId}/cuenta`, { usuario: 'alumno.prueba' }, alumno)).status, 422);
  assert.equal((await app.enviar(`${RUTA}/plataformas/${NO_EXISTE}/cuenta`, { usuario: 'a', clave: 'b' }, alumno)).status, 404);

  const { rows } = await base.db.consultar('SELECT count(*)::int AS n FROM cuentas_externas');
  assert.equal(rows[0].n, 0);
});

test('integraciones: un alumno vincula su cuenta y ve sus cursos', { skip: omitir }, async () => {
  const alumno = como('ESTUDIANTE', 'user_alumno');
  const res = await app.enviar(`${RUTA}/plataformas/${plataformaId}/cuenta`, { usuario: 'alumno.prueba', clave: 'Clave-Correcta-1' }, alumno);
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), { vinculada: true, cuenta: 'Alumno De Prueba' });

  const lista = await app.pedir(`${RUTA}/plataformas`, { headers: alumno }).then((r) => r.json());
  assert.deepEqual(lista.plataformas.map((p) => [p.nombre, p.vinculada, p.cuenta]), [['Campus de pruebas', true, 'Alumno De Prueba']]);

  const cursos = await app.pedir(`${RUTA}/mis-cursos`, { headers: alumno }).then((r) => r.json());
  assert.equal(cursos.plataformas.length, 1);
  assert.equal(cursos.plataformas[0].estado, 'OK');
  assert.deepEqual(cursos.plataformas[0].cursos.map((c) => [c.codigo, c.avance, c.completado, c.calificacion]), [
    ['ELEC-1', 62, false, null], ['OFI-2', 100, true, '95.00']
  ]);
  assert.equal(cursos.plataformas[0].cursos[0].enlace, `${moodle.url}/course/view.php?id=7`);
  assert.equal(cursos.plataformas[0].cursos[0].fin, null);
});

test('integraciones: la contrasena no se guarda y el token queda cifrado', { skip: omitir }, async () => {
  const { rows } = await base.db.consultar('SELECT * FROM cuentas_externas');
  assert.equal(rows.length, 1);
  const volcado = JSON.stringify(rows);
  assert.doesNotMatch(volcado, /Clave-Correcta-1/);
  assert.doesNotMatch(volcado, /tok-alumno-42/);
  assert.match(rows[0].token_cifrado, /^v1\./);
});

test('integraciones: las credenciales nunca viajan en la URL ni se devuelven', { skip: omitir }, async () => {
  for (const peticion of moodle.estado.peticiones) {
    assert.doesNotMatch(peticion.consulta, /wstoken|password|tok-alumno|Clave-Correcta/, peticion.ruta);
  }
  const alumno = como('ESTUDIANTE', 'user_alumno');
  for (const ruta of ['/plataformas', '/mis-cursos']) {
    const texto = await app.pedir(RUTA + ruta, { headers: alumno }).then((r) => r.text());
    assert.doesNotMatch(texto, /tok-alumno-42|token|v1\./, ruta);
  }
});

test('integraciones: cada usuario ve solo su propia cuenta', { skip: omitir }, async () => {
  const otro = como('ESTUDIANTE', 'user_otro');
  const lista = await app.pedir(`${RUTA}/plataformas`, { headers: otro }).then((r) => r.json());
  assert.deepEqual(lista.plataformas.map((p) => [p.vinculada, p.cuenta]), [[false, null]]);
  const cursos = await app.pedir(`${RUTA}/mis-cursos`, { headers: otro }).then((r) => r.json());
  assert.deepEqual(cursos.plataformas, []);

  await app.enviar(`${RUTA}/plataformas/${plataformaId}/cuenta`, undefined, otro, 'DELETE');
  const { rows } = await base.db.consultar('SELECT usuario_id FROM cuentas_externas');
  assert.deepEqual(rows.map((r) => r.usuario_id), ['user_alumno'], 'desvincular no debe afectar a otro usuario');
});

test('integraciones: una plataforma caida o un token revocado no rompen la consulta', { skip: omitir }, async () => {
  const alumno = como('ESTUDIANTE', 'user_alumno');

  moodle.estado.caido = true;
  let res = await app.pedir(`${RUTA}/mis-cursos`, { headers: alumno });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).plataformas[0].estado, 'NO_DISPONIBLE');
  assert.equal((await app.enviar(`${RUTA}/plataformas/${plataformaId}/probar`, {}, como('ADMIN'))).status, 502);
  moodle.estado.caido = false;

  moodle.estado.tokensRevocados.add('tok-alumno-42');
  res = await app.pedir(`${RUTA}/mis-cursos`, { headers: alumno });
  assert.deepEqual((await res.json()).plataformas.map((p) => [p.estado, p.cursos.length]), [['REVINCULAR', 0]]);
  moodle.estado.tokensRevocados.clear();
});

test('integraciones: limite de intentos de vinculacion por usuario', { skip: omitir }, async () => {
  const insistente = como('ESTUDIANTE', 'user_insistente');
  const estados = [];
  for (let i = 0; i < 12; i += 1) {
    const res = await app.enviar(`${RUTA}/plataformas/${plataformaId}/cuenta`, { usuario: 'alumno.prueba', clave: `intento-${i}` }, insistente);
    estados.push(res.status);
  }
  assert.deepEqual(estados, [...Array(10).fill(422), 429, 429]);
  const otro = await app.enviar(`${RUTA}/plataformas/${plataformaId}/cuenta`, { usuario: 'alumno.prueba', clave: 'x' }, como('ESTUDIANTE', 'user_tranquilo'));
  assert.equal(otro.status, 422, 'el limite es por usuario');
});

test('integraciones: desvincular y eliminar', { skip: omitir }, async () => {
  const alumno = como('ESTUDIANTE', 'user_alumno');
  assert.equal((await app.enviar(`${RUTA}/plataformas/${plataformaId}/cuenta`, undefined, alumno, 'DELETE')).status, 204);
  assert.deepEqual((await app.pedir(`${RUTA}/mis-cursos`, { headers: alumno }).then((r) => r.json())).plataformas, []);

  await app.enviar(`${RUTA}/plataformas/${plataformaId}/cuenta`, { usuario: 'alumno.prueba', clave: 'Clave-Correcta-1' }, alumno);
  assert.equal((await app.enviar(`${RUTA}/plataformas/${plataformaId}`, undefined, como('ADMIN'), 'DELETE')).status, 204);
  assert.equal((await app.enviar(`${RUTA}/plataformas/${plataformaId}`, undefined, como('ADMIN'), 'DELETE')).status, 404);
  const { rows } = await base.db.consultar('SELECT count(*)::int AS n FROM cuentas_externas');
  assert.equal(rows[0].n, 0, 'eliminar la plataforma borra sus cuentas vinculadas');
});

test('integraciones: sin clave de cifrado el modulo queda desactivado', { skip: omitir }, async () => {
  const entorno = { ...ENTORNO_CON_SESION };
  delete entorno.CLAVE_CIFRADO;
  const sinClave = await levantar(entorno, { db: base.db });
  try {
    assert.equal((await sinClave.pedir(`${RUTA}/plataformas`, { headers: como('ADMIN') })).status, 503);
    assert.equal((await sinClave.pedir('/api/config').then((r) => r.json())).integraciones, false);
  } finally {
    await sinClave.cerrar();
  }
});
