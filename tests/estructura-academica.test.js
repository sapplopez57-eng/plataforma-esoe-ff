'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { levantar, como, crearBaseDePrueba, ENTORNO_CON_SESION, URL_ADMIN } = require('./ayuda');
const { validar, fechaValida } = require('../src/academico/validacion');

const sinBase = URL_ADMIN ? false : { skip: 'Sin PRUEBAS_DATABASE_URL' };
let base;
let servidor;
const ADMIN = como('ADMIN', 'user_admin');

const PERIODO = { codigo: 'p-2026-i', nombre: 'Primer semestre 2026', modalidad: 'SEMESTRAL', fecha_inicio: '2026-01-15', fecha_fin: '2026-06-30' };

before(async () => {
  if (!URL_ADMIN) return;
  base = await crearBaseDePrueba();
  for (const [cuenta, rol] of [['user_admin', 'ADMIN'], ['user_est', 'ESTUDIANTE']]) {
    await base.db.consultar(
      `INSERT INTO usuarios (username, proveedor_id, rol, nombre_completo) VALUES ($1, $1, $2, $1)`,
      [cuenta, rol]);
  }
  servidor = await levantar(ENTORNO_CON_SESION, { db: base.db });
});
after(async () => {
  await servidor?.cerrar();
  await base?.cerrar();
});

test('estructura: un periodo con modalidad no admitida responde 422 nombrando el campo', sinBase, async () => {
  const r = await servidor.enviar('/api/periodos', { ...PERIODO, modalidad: 'TRIMESTRAL' }, ADMIN);
  assert.equal(r.status, 422);
  const cuerpo = await r.json();
  assert.match(cuerpo.campos.modalidad, /no admitida/);
  assert.deepEqual(Object.keys(cuerpo.campos), ['modalidad']);
});

test('estructura: un periodo con fechas invertidas responde 422 nombrando el campo', sinBase, async () => {
  const r = await servidor.enviar('/api/periodos', { ...PERIODO, fecha_inicio: '2026-06-30', fecha_fin: '2026-01-15' }, ADMIN);
  assert.equal(r.status, 422);
  assert.match((await r.json()).campos.fecha_fin, /posterior/);
  const mismaFecha = await servidor.enviar('/api/periodos', { ...PERIODO, fecha_fin: PERIODO.fecha_inicio }, ADMIN);
  assert.equal(mismaFecha.status, 422, 'un periodo de cero dias tampoco sirve');
});

test('estructura: la administracion crea un periodo y cualquier sesion lo consulta', sinBase, async () => {
  const r = await servidor.enviar('/api/periodos', PERIODO, ADMIN);
  assert.equal(r.status, 201);
  const { periodo } = await r.json();
  assert.equal(periodo.codigo, 'P-2026-I', 'el codigo se guarda en mayusculas');
  assert.equal(periodo.fecha_inicio, '2026-01-15', 'la fecha vuelve tal cual, sin zona horaria');
  const lista = await servidor.pedir('/api/periodos', { headers: como('ESTUDIANTE', 'user_est') });
  assert.equal(lista.status, 200);
  assert.ok((await lista.json()).periodos.some((p) => p.id === periodo.id));
});

test('estructura: un codigo repetido responde 409, no 500', sinBase, async () => {
  await servidor.enviar('/api/materias', { codigo: 'TAC-101', nombre: 'Tactica' }, ADMIN);
  const r = await servidor.enviar('/api/materias', { codigo: 'tac-101', nombre: 'Otra' }, ADMIN);
  assert.equal(r.status, 409);
  assert.equal((await r.json()).campos.codigo, 'Ya existe.');
});

test('estructura: editar valida contra lo guardado, no solo contra lo enviado', sinBase, async () => {
  const { periodo } = await (await servidor.enviar('/api/periodos', { ...PERIODO, codigo: 'P-EDIT' }, ADMIN)).json();
  const malo = await servidor.enviar(`/api/periodos/${periodo.id}`, { fecha_fin: '2025-12-31' }, ADMIN, 'PUT');
  assert.equal(malo.status, 422);
  assert.match((await malo.json()).campos.fecha_fin, /posterior/);
  const bien = await servidor.enviar(`/api/periodos/${periodo.id}`, { nombre: 'Renombrado', activo: false }, ADMIN, 'PUT');
  assert.equal(bien.status, 200);
  const { periodo: cambiado } = await bien.json();
  assert.equal(cambiado.nombre, 'Renombrado');
  assert.equal(cambiado.activo, false);
});

