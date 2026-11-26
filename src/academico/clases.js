'use strict';

const express = require('express');
const { validar, validarNotas, validarAsistencia, NOTAS } = require('./validacion');
const { esUuid } = require('../permisos');
const { crearActorAuditado } = require('../actor-auditado');

const LECTURA_CLASE = `id, codigo_clase, periodo_id, promocion_id, materia_id, catedratico_id,
                       horario, aula, activa`;
const COLUMNAS_CLASE = ['codigo_clase', 'periodo_id', 'promocion_id', 'materia_id', 'catedratico_id',
  'horario', 'aula', 'activa'];
const LIMITE_AUDITORIA = 500;

const rechazar = (res, campos) => res.status(422).json({ error: 'Hay datos que corregir.', campos });

function traducirErrorDeClase(error) {
  const restriccion = String(error?.constraint || '');
  if (error?.code === '23505' && restriccion.includes('codigo_clase')) {
    return [409, { error: 'Ese codigo ya existe.', campos: { codigo_clase: 'Ya existe.' } }];
  }
  if (error?.code === '23505') {
    return [409, { error: 'Esa materia ya tiene clase para esa promocion en ese periodo.',
      campos: { materia_id: 'Ya tiene clase para esa promocion en ese periodo.' } }];
  }
  if (error?.code === '23503') {
    const campo = ['periodo_id', 'promocion_id', 'materia_id', 'catedratico_id'].find((c) => restriccion.includes(c));
    if (campo) return [422, { error: 'Hay datos que corregir.', campos: { [campo]: 'No existe.' } }];
  }
  return null;
}

