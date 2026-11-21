'use strict';

const express = require('express');

function crearRutasAcademicas({ auth, db, permisos }) {
  const rutas = express.Router();

  if (!db) return rutas;

  const { resolverVinculo, exigirClasePropia, exigirEstudiantePropio } = permisos;
  const conSesion = [auth.exigirSesion, resolverVinculo];

  rutas.get('/clases', ...conSesion, async (req, res, next) => {
    try {
      const { rol } = req.identidad;
      const base = `SELECT c.id, c.codigo_clase, c.horario, c.aula,
                           c.periodo_id, c.promocion_id, c.materia_id, c.catedratico_id,
                           m.codigo AS materia_codigo, m.nombre AS materia_nombre,
                           p.codigo AS promocion_codigo
                      FROM clases c
                      JOIN materias m ON m.id = c.materia_id
                      JOIN promociones p ON p.id = c.promocion_id
                     WHERE c.activa = TRUE AND c.institucion_id = $1`;
      let consulta = `${base} ORDER BY c.codigo_clase`;
      let parametros = [req.vinculo.institucionId];
      if (rol === 'CATEDRATICO') {
        consulta = `${base} AND c.catedratico_id = $2 ORDER BY c.codigo_clase`;
        parametros = [req.vinculo.institucionId, req.vinculo.referenciaId];
      } else if (rol === 'ESTUDIANTE') {
        consulta = `${base} AND c.promocion_id = (SELECT promocion_id FROM estudiantes WHERE id = $2)
                    ORDER BY c.codigo_clase`;
        parametros = [req.vinculo.institucionId, req.vinculo.referenciaId];
      }
      const { rows } = await db.consultar(consulta, parametros);
      res.set('Cache-Control', 'no-store');
      res.json({ clases: rows });
    } catch (error) {
      next(error);
    }
  });

  rutas.get('/clases/:id/asistencia', ...conSesion, exigirClasePropia('id'), async (req, res, next) => {
    try {
      const { rows } = await db.consultar(
        `SELECT s.id AS sesion_id, to_char(s.fecha, 'YYYY-MM-DD') AS fecha, s.tema_impartido,
                d.estudiante_id, d.estado, d.observacion,
                e.codigo_alumno, e.nombres, e.apellidos
           FROM sesiones_asistencia s
           LEFT JOIN detalle_asistencia d ON d.sesion_id = s.id
           LEFT JOIN estudiantes e ON e.id = d.estudiante_id
          WHERE s.clase_id = $1
          ORDER BY s.fecha DESC, e.apellidos, e.nombres`,
        [req.params.id]
      );
      res.set('Cache-Control', 'no-store');
      res.json({ claseId: req.params.id, registros: rows });
    } catch (error) {
      next(error);
    }
  });

  rutas.get('/estudiantes/:id/boletin', ...conSesion, exigirEstudiantePropio('id'), async (req, res, next) => {
    try {
      const { rows } = await db.consultar(
        `SELECT c.id AS clase_id, c.codigo_clase,
                m.codigo AS materia_codigo, m.nombre AS materia_nombre,
                g.parcial_1, g.parcial_2, g.parcial_3, g.acumulativo,
                g.nota_final, g.aprobado
           FROM calificaciones g
           JOIN clases c ON c.id = g.clase_id
           JOIN materias m ON m.id = c.materia_id
          WHERE g.estudiante_id = $1
          ORDER BY m.nombre`,
        [req.params.id]
      );
      res.set('Cache-Control', 'no-store');
      res.json({ estudianteId: req.params.id, calificaciones: rows });
    } catch (error) {
      next(error);
    }
  });

  rutas.get('/estudiantes/:id/asistencia', ...conSesion, exigirEstudiantePropio('id'), async (req, res, next) => {
    try {
      const soloSusClases = req.identidad.rol === 'CATEDRATICO';
      const { rows } = await db.consultar(
        `SELECT s.clase_id, s.id AS sesion_id, to_char(s.fecha, 'YYYY-MM-DD') AS fecha, d.estado
           FROM detalle_asistencia d
           JOIN sesiones_asistencia s ON s.id = d.sesion_id
           JOIN clases c ON c.id = s.clase_id
          WHERE d.estudiante_id = $1
            AND ($2::uuid IS NULL OR c.catedratico_id = $2)
          ORDER BY s.fecha DESC`,
        [req.params.id, soloSusClases ? req.vinculo.referenciaId : null]
      );
      res.set('Cache-Control', 'no-store');
      res.json({ estudianteId: req.params.id, asistencia: rows });
    } catch (error) {
      next(error);
    }
  });

  return rutas;
}

module.exports = { crearRutasAcademicas };
