'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { levantar, como, crearBaseDePrueba, ENTORNO_CON_SESION, URL_ADMIN } = require('./ayuda');
const { validarNotas, validarAsistencia, validar } = require('../src/academico/validacion');

const sinBase = URL_ADMIN ? false : { skip: 'Sin PRUEBAS_DATABASE_URL' };

const CUENTA = {
  admin: 'user_cl_admin',
  ana: 'user_cl_ana',
  luis: 'user_cl_luis',
  carla: 'user_cl_carla',
  mario: 'user_cl_mario'
};
const ADMIN = como('ADMIN', CUENTA.admin);
const ANA = como('CATEDRATICO', CUENTA.ana);
const LUIS = como('CATEDRATICO', CUENTA.luis);
const CARLA = como('ESTUDIANTE', CUENTA.carla);

let base;
let servidor;
let d;

const json = async (respuesta) => ({ status: respuesta.status, cuerpo: await respuesta.json() });
const auditoriaDe = async (estudianteId, campo) => (await base.db.consultar(
  `SELECT * FROM auditoria WHERE estudiante_id = $1 AND campo = $2 ORDER BY cambiado_en, id`,
  [estudianteId, campo])).rows;

before(async () => {
  if (!URL_ADMIN) return;
  base = await crearBaseDePrueba();
  const { db } = base;
  const uno = async (sql, params) => (await db.consultar(sql, params)).rows[0];

  const periodo = await uno(`INSERT INTO periodos_lectivos (codigo, nombre, modalidad, fecha_inicio, fecha_fin)
                             VALUES ('CL-P1', 'Periodo', 'SEMESTRAL', '2026-01-10', '2026-06-30') RETURNING id`);
  const promA = await uno(`INSERT INTO promociones (codigo, nombre, anio_ingreso, anio_egreso)
                           VALUES ('CL-A', 'A', 2026, 2028) RETURNING id`);
  const promB = await uno(`INSERT INTO promociones (codigo, nombre, anio_ingreso, anio_egreso)
                           VALUES ('CL-B', 'B', 2025, 2027) RETURNING id`);
  const matUno = await uno(`INSERT INTO materias (codigo, nombre) VALUES ('CL-M1', 'Tactica') RETURNING id`);
  const matDos = await uno(`INSERT INTO materias (codigo, nombre) VALUES ('CL-M2', 'Logistica') RETURNING id`);
  const catUno = await uno(`INSERT INTO catedraticos (dni, nombres, apellidos, titulo)
                            VALUES ('CL-C1', 'Ana', 'Reyes', 'Lic.') RETURNING id`);
  const catDos = await uno(`INSERT INTO catedraticos (dni, nombres, apellidos, titulo)
                            VALUES ('CL-C2', 'Luis', 'Mejia', 'Ing.') RETURNING id`);
  const estUno = await uno(`INSERT INTO estudiantes (codigo_alumno, dni, nombres, apellidos, fecha_nacimiento, promocion_id)
                            VALUES ('CL-E1', 'CL-E1', 'Carla', 'Diaz', '2005-03-01', $1) RETURNING id`, [promA.id]);
  const estTres = await uno(`INSERT INTO estudiantes (codigo_alumno, dni, nombres, apellidos, fecha_nacimiento, promocion_id)
                             VALUES ('CL-E3', 'CL-E3', 'Rosa', 'Zelaya', '2005-09-09', $1) RETURNING id`, [promA.id]);
  const estDos = await uno(`INSERT INTO estudiantes (codigo_alumno, dni, nombres, apellidos, fecha_nacimiento, promocion_id)
                            VALUES ('CL-E2', 'CL-E2', 'Mario', 'Lopez', '2004-07-12', $1) RETURNING id`, [promB.id]);

  const liga = async (proveedor, rol, referencia) => (await db.consultar(
    `INSERT INTO usuarios (username, proveedor_id, rol, nombre_completo, referencia_id)
     VALUES ($1, $2, $3, $1, $4) RETURNING id`, [proveedor.replace('user_cl_', ''), proveedor, rol, referencia])).rows[0].id;
  const usuarios = {
    admin: await liga(CUENTA.admin, 'ADMIN', null),
    ana: await liga(CUENTA.ana, 'CATEDRATICO', catUno.id),
    luis: await liga(CUENTA.luis, 'CATEDRATICO', catDos.id),
    carla: await liga(CUENTA.carla, 'ESTUDIANTE', estUno.id)
  };
  await liga(CUENTA.mario, 'ESTUDIANTE', estDos.id);

  servidor = await levantar(ENTORNO_CON_SESION, { db });

  const { status, cuerpo } = await json(await servidor.enviar('/api/clases', {
    codigo_clase: 'cl-101', periodo_id: periodo.id, promocion_id: promA.id, materia_id: matUno.id,
    catedratico_id: catUno.id, horario: 'L-M 08:00', aula: 'A-1'
  }, ADMIN));
  assert.equal(status, 201, JSON.stringify(cuerpo));
  const claseDos = await uno(`INSERT INTO clases (codigo_clase, periodo_id, promocion_id, materia_id, catedratico_id, horario)
                              VALUES ('CL-202', $1, $2, $3, $4, 'J 10:00') RETURNING id`,
  [periodo.id, promB.id, matDos.id, catDos.id]);

  d = { periodo: periodo.id, promA: promA.id, promB: promB.id, matUno: matUno.id, matDos: matDos.id,
    catUno: catUno.id, catDos: catDos.id, estUno: estUno.id, estDos: estDos.id, estTres: estTres.id,
    claseUno: cuerpo.clase.id, claseDos: claseDos.id, usuarios };
});