function crearRutasDeClases({ auth, db, permisos }) {
  const rutas = express.Router();
  if (!db) return rutas;

  const { resolverVinculo, exigirClasePropia } = permisos;
  const titularOAdministracion = [auth.exigirSesion, resolverVinculo, exigirClasePropia('id')];
  const soloAdministracion = [auth.exigirRol('ADMIN'), resolverVinculo];
  const privado = (res) => res.set('Cache-Control', 'no-store');

  const comoUsuario = crearActorAuditado(db);

  rutas.post('/clases', ...soloAdministracion, async (req, res, next) => {
    const { datos, campos } = validar('clase', req.body);
    if (Object.keys(campos).length) return rechazar(res, campos);
    const nombres = Object.keys(datos).filter((c) => COLUMNAS_CLASE.includes(c));
    try {
      const { rows } = await db.consultar(
        `INSERT INTO clases (institucion_id, ${nombres.join(', ')})
         VALUES ($1, ${nombres.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING ${LECTURA_CLASE}`,
        [req.vinculo.institucionId, ...nombres.map((c) => datos[c])]
      );
      res.status(201).json({ clase: rows[0] });
    } catch (error) {
      const traducido = traducirErrorDeClase(error);
      if (traducido) return res.status(traducido[0]).json(traducido[1]);
      next(error);
    }
  });

  rutas.put('/clases/:id', ...soloAdministracion, async (req, res, next) => {
    if (!esUuid(req.params.id)) return res.status(404).json({ error: 'Clase no encontrada.' });
    try {
      const existente = await db.consultar(
        `SELECT ${LECTURA_CLASE} FROM clases WHERE id = $1 AND institucion_id = $2`,
        [req.params.id, req.vinculo.institucionId]);
      if (!existente.rows.length) return res.status(404).json({ error: 'Clase no encontrada.' });
      const { datos, campos } = validar('clase', req.body, { parcial: true, actual: existente.rows[0] });
      if (Object.keys(campos).length) return rechazar(res, campos);
      const nombres = Object.keys(datos).filter((c) => COLUMNAS_CLASE.includes(c));
      const { rows } = await db.consultar(
        `UPDATE clases SET ${nombres.map((c, i) => `${c} = $${i + 2}`).join(', ')}
          WHERE id = $1 RETURNING ${LECTURA_CLASE}`,
        [req.params.id, ...nombres.map((c) => datos[c])]
      );
      res.json({ clase: rows[0] });
    } catch (error) {
      const traducido = traducirErrorDeClase(error);
      if (traducido) return res.status(traducido[0]).json(traducido[1]);
      next(error);
    }
  });

  rutas.post('/clases/:id/asistencia', ...titularOAdministracion, async (req, res, next) => {
    const { datos, campos } = validarAsistencia(req.body);
    if (Object.keys(campos).length) return rechazar(res, campos);
    try {
      const { rows: [clase] } = await db.consultar(
        `SELECT c.promocion_id, to_char(p.fecha_inicio, 'YYYY-MM-DD') AS inicio,
                to_char(p.fecha_fin, 'YYYY-MM-DD') AS fin
           FROM clases c JOIN periodos_lectivos p ON p.id = c.periodo_id
          WHERE c.id = $1`, [req.params.id]);
      if (!clase) return res.status(404).json({ error: 'Clase no encontrada.' });
      if (datos.fecha < clase.inicio || datos.fecha > clase.fin) {
        return rechazar(res, { fecha: `Fuera del periodo de la clase (${clase.inicio} a ${clase.fin}).` });
      }
      const ids = datos.registros.map((r) => r.estudiante_id);
      const { rows: delGrupo } = await db.consultar(
        'SELECT id FROM estudiantes WHERE id = ANY($1::uuid[]) AND promocion_id = $2', [ids, clase.promocion_id]);
      const validos = new Set(delGrupo.map((e) => e.id));
      const ajenos = {};
      ids.forEach((id, i) => {
        if (!validos.has(id)) ajenos[`registros[${i}].estudiante_id`] = 'No pertenece a la promocion de esta clase.';
      });
      if (Object.keys(ajenos).length) return rechazar(res, ajenos);

      const resultado = await comoUsuario(req, async (consultar) => {
        const { rows: [sesion] } = await consultar(
          `INSERT INTO sesiones_asistencia (clase_id, fecha, tema_impartido, registrado_por)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (clase_id, fecha) DO UPDATE
              SET tema_impartido = COALESCE(EXCLUDED.tema_impartido, sesiones_asistencia.tema_impartido)
           RETURNING id, to_char(fecha, 'YYYY-MM-DD') AS fecha, tema_impartido, (xmax = 0) AS nueva`,
          [req.params.id, datos.fecha, datos.tema_impartido, req.vinculo.usuarioLocalId]);
        await consultar(
          `INSERT INTO detalle_asistencia (sesion_id, estudiante_id, estado, observacion)
           SELECT $1, r.estudiante_id, r.estado, r.observacion
             FROM unnest($2::uuid[], $3::estado_asistencia[], $4::text[]) AS r(estudiante_id, estado, observacion)
           ON CONFLICT (sesion_id, estudiante_id) DO UPDATE
              SET estado = EXCLUDED.estado, observacion = EXCLUDED.observacion`,
          [sesion.id, ids, datos.registros.map((r) => r.estado), datos.registros.map((r) => r.observacion)]);
        return sesion;
      });
      const { nueva, ...sesion } = resultado;
      privado(res).status(nueva ? 201 : 200).json({ sesion, registros: ids.length });
    } catch (error) {
      next(error);
    }
  });

  rutas.get('/clases/:id/calificaciones', ...titularOAdministracion, async (req, res, next) => {
    try {
      const { rows } = await db.consultar(
        `SELECT e.id AS estudiante_id, e.codigo_alumno, e.nombres, e.apellidos,
                g.parcial_1, g.parcial_2, g.parcial_3, g.acumulativo, g.nota_final, g.aprobado,
                g.actualizado_en
           FROM clases c
           JOIN estudiantes e ON e.promocion_id = c.promocion_id
           LEFT JOIN calificaciones g ON g.clase_id = c.id AND g.estudiante_id = e.id
          WHERE c.id = $1
          ORDER BY e.apellidos, e.nombres`, [req.params.id]);
      privado(res).json({ claseId: req.params.id, calificaciones: rows });
    } catch (error) {
      next(error);
    }
  });

  rutas.put('/clases/:id/calificaciones/:estudianteId', ...titularOAdministracion, async (req, res, next) => {
    const { estudianteId } = req.params;
    if (!esUuid(estudianteId)) return res.status(404).json({ error: 'El estudiante no esta en esta clase.' });
    const { datos, campos } = validarNotas(req.body);
    if (Object.keys(campos).length) return rechazar(res, campos);
    try {
      const { rows: enLaClase } = await db.consultar(
        `SELECT 1 FROM clases c JOIN estudiantes e ON e.promocion_id = c.promocion_id
          WHERE c.id = $1 AND e.id = $2`, [req.params.id, estudianteId]);
      if (!enLaClase.length) return res.status(404).json({ error: 'El estudiante no esta en esta clase.' });

      const nombres = NOTAS.filter((n) => n in datos);
      const calificacion = await comoUsuario(req, async (consultar) => {
        const { rows } = await consultar(
          `INSERT INTO calificaciones (clase_id, estudiante_id, ${nombres.join(', ')})
           VALUES ($1, $2, ${nombres.map((_, i) => `$${i + 3}`).join(', ')})
           ON CONFLICT (clase_id, estudiante_id) DO UPDATE
              SET ${nombres.map((n) => `${n} = EXCLUDED.${n}`).join(', ')}, actualizado_en = CURRENT_TIMESTAMP
           RETURNING clase_id, estudiante_id, parcial_1, parcial_2, parcial_3, acumulativo,
                     nota_final, aprobado, actualizado_en`,
          [req.params.id, estudianteId, ...nombres.map((n) => datos[n])]);
        return rows[0];
      });
      privado(res).json({ calificacion });
    } catch (error) {
      next(error);
    }
  });

  rutas.get('/clases/:id/auditoria', ...titularOAdministracion, async (req, res, next) => {
    try {
      const { rows } = await db.consultar(
        `SELECT a.tabla, a.campo, a.valor_anterior, a.valor_nuevo, a.cambiado_en,
                a.usuario_id, u.username AS usuario, a.autor,
                a.estudiante_id, e.codigo_alumno
           FROM auditoria a
           LEFT JOIN usuarios u ON u.id = a.usuario_id
           LEFT JOIN estudiantes e ON e.id = a.estudiante_id
          WHERE a.clase_id = $1
          ORDER BY a.cambiado_en DESC, a.id
          LIMIT ${LIMITE_AUDITORIA}`, [req.params.id]);
      privado(res).json({ claseId: req.params.id, cambios: rows });
    } catch (error) {
      next(error);
    }
  });

  return rutas;
}

module.exports = { crearRutasDeClases };
