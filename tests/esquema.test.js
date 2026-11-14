'use strict';

// Prueba de integracion del esquema. Requiere un PostgreSQL de pruebas:
//   PRUEBAS_DATABASE_URL=postgresql://usuario:clave@host:5432/postgres
// Sin esa variable la prueba se omite (y el ciclo de verificacion lo reporta).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Client } = require('pg');

const URL_ADMIN = process.env.PRUEBAS_DATABASE_URL;
const omitir = URL_ADMIN ? false : 'PRUEBAS_DATABASE_URL no definida';
const ESQUEMA = fs.readFileSync(path.join(__dirname, '..', 'database', 'schema.sql'), 'utf8');
const NOMBRE_BD = `esoe_prueba_${crypto.randomBytes(6).toString('hex')}`;

let admin;
let db;
const ids = {};

async function uno(sql, params) {
  const { rows } = await db.query(sql, params);
  return rows[0];
}

before(async () => {
  if (omitir) return;
  admin = new Client({ connectionString: URL_ADMIN });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${NOMBRE_BD}`);
  const url = new URL(URL_ADMIN);
  url.pathname = `/${NOMBRE_BD}`;
  db = new Client({ connectionString: url.toString() });
  await db.connect();
  await db.query(ESQUEMA);

  ids.periodo = (await uno(
    `INSERT INTO periodos_lectivos (codigo, nombre, modalidad, fecha_inicio, fecha_fin)
     VALUES ('2026-S1', 'Primer semestre', 'SEMESTRAL', '2026-01-15', '2026-06-15') RETURNING id`)).id;
  ids.promocion = (await uno(
    `INSERT INTO promociones (codigo, nombre, anio_ingreso, anio_egreso)
     VALUES ('P-01', 'Promocion de prueba', 2026, 2028) RETURNING id`)).id;
  ids.materia = (await uno(
    `INSERT INTO materias (codigo, nombre) VALUES ('MAT-101', 'Matematica') RETURNING id`)).id;
  ids.catedratico = (await uno(
    `INSERT INTO catedraticos (dni, nombres, apellidos, titulo)
     VALUES ('0000-0000-00001', 'Docente', 'De Prueba', 'Licenciatura') RETURNING id`)).id;
  ids.otroCatedratico = (await uno(
    `INSERT INTO catedraticos (dni, nombres, apellidos, titulo)
     VALUES ('0000-0000-00002', 'Segundo', 'Docente', 'Licenciatura') RETURNING id`)).id;
  ids.estudiante = (await uno(
    `INSERT INTO estudiantes (codigo_alumno, dni, nombres, apellidos, fecha_nacimiento, promocion_id)
     VALUES ('10001', '0000-0000-10001', 'Alumno', 'De Prueba', '2005-03-01', $1) RETURNING id`,
    [ids.promocion])).id;
  ids.clase = (await uno(
    `INSERT INTO clases (codigo_clase, periodo_id, promocion_id, materia_id, catedratico_id, horario)
     VALUES ('CL-1', $1, $2, $3, $4, 'Lun 08:00') RETURNING id`,
    [ids.periodo, ids.promocion, ids.materia, ids.catedratico])).id;
});

after(async () => {
  if (omitir) return;
  if (db) await db.end();
  await admin.query(`DROP DATABASE IF EXISTS ${NOMBRE_BD} WITH (FORCE)`);
  await admin.end();
});

test('esquema: se aplica completo sobre una base vacia', { skip: omitir }, async () => {
  const { rows } = await db.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1`);
  assert.deepEqual(rows.map((r) => r.table_name), [
    'calificaciones', 'catedraticos', 'clases',
    'cuentas_externas', 'detalle_asistencia', 'estudiantes',
    'materias', 'periodos_lectivos', 'plataformas_externas', 'promociones', 'sesiones_asistencia', 'usuarios'
  ]);
});

