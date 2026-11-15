'use strict';

// Consultas academicas de solo lectura, cada una tras su guardian de
// pertenencia (SEC-06). El escribir llega con SMS-04; aqui solo se lee, que es
// lo que el criterio de aceptacion de SEC-06 necesita para poder demostrarse.

const express = require('express');

function crearRutasAcademicas({ auth, db, permisos }) {
  const rutas = express.Router();

  // Sin base de datos estas consultas no existen, asi que no se registra nada y
  // responde el 404 general. Un atrapatodo aqui se tragaria toda ruta
  // desconocida de /api, porque este router se monta en /api y no en un prefijo
  // propio como el de integraciones.
  if (!db) return rutas;

  const { resolverVinculo, exigirClasePropia, exigirEstudiantePropio } = permisos;
  const conSesion = [auth.exigirSesion, resolverVinculo];

  // Las clases que le corresponden a quien pide: todas para la administracion,
  // las suyas para un catedratico, las de su promocion para un estudiante.
  rutas.get('/clases', ...conSesion, async (req, res, next) => {
    try {
      const { rol } = req.identidad;
      const base = `SELECT c.id, c.codigo_clase, c.horario, c.aula,
                           m.codigo AS materia_codigo, m.nombre AS materia_nombre,
                           p.codigo AS promocion_codigo
                      FROM clases c
                      JOIN materias m ON m.id = c.materia_id
                      JOIN promociones p ON p.id = c.promocion_id
                     WHERE c.activa = TRUE`;
      let consulta = `${base} ORDER BY c.codigo_clase`;
      let parametros = [];
      if (rol === 'CATEDRATICO') {
        consulta = `${base} AND c.catedratico_id = $1 ORDER BY c.codigo_clase`;
        parametros = [req.vinculo.referenciaId];
      } else if (rol === 'ESTUDIANTE') {
        consulta = `${base} AND c.promocion_id = (SELECT promocion_id FROM estudiantes WHERE id = $1)
                    ORDER BY c.codigo_clase`;
        parametros = [req.vinculo.referenciaId];
      }
      const { rows } = await db.consultar(consulta, parametros);
      res.set('Cache-Control', 'no-store');
      res.json({ clases: rows });
    } catch (error) {
      next(error);
    }
  });

  // Asistencia de una clase completa: solo su titular o la administracion.
  rutas.get('/clases/:id/asistencia', ...conSesion, exigirClasePropia('id'), async (req, res, next) => {
    try {
      const { rows } = await db.consultar(
        `SELECT s.id AS sesion_id, s.fecha, s.tema_impartido,
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

  // Boletin de un estudiante: el propio estudiante, un catedratico que le da
  // clase, o la administracion.
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

  return rutas;
}

module.exports = { crearRutasAcademicas };