after(async () => {
  await servidor?.cerrar();
  await base?.cerrar();
});

const nota = (clase, estudiante, cuerpo, quien) =>
  servidor.enviar(`/api/clases/${clase}/calificaciones/${estudiante}`, cuerpo, quien, 'PUT');

test('clases: modificar una nota deja auditoria con usuario, valor anterior, valor nuevo y fecha', sinBase, async () => {
  assert.equal((await nota(d.claseUno, d.estUno, { parcial_1: 80 }, ANA)).status, 200);
  const antes = Date.now();
  const r = await json(await nota(d.claseUno, d.estUno, { parcial_1: 85.5 }, ANA));
  assert.equal(r.status, 200);
  assert.equal(r.cuerpo.calificacion.parcial_1, '85.50');

  const filas = await auditoriaDe(d.estUno, 'parcial_1');
  const cambio = filas.at(-1);
  assert.equal(cambio.tabla, 'calificaciones');
  assert.equal(cambio.valor_anterior, '80.00');
  assert.equal(cambio.valor_nuevo, '85.50');
  assert.equal(cambio.usuario_id, d.usuarios.ana, 'el usuario local de quien cambio');
  assert.equal(cambio.autor, `api:${CUENTA.ana}`);
  assert.equal(cambio.clase_id, d.claseUno);
  assert.ok(cambio.cambiado_en instanceof Date);
  assert.ok(Math.abs(cambio.cambiado_en.getTime() - antes) < 60_000, 'con la fecha del cambio');

  const historia = await json(await servidor.pedir(`/api/clases/${d.claseUno}/auditoria`, { headers: ADMIN }));
  const visto = historia.cuerpo.cambios.find((c) => c.campo === 'parcial_1' && c.valor_nuevo === '85.50');
  assert.equal(visto.usuario, 'ana');
  assert.equal(visto.valor_anterior, '80.00');
  assert.equal(visto.codigo_alumno, 'CL-E1');
});

test('clases: solo se tocan las notas enviadas; la final la calcula la base y lo igual no se audita', sinBase, async () => {
  await nota(d.claseUno, d.estTres, { parcial_1: 70, parcial_2: 70, parcial_3: 70, acumulativo: 70 }, ANA);
  const filasAntes = (await auditoriaDe(d.estTres, 'parcial_2')).length;
  const r = await json(await nota(d.claseUno, d.estTres, { parcial_1: 69.99, parcial_2: 70 }, ANA));
  assert.equal(r.cuerpo.calificacion.parcial_3, '70.00', 'lo no enviado no cambia');
  assert.equal(r.cuerpo.calificacion.nota_final, '70.00');
  assert.equal(r.cuerpo.calificacion.aprobado, true);
  assert.equal((await auditoriaDe(d.estTres, 'parcial_2')).length, filasAntes, 'un valor igual no deja fila');
  const bajo = await json(await nota(d.claseUno, d.estTres, { parcial_2: 60 }, ANA));
  assert.equal(bajo.cuerpo.calificacion.aprobado, false);

  const lista = await json(await servidor.pedir(`/api/clases/${d.claseUno}/calificaciones`, { headers: ANA }));
  assert.equal(lista.status, 200);
  const porId = Object.fromEntries(lista.cuerpo.calificaciones.map((c) => [c.estudiante_id, c]));
  assert.ok(porId[d.estTres] && porId[d.estUno], 'aparecen todos los de la promocion');
  assert.ok(!porId[d.estDos], 'y nadie de otra promocion');
});

