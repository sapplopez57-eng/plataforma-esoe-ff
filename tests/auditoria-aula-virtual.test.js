'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { crearBaseDePrueba, URL_ADMIN } = require('./ayuda');

const sinBase = { skip: URL_ADMIN ? false : 'PRUEBAS_DATABASE_URL no definida' };

async function sembrar(db) {
  const unaFila = async (sql, parametros) => (await db.consultar(sql, parametros)).rows[0].id;

  const institucionId = await unaFila(
    `INSERT INTO instituciones (codigo, siglas, nombre, tipo)
     VALUES ('ESOE-AUD', 'ESOEA', 'Escuela de prueba de auditoria', 'ESCUELA_MILITAR') RETURNING id`);

  const periodoId = await unaFila(
    `INSERT INTO periodos_lectivos (institucion_id, codigo, nombre, modalidad, fecha_inicio, fecha_fin)
     VALUES ($1, 'P-AUD-1', 'Periodo de prueba', 'SEMESTRAL', '2026-01-01', '2026-06-30')
     RETURNING id`, [institucionId]);

  const promocionId = await unaFila(
    `INSERT INTO promociones (institucion_id, codigo, nombre, anio_ingreso, anio_egreso)
     VALUES ($1, 'PR-AUD-1', 'Promocion de prueba', 2026, 2028) RETURNING id`, [institucionId]);

  const materiaId = await unaFila(
    `INSERT INTO materias (institucion_id, codigo, nombre)
     VALUES ($1, 'MAT-AUD-1', 'Materia de prueba') RETURNING id`, [institucionId]);

  const catedraticoId = await unaFila(
    `INSERT INTO catedraticos (institucion_id, dni, nombres, apellidos, titulo)
     VALUES ($1, 'DNI-AUD-C1', 'Catedratico', 'De Prueba', 'Licenciado') RETURNING id`,
    [institucionId]);

  const claseId = await unaFila(
    `INSERT INTO clases (institucion_id, codigo_clase, periodo_id, promocion_id, materia_id,
                         catedratico_id, horario)
     VALUES ($1, 'CL-AUD-1', $2, $3, $4, $5, 'Lunes 08:00') RETURNING id`,
    [institucionId, periodoId, promocionId, materiaId, catedraticoId]);

  const estudianteId = await crearEstudiante(db, institucionId, promocionId, 'A-0001', 'DNI-AUD-1');

  const cursoId = await unaFila(
    `INSERT INTO cursos (institucion_id, clase_id, titulo)
     VALUES ($1, $2, 'Curso de prueba') RETURNING id`, [institucionId, claseId]);

  const tareaId = await unaFila(
    `INSERT INTO tareas (institucion_id, curso_id, titulo, instrucciones, puntaje_maximo, fecha_entrega)
     VALUES ($1, $2, 'Tarea de prueba', 'Instrucciones', 100, '2026-06-01T00:00:00Z') RETURNING id`,
    [institucionId, cursoId]);

  return { institucionId, promocionId, claseId, estudianteId, cursoId, tareaId };
}

async function crearEstudiante(db, institucionId, promocionId, codigo, dni) {
  const { rows } = await db.consultar(
    `INSERT INTO estudiantes (institucion_id, promocion_id, codigo_alumno, dni, nombres, apellidos,
                              fecha_nacimiento)
     VALUES ($1, $2, $3, $4, 'Nombre', 'Apellido', '2000-01-01') RETURNING id`,
    [institucionId, promocionId, codigo, dni]);
  return rows[0].id;
}

async function calificar(db, s, estudianteId, nota) {
  const { rows } = await db.consultar(
    `INSERT INTO entregas (institucion_id, tarea_id, estudiante_id, texto, estado, nota, calificada_en)
     VALUES ($1, $2, $3, 'Entrega', 'CALIFICADA', $4, CURRENT_TIMESTAMP) RETURNING id`,
    [s.institucionId, s.tareaId, estudianteId, nota]);
  return rows[0].id;
}

async function cambios(db, tabla) {
  const { rows } = await db.consultar(
    `SELECT tabla, campo, valor_anterior, valor_nuevo, clase_id, estudiante_id, autor
       FROM auditoria WHERE tabla = $1 ORDER BY cambiado_en, campo`, [tabla]);
  return rows;
}

test('auditoria: calificar una entrega del aula virtual deja rastro', sinBase, async () => {
  const base = await crearBaseDePrueba();
  try {
    const s = await sembrar(base.db);
    const entrega = await base.db.consultar(
      `INSERT INTO entregas (institucion_id, tarea_id, estudiante_id, texto, estado)
       VALUES ($1, $2, $3, 'Mi entrega', 'ENTREGADA') RETURNING id`,
      [s.institucionId, s.tareaId, s.estudianteId]);

    await base.db.consultar(
      `UPDATE entregas SET nota = 90, estado = 'CALIFICADA', calificada_en = CURRENT_TIMESTAMP
        WHERE id = $1`, [entrega.rows[0].id]);

    const nota = (await cambios(base.db, 'entregas')).filter((f) => f.campo === 'nota');
    assert.equal(nota.length, 1, 'la nota debe quedar registrada una vez');
    assert.equal(nota[0].valor_anterior, null);
    assert.equal(Number(nota[0].valor_nuevo), 90);
    assert.equal(nota[0].clase_id, s.claseId, 'el rastro debe resolver la clase del curso');
    assert.equal(nota[0].estudiante_id, s.estudianteId);
  } finally {
    await base.cerrar();
  }
});

