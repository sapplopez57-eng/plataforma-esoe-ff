'use strict';

/* SEC-06. Pertenencia, no solo rol.
   El rol dice que clase de cosas puede hacer una cuenta; la pertenencia dice
   sobre cuales. Esta prueba recorre la matriz rol x ruta con dos catedraticos y
   dos estudiantes reales en la base, y comprueba que cada uno llega a lo suyo y
   a nada mas. */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { levantar, como, crearBaseDePrueba, ENTORNO_CON_SESION, URL_ADMIN } = require('./ayuda');

const sinBase = URL_ADMIN ? false : { skip: 'Sin PRUEBAS_DATABASE_URL' };

let base;
let servidor;
let d = {};   // identificadores del escenario

// Cuentas del proveedor. Cada una se liga a un expediente en la tabla usuarios.
const CUENTA = {
  admin: 'user_admin',
  catedraticoUno: 'user_cat_1',
  catedraticoDos: 'user_cat_2',
  estudianteUno: 'user_est_1',
  estudianteDos: 'user_est_2',
  sinExpediente: 'user_suelto',
  inactiva: 'user_inactivo'
};

before(async () => {
  if (!URL_ADMIN) return;
  base = await crearBaseDePrueba();
  const { db } = base;
  const uno = async (sql, params) => (await db.consultar(sql, params)).rows[0];

  const periodo = await uno(
    `INSERT INTO periodos_lectivos (codigo, nombre, modalidad, fecha_inicio, fecha_fin)
     VALUES ('P-2026', 'Periodo 2026', 'SEMESTRAL', '2026-01-15', '2026-06-30') RETURNING id`);

  const promA = await uno(
    `INSERT INTO promociones (codigo, nombre, anio_ingreso, anio_egreso)
     VALUES ('PR-A', 'Promocion A', 2026, 2029) RETURNING id`);
  const promB = await uno(
    `INSERT INTO promociones (codigo, nombre, anio_ingreso, anio_egreso)
     VALUES ('PR-B', 'Promocion B', 2026, 2029) RETURNING id`);

  const matA = await uno(
    `INSERT INTO materias (codigo, nombre) VALUES ('MAT-A', 'Tactica') RETURNING id`);
  const matB = await uno(
    `INSERT INTO materias (codigo, nombre) VALUES ('MAT-B', 'Logistica') RETURNING id`);

  const catUno = await uno(
    `INSERT INTO catedraticos (dni, nombres, apellidos, titulo)
     VALUES ('0801-1', 'Ana', 'Gomez', 'Licenciada') RETURNING id`);
  const catDos = await uno(
    `INSERT INTO catedraticos (dni, nombres, apellidos, titulo)
     VALUES ('0801-2', 'Luis', 'Perez', 'Ingeniero') RETURNING id`);

  // Un estudiante por promocion, para que cada catedratico alcance a uno solo.
  const estUno = await uno(
    `INSERT INTO estudiantes (codigo_alumno, dni, nombres, apellidos, fecha_nacimiento, promocion_id)
     VALUES ('A-001', '0501-1', 'Carla', 'Diaz', '2005-03-01', $1) RETURNING id`, [promA.id]);
  const estDos = await uno(
    `INSERT INTO estudiantes (codigo_alumno, dni, nombres, apellidos, fecha_nacimiento, promocion_id)
     VALUES ('B-001', '0501-2', 'Mario', 'Lopez', '2004-07-12', $1) RETURNING id`, [promB.id]);

  // Clase de cada catedratico, en la promocion de su estudiante.
  const claseUno = await uno(
    `INSERT INTO clases (codigo_clase, periodo_id, promocion_id, materia_id, catedratico_id, horario)
     VALUES ('CL-1', $1, $2, $3, $4, 'L-M 08:00') RETURNING id`,
    [periodo.id, promA.id, matA.id, catUno.id]);
  const claseDos = await uno(
    `INSERT INTO clases (codigo_clase, periodo_id, promocion_id, materia_id, catedratico_id, horario)
     VALUES ('CL-2', $1, $2, $3, $4, 'J-V 10:00') RETURNING id`,
    [periodo.id, promB.id, matB.id, catDos.id]);

  const sesion = await uno(
    `INSERT INTO sesiones_asistencia (clase_id, fecha, tema_impartido)
     VALUES ($1, '2026-02-10', 'Introduccion') RETURNING id`, [claseUno.id]);
  await db.consultar(
    `INSERT INTO detalle_asistencia (sesion_id, estudiante_id, estado) VALUES ($1, $2, 'PRESENTE')`,
    [sesion.id, estUno.id]);

  await db.consultar(
    `INSERT INTO calificaciones (clase_id, estudiante_id, parcial_1, parcial_2, parcial_3, acumulativo)
     VALUES ($1, $2, 80, 75, 90, 85)`, [claseUno.id, estUno.id]);
  await db.consultar(
    `INSERT INTO calificaciones (clase_id, estudiante_id, parcial_1, parcial_2, parcial_3, acumulativo)
     VALUES ($1, $2, 60, 55, 50, 40)`, [claseDos.id, estDos.id]);

  const liga = (username, proveedor, rol, referencia, activo = true) => db.consultar(
    `INSERT INTO usuarios (username, proveedor_id, rol, nombre_completo, referencia_id, activo)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [username, proveedor, rol, username, referencia, activo]);

  await liga('admin', CUENTA.admin, 'ADMIN', null);
  await liga('ana', CUENTA.catedraticoUno, 'CATEDRATICO', catUno.id);
  await liga('luis', CUENTA.catedraticoDos, 'CATEDRATICO', catDos.id);
  await liga('carla', CUENTA.estudianteUno, 'ESTUDIANTE', estUno.id);
  await liga('mario', CUENTA.estudianteDos, 'ESTUDIANTE', estDos.id);
  await liga('inactivo', CUENTA.inactiva, 'ESTUDIANTE', estDos.id, false);
  // CUENTA.sinExpediente a proposito no tiene fila en usuarios.

  d = {
    claseUno: claseUno.id, claseDos: claseDos.id,
    estUno: estUno.id, estDos: estDos.id,
    catUno: catUno.id, catDos: catDos.id
  };

  servidor = await levantar(ENTORNO_CON_SESION, { db });
});

after(async () => {
  if (servidor) await servidor.cerrar();
  if (base) await base.cerrar();
});

// --- El criterio de aceptacion, literal ------------------------------------

test('permisos: un catedratico que pide una clase que no imparte recibe 403', sinBase, async () => {
  const propia = await servidor.pedir(`/api/clases/${d.claseUno}/asistencia`, { headers: como('CATEDRATICO', CUENTA.catedraticoUno) });
  assert.equal(propia.status, 200, 'su propia clase si');

  const ajena = await servidor.pedir(`/api/clases/${d.claseDos}/asistencia`, { headers: como('CATEDRATICO', CUENTA.catedraticoUno) });
  assert.equal(ajena.status, 403);
  const cuerpo = await ajena.json();
  assert.equal(cuerpo.codigo, 'NO_ES_SUYO');
  assert.ok(!JSON.stringify(cuerpo).includes('CL-2'), 'la respuesta no revela nada de la clase ajena');
});

test('permisos: un estudiante que pide el boletin de otro recibe 403', sinBase, async () => {
  const propio = await servidor.pedir(`/api/estudiantes/${d.estUno}/boletin`, { headers: como('ESTUDIANTE', CUENTA.estudianteUno) });
  assert.equal(propio.status, 200);
  const { calificaciones } = await propio.json();
  assert.equal(calificaciones.length, 1);
  assert.equal(Number(calificaciones[0].nota_final), 82.5);

  const ajeno = await servidor.pedir(`/api/estudiantes/${d.estDos}/boletin`, { headers: como('ESTUDIANTE', CUENTA.estudianteUno) });
  assert.equal(ajeno.status, 403);
  assert.equal((await ajeno.json()).codigo, 'NO_ES_SUYO');
});

test('permisos: sin sesion, toda ruta de /api salvo salud y configuracion responde 401', sinBase, async () => {
  const publicas = ['/api/health', '/api/config'];
  for (const ruta of publicas) {
    assert.equal((await servidor.pedir(ruta)).status, 200, `${ruta} es publica`);
  }

  const protegidas = [
    '/api/sesion',
    '/api/clases',
    `/api/clases/${d.claseUno}/asistencia`,
    `/api/estudiantes/${d.estUno}/boletin`,
    '/api/integraciones/plataformas',
    '/api/integraciones/mis-cursos'
  ];
  for (const ruta of protegidas) {
    assert.equal((await servidor.pedir(ruta)).status, 401, `${ruta} sin sesion`);
  }

  // Una cookie no sustituye a la cabecera: asi un sitio ajeno no dispara nada.
  const conCookie = await servidor.pedir('/api/clases', { headers: { Cookie: '__session=cualquiera' } });
  assert.equal(conCookie.status, 401);
});

// --- Matriz rol x ruta ------------------------------------------------------

test('permisos: la matriz rol x ruta no deja ningun hueco', sinBase, async () => {
  const casos = [
    // [descripcion, ruta, cuenta, rol, estado esperado]
    ['admin ve la asistencia de cualquier clase', `/api/clases/${d.claseDos}/asistencia`, CUENTA.admin, 'ADMIN', 200],
    ['admin ve el boletin de cualquier estudiante', `/api/estudiantes/${d.estDos}/boletin`, CUENTA.admin, 'ADMIN', 200],
    ['catedratico ve el boletin de su alumno', `/api/estudiantes/${d.estUno}/boletin`, CUENTA.catedraticoUno, 'CATEDRATICO', 200],
    ['catedratico no ve el boletin de un alumno ajeno', `/api/estudiantes/${d.estDos}/boletin`, CUENTA.catedraticoUno, 'CATEDRATICO', 403],
    ['estudiante no ve la asistencia de una clase completa', `/api/clases/${d.claseUno}/asistencia`, CUENTA.estudianteUno, 'ESTUDIANTE', 403],
    ['estudiante no ve la asistencia ni de su propia promocion', `/api/clases/${d.claseUno}/asistencia`, CUENTA.estudianteUno, 'ESTUDIANTE', 403],
    ['una cuenta sin expediente no es dueña de nada', `/api/estudiantes/${d.estUno}/boletin`, CUENTA.sinExpediente, 'ESTUDIANTE', 403],
    ['una cuenta desactivada no consulta nada', `/api/estudiantes/${d.estDos}/boletin`, CUENTA.inactiva, 'ESTUDIANTE', 403]
  ];

  const fallos = [];
  for (const [descripcion, ruta, cuenta, rol, esperado] of casos) {
    const r = await servidor.pedir(ruta, { headers: como(rol, cuenta) });
    if (r.status !== esperado) fallos.push(`${descripcion}: esperaba ${esperado}, dio ${r.status}`);
  }
  assert.deepEqual(fallos, [], `\n${fallos.join('\n')}\n`);
});

test('permisos: una cuenta sin expediente y una desactivada se distinguen', sinBase, async () => {
  const suelta = await servidor.pedir('/api/clases', { headers: como('ESTUDIANTE', CUENTA.sinExpediente) });
  assert.equal(suelta.status, 403);
  assert.equal((await suelta.json()).codigo, 'SIN_EXPEDIENTE');

  const apagada = await servidor.pedir('/api/clases', { headers: como('ESTUDIANTE', CUENTA.inactiva) });
  assert.equal(apagada.status, 403);
  assert.equal((await apagada.json()).codigo, 'CUENTA_INACTIVA');
});

test('permisos: cada rol ve en /api/clases solo lo que le toca', sinBase, async () => {
  const lista = async (cuenta, rol) => (await (await servidor.pedir('/api/clases', { headers: como(rol, cuenta) })).json()).clases;

  assert.deepEqual((await lista(CUENTA.admin, 'ADMIN')).map((c) => c.codigo_clase), ['CL-1', 'CL-2']);
  assert.deepEqual((await lista(CUENTA.catedraticoUno, 'CATEDRATICO')).map((c) => c.codigo_clase), ['CL-1']);
  assert.deepEqual((await lista(CUENTA.catedraticoDos, 'CATEDRATICO')).map((c) => c.codigo_clase), ['CL-2']);
  // un estudiante ve las clases de su promocion, no las de otra
  assert.deepEqual((await lista(CUENTA.estudianteUno, 'ESTUDIANTE')).map((c) => c.codigo_clase), ['CL-1']);
  assert.deepEqual((await lista(CUENTA.estudianteDos, 'ESTUDIANTE')).map((c) => c.codigo_clase), ['CL-2']);
});

test('permisos: un identificador que no es UUID no llega a la base', sinBase, async () => {
  // Sin esta comprobacion, PostgreSQL responderia con un error de tipo y el
  // servidor devolveria 500, revelando que la consulta se intento.
  for (const malo of ['x', '1 OR 1=1', '../../etc/passwd', '00000000-0000-0000-0000-00000000000']) {
    const clase = await servidor.pedir(`/api/clases/${encodeURIComponent(malo)}/asistencia`, { headers: como('ADMIN', CUENTA.admin) });
    assert.ok([403, 404].includes(clase.status), `clase ${malo} dio ${clase.status}`);
    const est = await servidor.pedir(`/api/estudiantes/${encodeURIComponent(malo)}/boletin`, { headers: como('ADMIN', CUENTA.admin) });
    assert.ok([403, 404].includes(est.status), `estudiante ${malo} dio ${est.status}`);
  }

  // un UUID bien formado que no existe no debe dar 500 ni decir si existe
  const inexistente = '11111111-1111-4111-8111-111111111111';
  assert.equal((await servidor.pedir(`/api/clases/${inexistente}/asistencia`, { headers: como('CATEDRATICO', CUENTA.catedraticoUno) })).status, 403);
});

// --- Guardian: una ruta nueva no puede quedarse sin sesion -----------------

// Rutas publicas a proposito. Agregar una aqui es una decision consciente que
// queda escrita; olvidarse de proteger una, no.
const PUBLICAS = new Set(['/api/health', '/api/config']);

// Recorre las rutas que una aplicacion de Express tiene registradas y devuelve
// las de /api cuyo primer manejador no es un guardian. Por convencion todo
// guardian se llama `exigirSesion` o empieza por `guardianDe`, asi que ninguno
// puede ser una funcion anonima.
function rutasSinGuardian(app) {
  const sinGuardian = [];
  const recorrer = (pila, prefijo) => {
    for (const capa of pila) {
      if (capa.route) {
        const ruta = prefijo + capa.route.path;
        if (!ruta.startsWith('/api') || PUBLICAS.has(ruta)) continue;
        const manejadores = capa.route.stack.map((s) => s.name);
        if (!manejadores.some((n) => /^(exigirSesion|guardianDe)/.test(n))) {
          sinGuardian.push(`${ruta} -> ${manejadores.join(', ') || '(anonimos)'}`);
        }
      } else if (capa.handle && capa.handle.stack) {
        const trozo = capa.regexp && capa.regexp.source
          .replace('^\\/', '/').replace('\\/?(?=\\/|$)', '').replace(/\\\//g, '/').replace(/\$$/, '');
        recorrer(capa.handle.stack, trozo && trozo.startsWith('/') ? trozo : prefijo);
      }
    }
  };
  recorrer(app._router ? app._router.stack : app.router.stack, '');
  return sinGuardian;
}

test('permisos: ninguna ruta de /api queda registrada sin guardian de sesion', sinBase, async () => {
  const { crearApp } = require('../src/app');
  const { cargarConfig } = require('../src/config');
  const app = crearApp(cargarConfig({ NODE_ENV: 'test', ...ENTORNO_CON_SESION }), { db: base.db });

  const sinGuardian = rutasSinGuardian(app);
  assert.deepEqual(sinGuardian, [],
    `Rutas de /api sin guardian:\n${sinGuardian.join('\n')}\n`
    + 'Agregale el guardian, o si debe ser publica agregala a PUBLICAS en esta prueba.');
});

test('permisos: sin base de datos las consultas academicas no existen y no se tragan /api', async () => {
  // Un atrapatodo montado en /api devolveria 503 para cualquier ruta
  // desconocida, incluida una que no tiene nada que ver.
  const sinDb = await levantar(ENTORNO_CON_SESION, { db: null });
  try {
    for (const ruta of ['/api/clases', '/api/estudiantes/x/boletin', '/api/lo-que-sea']) {
      const r = await sinDb.pedir(ruta, { headers: como('ADMIN', CUENTA.admin) });
      assert.equal(r.status, 404, `${ruta} debe dar 404, no 503`);
      assert.equal((await r.json()).error, 'Recurso no encontrado.');
    }
    assert.equal((await sinDb.pedir('/api/health')).status, 200);
  } finally {
    await sinDb.cerrar();
  }
});

test('permisos: el guardian de rutas falla cuando debe', () => {
  // Una comprobacion que no se puede ver fallar no protege nada (leccion L-018).
  const express = require('express');

  const descuidada = express();
  descuidada.get('/api/notas/:id', (req, res) => res.json({}));
  assert.deepEqual(rutasSinGuardian(descuidada), ['/api/notas/:id -> <anonymous>']);

  // un manejador anonimo despues del guardian no es un problema
  const correcta = express();
  correcta.get('/api/notas/:id', function exigirSesion(req, res, next) { next(); }, (req, res) => res.json({}));
  assert.deepEqual(rutasSinGuardian(correcta), []);

  // tampoco lo es una ruta montada dentro de un router
  const anidada = express();
  const router = express.Router();
  router.get('/suelta', (req, res) => res.json({}));
  anidada.use('/api/cosas', router);
  assert.deepEqual(rutasSinGuardian(anidada), ['/api/cosas/suelta -> <anonymous>']);

  // y lo que esta fuera de /api no se revisa
  const fuera = express();
  fuera.get('/salud', (req, res) => res.json({}));
  assert.deepEqual(rutasSinGuardian(fuera), []);
});