test('clases: la auditoria tambien registra cambios hechos por fuera de la API', sinBase, async () => {
  await base.db.consultar('UPDATE calificaciones SET acumulativo = 99 WHERE clase_id = $1 AND estudiante_id = $2',
    [d.claseUno, d.estTres]);
  const cambio = (await auditoriaDe(d.estTres, 'acumulativo')).at(-1);
  assert.equal(cambio.valor_nuevo, '99.00');
  assert.equal(cambio.usuario_id, null);
  assert.match(cambio.autor, /^sql:/);
});

test('clases: la auditoria no se puede modificar ni borrar', sinBase, async () => {
  await assert.rejects(base.db.consultar(`UPDATE auditoria SET valor_nuevo = '100.00'`), /no se modifica ni se borra/);
  await assert.rejects(base.db.consultar('DELETE FROM auditoria'), /no se modifica ni se borra/);
  assert.ok((await base.db.consultar('SELECT count(*)::int AS n FROM auditoria')).rows[0].n > 0);
});

test('clases: si la transaccion falla, no queda ni el cambio ni su auditoria', sinBase, async () => {
  const contar = async () => (await base.db.consultar('SELECT count(*)::int AS n FROM auditoria')).rows[0].n;
  const antes = await contar();
  await assert.rejects(base.db.transaccion(async (consultar) => {
    await consultar('UPDATE calificaciones SET parcial_3 = 1 WHERE clase_id = $1 AND estudiante_id = $2',
      [d.claseUno, d.estTres]);
    throw new Error('falla a proposito');
  }), /falla a proposito/);
  assert.equal(await contar(), antes);
  const { rows } = await base.db.consultar('SELECT parcial_3 FROM calificaciones WHERE estudiante_id = $1', [d.estTres]);
  assert.equal(rows[0].parcial_3, '70.00');
});

test('clases: solo el titular o la administracion ponen notas', sinBase, async () => {
  assert.equal((await nota(d.claseUno, d.estUno, { parcial_2: 90 }, LUIS)).status, 403, 'otro catedratico no');
  assert.equal((await nota(d.claseUno, d.estUno, { parcial_2: 100 }, CARLA)).status, 403, 'el estudiante no');
  assert.equal((await nota(d.claseUno, d.estUno, { parcial_2: 90 })).status, 401);
  const admin = await json(await nota(d.claseUno, d.estUno, { parcial_2: 90 }, ADMIN));
  assert.equal(admin.status, 200);
  assert.equal((await auditoriaDe(d.estUno, 'parcial_2')).at(-1).usuario_id, d.usuarios.admin);
  assert.equal((await nota(d.claseUno, d.estDos, { parcial_1: 50 }, ANA)).status, 404, 'alguien que no esta en la clase');
  assert.equal((await nota(d.claseUno, 'x', { parcial_1: 50 }, ANA)).status, 404);
  assert.equal((await servidor.pedir(`/api/clases/${d.claseUno}/auditoria`, { headers: LUIS })).status, 403);
  assert.equal((await servidor.pedir(`/api/clases/${d.claseUno}/calificaciones`, { headers: CARLA })).status, 403);
});

test('clases: una nota fuera de escala, con tres decimales o como texto responde 422', sinBase, async () => {
  const r = await json(await nota(d.claseUno, d.estUno,
    { parcial_1: 101, parcial_2: 80.555, parcial_3: '90', nota_final: 100 }, ANA));
  assert.equal(r.status, 422);
  assert.match(r.cuerpo.campos.parcial_1, /entre 0 y 100/);
  assert.match(r.cuerpo.campos.parcial_2, /dos decimales/);
  assert.match(r.cuerpo.campos.parcial_3, /numero/);
  assert.equal(r.cuerpo.campos.nota_final, 'Campo no admitido.', 'la final no se escribe a mano');
  assert.equal((await nota(d.claseUno, d.estUno, {}, ANA)).status, 422);
});