test('esquema: solo admite las cuatro modalidades de periodo', { skip: omitir }, async () => {
  const { rows } = await db.query(`SELECT unnest(enum_range(NULL::modalidad_periodo))::text AS m`);
  assert.deepEqual(rows.map((r) => r.m), ['SEMESTRAL', 'CUATRIMESTRAL', 'MODULAR', 'ANUAL']);
  await assert.rejects(db.query(
    `INSERT INTO periodos_lectivos (codigo, nombre, modalidad, fecha_inicio, fecha_fin)
     VALUES ('X', 'X', 'TRIMESTRAL', '2026-01-01', '2026-02-01')`));
});

test('esquema: un unico catedratico titular por clase', { skip: omitir }, async () => {
  await assert.rejects(db.query(
    `INSERT INTO clases (codigo_clase, periodo_id, promocion_id, materia_id, catedratico_id, horario)
     VALUES ('CL-2', $1, $2, $3, $4, 'Mar 08:00')`,
    [ids.periodo, ids.promocion, ids.materia, ids.otroCatedratico]), /duplicate key/);
});

test('esquema: nota final y aprobacion con minimo de 70', { skip: omitir }, async () => {
  const aprobado = await uno(
    `INSERT INTO calificaciones (clase_id, estudiante_id, parcial_1, parcial_2, parcial_3, acumulativo)
     VALUES ($1, $2, 70, 70, 70, 70) RETURNING nota_final, aprobado`, [ids.clase, ids.estudiante]);
  assert.equal(Number(aprobado.nota_final), 70);
  assert.equal(aprobado.aprobado, true);

  const reprobado = await uno(
    `UPDATE calificaciones SET acumulativo = 69.96 WHERE clase_id = $1 AND estudiante_id = $2
     RETURNING nota_final, aprobado`, [ids.clase, ids.estudiante]);
  assert.equal(Number(reprobado.nota_final), 69.99);
  assert.equal(reprobado.aprobado, false);
});

test('esquema: las notas se limitan a la escala 0-100', { skip: omitir }, async () => {
  for (const valor of [-1, 100.01]) {
    await assert.rejects(db.query(
      `UPDATE calificaciones SET parcial_1 = $3 WHERE clase_id = $1 AND estudiante_id = $2`,
      [ids.clase, ids.estudiante, valor]), /check constraint/);
  }
});

test('esquema: una sola sesion de asistencia por clase y fecha', { skip: omitir }, async () => {
  const sesion = await uno(
    `INSERT INTO sesiones_asistencia (clase_id, fecha) VALUES ($1, '2026-02-02') RETURNING id`, [ids.clase]);
  await assert.rejects(db.query(
    `INSERT INTO sesiones_asistencia (clase_id, fecha) VALUES ($1, '2026-02-02')`, [ids.clase]), /duplicate key/);
  await db.query(
    `INSERT INTO detalle_asistencia (sesion_id, estudiante_id, estado) VALUES ($1, $2, 'TARDANZA')`,
    [sesion.id, ids.estudiante]);
  await assert.rejects(db.query(
    `INSERT INTO detalle_asistencia (sesion_id, estudiante_id, estado) VALUES ($1, $2, 'DORMIDO')`,
    [sesion.id, ids.estudiante]));
});

test('esquema: codigo de alumno y DNI no se repiten', { skip: omitir }, async () => {
  await assert.rejects(db.query(
    `INSERT INTO estudiantes (codigo_alumno, dni, nombres, apellidos, fecha_nacimiento, promocion_id)
     VALUES ('10001', '0000-0000-10002', 'Otro', 'Alumno', '2005-01-01', $1)`, [ids.promocion]), /duplicate key/);
  await assert.rejects(db.query(
    `INSERT INTO estudiantes (codigo_alumno, dni, nombres, apellidos, fecha_nacimiento, promocion_id)
     VALUES ('10002', '0000-0000-10001', 'Otro', 'Alumno', '2005-01-01', $1)`, [ids.promocion]), /duplicate key/);
});