test('estructura: promociones y materias validan sus propias reglas', sinBase, async () => {
  const prom = await servidor.enviar('/api/promociones', { codigo: 'PROM-1', nombre: 'Promocion 1', anio_ingreso: 2026, anio_egreso: 2025 }, ADMIN);
  assert.equal(prom.status, 422);
  assert.match((await prom.json()).campos.anio_egreso, /anterior/);
  const larga = await servidor.enviar('/api/promociones', { codigo: 'PROM-2', nombre: 'Larga', anio_ingreso: 2026, anio_egreso: 2040 }, ADMIN);
  assert.equal(larga.status, 422);
  const mat = await servidor.enviar('/api/materias', { codigo: 'LOG-1', nombre: 'Logistica', unidades_valorativas: 0 }, ADMIN);
  assert.equal(mat.status, 422);
  assert.match((await mat.json()).campos.unidades_valorativas, /entre 1 y 20/);
  const ok = await servidor.enviar('/api/promociones', { codigo: 'PROM-3', nombre: 'Promocion XLII', anio_ingreso: 2026, anio_egreso: 2028 }, ADMIN);
  assert.equal(ok.status, 201);
});

test('estructura: solo la administracion escribe; sin sesion, 401', sinBase, async () => {
  for (const rol of ['CATEDRATICO', 'ESTUDIANTE']) {
    const r = await servidor.enviar('/api/materias', { codigo: 'X-1', nombre: 'X' }, como(rol, `user_${rol}`));
    assert.equal(r.status, 403, `${rol} no debe crear`);
  }
  assert.equal((await servidor.enviar('/api/materias', { codigo: 'X-1', nombre: 'X' })).status, 401);
  assert.equal((await servidor.pedir('/api/materias')).status, 401);
});

test('estructura: campos ajenos, tipos falsos e identificadores raros no llegan a la base', sinBase, async () => {
  const ajeno = await servidor.enviar('/api/materias', { codigo: 'M-9', nombre: 'Nueve', id: '11111111-1111-4111-8111-111111111111' }, ADMIN);
  assert.equal(ajeno.status, 422);
  assert.equal((await ajeno.json()).campos.id, 'Campo no admitido.');
  const tipo = await servidor.enviar('/api/promociones', { codigo: 'P-9', nombre: 'Nueve', anio_ingreso: '2026', anio_egreso: 2027 }, ADMIN);
  assert.equal(tipo.status, 422, 'un anio como texto no se convierte a escondidas');
  const inyeccion = await servidor.enviar('/api/materias', { codigo: "M'; DROP TABLE materias;--", nombre: 'X' }, ADMIN);
  assert.equal(inyeccion.status, 422);
  for (const id of ['x', '1 OR 1=1', '11111111-1111-4111-8111-111111111111']) {
    const r = await servidor.enviar(`/api/materias/${encodeURIComponent(id)}`, { nombre: 'Y' }, ADMIN, 'PUT');
    assert.equal(r.status, 404, `${id} debe dar 404`);
  }
  assert.equal((await servidor.pedir('/api/materias', { headers: ADMIN })).status, 200, 'la tabla sigue ahi');
});

test('estructura: la base sostiene las mismas reglas aunque se escriba sin la API', sinBase, async () => {
  await assert.rejects(base.db.consultar(
    `INSERT INTO periodos_lectivos (codigo, nombre, modalidad, fecha_inicio, fecha_fin)
     VALUES ('P-SQL', 'Directo', 'ANUAL', '2026-12-01', '2026-01-01')`), /periodo_fechas_en_orden/);
  await assert.rejects(base.db.consultar(
    `INSERT INTO promociones (codigo, nombre, anio_ingreso, anio_egreso) VALUES ('PR-SQL', 'Directo', 2030, 2020)`), /promocion_anios_en_orden/);
  await assert.rejects(base.db.consultar(
    `INSERT INTO materias (codigo, nombre, horas_semanales) VALUES ('M-SQL', 'Directo', 0)`), /materia_horas_validas/);
});

test('estructura: las fechas imposibles no pasan por validas', () => {
  assert.equal(fechaValida('2026-02-30'), false);
  assert.equal(fechaValida('2026-13-01'), false);
  assert.equal(fechaValida('15/01/2026'), false);
  assert.equal(fechaValida('2028-02-29'), true);
  const { campos } = validar('periodo', { ...PERIODO, fecha_inicio: '2026-02-30' });
  assert.ok(campos.fecha_inicio);
  assert.equal(campos.fecha_fin, undefined, 'no se compara una fecha que ya es invalida');
});

test('estructura: faltan obligatorios al crear, no al editar', () => {
  assert.deepEqual(Object.keys(validar('materia', {}).campos).sort(), ['codigo', 'nombre']);
  assert.deepEqual(validar('materia', { nombre: 'Solo nombre' }, { parcial: true }).campos, {});
  assert.ok(validar('materia', {}, { parcial: true }).campos._cuerpo, 'una edicion vacia no hace nada');
  assert.ok(validar('materia', [1, 2]).campos._cuerpo);
});