test('auditoria: cambiar una nota ya puesta guarda el valor anterior', sinBase, async () => {
  const base = await crearBaseDePrueba();
  try {
    const s = await sembrar(base.db);
    const entregaId = await calificar(base.db, s, s.estudianteId, 90);

    await base.db.consultar('UPDATE entregas SET nota = 40 WHERE id = $1', [entregaId]);

    const nota = (await cambios(base.db, 'entregas')).filter((f) => f.campo === 'nota');
    assert.equal(nota.length, 2, 'la nota inicial y la corregida deben quedar las dos');
    assert.equal(Number(nota[1].valor_anterior), 90);
    assert.equal(Number(nota[1].valor_nuevo), 40);
  } finally {
    await base.cerrar();
  }
});

test('auditoria: bajar el puntaje maximo deja rastro por cada estudiante afectado', sinBase, async () => {
  const base = await crearBaseDePrueba();
  try {
    const s = await sembrar(base.db);
    const otroId = await crearEstudiante(base.db, s.institucionId, s.promocionId, 'A-0002', 'DNI-AUD-2');
    await calificar(base.db, s, s.estudianteId, 30);
    await calificar(base.db, s, otroId, 30);

    await base.db.consultar('UPDATE tareas SET puntaje_maximo = 50 WHERE id = $1', [s.tareaId]);

    const filas = await cambios(base.db, 'tareas');
    assert.equal(filas.length, 2, 'una fila por cada estudiante con entrega en esa tarea');
    for (const fila of filas) {
      assert.equal(fila.campo, 'puntaje_maximo');
      assert.equal(Number(fila.valor_anterior), 100);
      assert.equal(Number(fila.valor_nuevo), 50);
      assert.equal(fila.clase_id, s.claseId);
    }
    assert.deepEqual(filas.map((f) => f.estudiante_id).sort(), [s.estudianteId, otroId].sort());
  } finally {
    await base.cerrar();
  }
});

test('auditoria: un cambio que no toca el puntaje no genera rastro de tarea', sinBase, async () => {
  const base = await crearBaseDePrueba();
  try {
    const s = await sembrar(base.db);
    await calificar(base.db, s, s.estudianteId, 30);

    await base.db.consultar("UPDATE tareas SET titulo = 'Otro titulo' WHERE id = $1", [s.tareaId]);

    assert.deepEqual(await cambios(base.db, 'tareas'), []);
  } finally {
    await base.cerrar();
  }
});

test('auditoria: el rastro del aula virtual tampoco se puede borrar ni modificar', sinBase, async () => {
  const base = await crearBaseDePrueba();
  try {
    const s = await sembrar(base.db);
    await calificar(base.db, s, s.estudianteId, 70);

    await assert.rejects(
      base.db.consultar("UPDATE auditoria SET valor_nuevo = '100' WHERE tabla = 'entregas'"),
      /no se modifica ni se borra/);
    await assert.rejects(
      base.db.consultar("DELETE FROM auditoria WHERE tabla = 'entregas'"),
      /no se modifica ni se borra/);
  } finally {
    await base.cerrar();
  }
});

test('auditoria: el rastro guarda quien califico, no un autor generico', sinBase, async () => {
  const base = await crearBaseDePrueba();
  try {
    const s = await sembrar(base.db);
    const usuario = await base.db.consultar(
      `INSERT INTO usuarios (institucion_id, username, proveedor_id, rol, nombre_completo)
       VALUES ($1, 'catedratico.aud', 'usr_prueba', 'CATEDRATICO', 'Catedratico De Prueba')
       RETURNING id`, [s.institucionId]);
    const usuarioId = usuario.rows[0].id;

    await base.db.transaccion(async (consultar) => {
      await consultar(
        `SELECT set_config('esoe.usuario_id', $1, true), set_config('esoe.autor', $2, true)`,
        [usuarioId, 'api:usr_prueba']);
      await consultar(
        `INSERT INTO entregas (institucion_id, tarea_id, estudiante_id, texto, estado, nota, calificada_en)
         VALUES ($1, $2, $3, 'Entrega', 'CALIFICADA', 80, CURRENT_TIMESTAMP)`,
        [s.institucionId, s.tareaId, s.estudianteId]);
    });

    const nota = (await cambios(base.db, 'entregas')).filter((f) => f.campo === 'nota');
    assert.equal(nota.length, 1);
    assert.equal(nota[0].estudiante_id, s.estudianteId);
    assert.equal(nota[0].autor, 'api:usr_prueba',
      'sin contexto de actor el rastro guardaria un autor generico de base de datos');
    const { rows } = await base.db.consultar(
      "SELECT usuario_id FROM auditoria WHERE tabla = 'entregas' AND campo = 'nota'");
    assert.equal(rows[0].usuario_id, usuarioId, 'el rastro debe decir que usuario califico');
  } finally {
    await base.cerrar();
  }
});

test('auditoria: sin contexto de actor el rastro queda sin usuario, que es lo que se corrigio', sinBase, async () => {
  const base = await crearBaseDePrueba();
  try {
    const s = await sembrar(base.db);
    await calificar(base.db, s, s.estudianteId, 55);

    const { rows } = await base.db.consultar(
      "SELECT usuario_id, autor FROM auditoria WHERE tabla = 'entregas' AND campo = 'nota'");
    assert.equal(rows[0].usuario_id, null);
    assert.match(rows[0].autor, /^sql:/,
      'una escritura fuera del envoltorio de actor cae al autor de base de datos');
  } finally {
    await base.cerrar();
  }
});