test('clases: el titular registra asistencia y corregirla deja auditoria', sinBase, async () => {
  const primera = await json(await servidor.enviar(`/api/clases/${d.claseUno}/asistencia`, {
    fecha: '2026-02-10', tema_impartido: 'Introduccion',
    registros: [{ estudiante_id: d.estUno, estado: 'PRESENTE' }, { estudiante_id: d.estTres, estado: 'TARDANZA', observacion: '10 min' }]
  }, ANA));
  assert.equal(primera.status, 201);
  assert.equal(primera.cuerpo.sesion.fecha, '2026-02-10');
  assert.equal(primera.cuerpo.registros, 2);

  const correccion = await json(await servidor.enviar(`/api/clases/${d.claseUno}/asistencia`, {
    fecha: '2026-02-10', registros: [{ estudiante_id: d.estUno, estado: 'AUSENTE' }]
  }, ANA));
  assert.equal(correccion.status, 200, 'el mismo dia corrige, no duplica');
  assert.equal(correccion.cuerpo.sesion.tema_impartido, 'Introduccion', 'el tema se conserva');

  const cambio = (await auditoriaDe(d.estUno, 'estado')).at(-1);
  assert.equal(cambio.tabla, 'detalle_asistencia');
  assert.equal(cambio.valor_anterior, 'PRESENTE');
  assert.equal(cambio.valor_nuevo, 'AUSENTE');
  assert.equal(cambio.usuario_id, d.usuarios.ana);
  assert.equal(cambio.clase_id, d.claseUno);

  const lista = await json(await servidor.pedir(`/api/clases/${d.claseUno}/asistencia`, { headers: ANA }));
  const deCarla = lista.cuerpo.registros.find((r) => r.estudiante_id === d.estUno);
  assert.equal(deCarla.estado, 'AUSENTE');
  const { rows } = await base.db.consultar('SELECT registrado_por FROM sesiones_asistencia WHERE clase_id = $1', [d.claseUno]);
  assert.equal(rows[0].registrado_por, d.usuarios.ana);
});

test('clases: la asistencia rechaza fechas fuera del periodo, futuras y estudiantes ajenos', sinBase, async () => {
  const enviar = (cuerpo, quien = ANA) => servidor.enviar(`/api/clases/${d.claseUno}/asistencia`, cuerpo, quien);
  const registros = [{ estudiante_id: d.estUno, estado: 'PRESENTE' }];
  const fuera = await json(await enviar({ fecha: '2026-08-01', registros }));
  assert.equal(fuera.status, 422);
  assert.match(fuera.cuerpo.campos.fecha, /Fuera del periodo/);
  const futura = await json(await enviar({ fecha: '2099-01-01', registros }));
  assert.match(futura.cuerpo.campos.fecha, /futuro/);
  const ajeno = await json(await enviar({ fecha: '2026-02-11', registros: [...registros, { estudiante_id: d.estDos, estado: 'PRESENTE' }] }));
  assert.equal(ajeno.status, 422);
  assert.match(ajeno.cuerpo.campos['registros[1].estudiante_id'], /promocion/);
  const repetido = await json(await enviar({ fecha: '2026-02-11', registros: [...registros, ...registros] }));
  assert.match(repetido.cuerpo.campos['registros[1].estudiante_id'], /repetido/);
  assert.equal((await enviar({ fecha: '2026-02-11', registros }, LUIS)).status, 403);
  assert.equal((await enviar({ fecha: '2026-02-11', registros }, CARLA)).status, 403);
  const nada = await base.db.consultar(`SELECT 1 FROM sesiones_asistencia WHERE fecha = '2026-02-11'`);
  assert.equal(nada.rows.length, 0, 'nada rechazado llego a la base');
});

test('clases: la administracion crea y reasigna clases; los demas no', sinBase, async () => {
  const base1 = { periodo_id: d.periodo, promocion_id: d.promB, materia_id: d.matUno, catedratico_id: d.catUno, horario: 'V 07:00' };
  assert.equal((await servidor.enviar('/api/clases', { ...base1, codigo_clase: 'CL-X' }, ANA)).status, 403);
  const nueva = await json(await servidor.enviar('/api/clases', { ...base1, codigo_clase: 'CL-303' }, ADMIN));
  assert.equal(nueva.status, 201);
  const repetida = await json(await servidor.enviar('/api/clases', { ...base1, codigo_clase: 'CL-304' }, ADMIN));
  assert.equal(repetida.status, 409);
  assert.ok(repetida.cuerpo.campos.materia_id);
  const libre = { ...base1, promocion_id: d.promA, materia_id: d.matDos };
  const codigo = await json(await servidor.enviar('/api/clases', { ...libre, codigo_clase: 'cl-303' }, ADMIN));
  assert.deepEqual(codigo.cuerpo.campos, { codigo_clase: 'Ya existe.' });
  const fantasma = await json(await servidor.enviar('/api/clases',
    { ...libre, codigo_clase: 'CL-305', catedratico_id: '11111111-1111-4111-8111-111111111111' }, ADMIN));
  assert.equal(fantasma.status, 422);
  assert.deepEqual(fantasma.cuerpo.campos, { catedratico_id: 'No existe.' });

  const clase = nueva.cuerpo.clase.id;
  assert.equal((await nota(clase, d.estDos, { parcial_1: 75 }, ANA)).status, 200);
  const reasignada = await json(await servidor.enviar(`/api/clases/${clase}`, { catedratico_id: d.catDos }, ADMIN, 'PUT'));
  assert.equal(reasignada.cuerpo.clase.catedratico_id, d.catDos);
  assert.equal((await nota(clase, d.estDos, { parcial_1: 76 }, ANA)).status, 403);
  assert.equal((await nota(clase, d.estDos, { parcial_1: 76 }, LUIS)).status, 200);
  assert.equal((await servidor.enviar(`/api/clases/${clase}`, { horario: 'X' }, LUIS, 'PUT')).status, 403);
  assert.equal((await servidor.enviar('/api/clases/no-uuid', { horario: 'X' }, ADMIN, 'PUT')).status, 404);
  assert.equal((await servidor.enviar('/api/clases/11111111-1111-4111-8111-111111111111', { horario: 'X' }, ADMIN, 'PUT')).status, 404);
  assert.equal((await servidor.enviar(`/api/clases/${clase}`, { materia_id: d.matUno, promocion_id: d.promA }, ADMIN, 'PUT')).status, 409);
});

test('clases: validacion de notas y asistencia sin base', () => {
  assert.deepEqual(validarNotas({ parcial_1: 0, acumulativo: 100, parcial_2: 99.99 }).campos, {});
  assert.ok(validarNotas([1]).campos._cuerpo);
  assert.ok(validarNotas({ parcial_1: Number.NaN }).campos.parcial_1);
  assert.ok(validarNotas({ parcial_1: -0.01 }).campos.parcial_1);
  assert.ok(validarAsistencia(null).campos._cuerpo);
  const malo = validarAsistencia({ fecha: '2026-02-30', registros: [], extra: 1 }).campos;
  assert.ok(malo.fecha && malo.registros && malo.extra);
  const muchos = Array.from({ length: 301 }, () => ({ estudiante_id: '11111111-1111-4111-8111-111111111111', estado: 'PRESENTE' }));
  assert.match(validarAsistencia({ fecha: '2026-02-10', registros: muchos }).campos.registros, /hasta 300/);
  const raro = validarAsistencia({ fecha: '2026-02-10', registros: [null, { estudiante_id: 'x' },
    { estudiante_id: '11111111-1111-4111-8111-111111111111', estado: 'DORMIDO' },
    { estudiante_id: '22222222-2222-4222-8222-222222222222', estado: 'EXCUSA', hora: 1 },
    { estudiante_id: '33333333-3333-4333-8333-333333333333', estado: 'EXCUSA', observacion: 'x'.repeat(256) }] }).campos;
  assert.deepEqual(Object.keys(raro).sort(), ['registros[0]', 'registros[1].estudiante_id', 'registros[2].estado',
    'registros[3].hora', 'registros[4].observacion']);
  assert.ok(validarAsistencia({ fecha: '2026-02-10', tema_impartido: 5, registros: [] }).campos.tema_impartido);
  assert.deepEqual(Object.keys(validar('clase', {}).campos).sort(),
    ['catedratico_id', 'codigo_clase', 'horario', 'materia_id', 'periodo_id', 'promocion_id']);
});

test('clases: la asistencia de un estudiante la ven el, quien le da clase y la administracion', sinBase, async () => {
  const ruta = `/api/estudiantes/${d.estUno}/asistencia`;
  const propia = await json(await servidor.pedir(ruta, { headers: CARLA }));
  assert.equal(propia.status, 200);
  assert.ok(propia.cuerpo.asistencia.some((a) => a.clase_id === d.claseUno && a.fecha === '2026-02-10' && a.estado === 'AUSENTE'));
  const titular = await json(await servidor.pedir(ruta, { headers: ANA }));
  assert.equal(titular.status, 200);
  assert.ok(titular.cuerpo.asistencia.every((a) => a.clase_id === d.claseUno), 'solo de las clases que imparte');
  assert.equal((await servidor.pedir(ruta, { headers: LUIS })).status, 403, 'quien no le da clase no la ve');
  assert.equal((await servidor.pedir(`/api/estudiantes/${d.estDos}/asistencia`, { headers: CARLA })).status, 403);
  assert.equal((await servidor.pedir(ruta, { headers: ADMIN })).status, 200);
  assert.equal((await servidor.pedir(ruta)).status, 401);
});
