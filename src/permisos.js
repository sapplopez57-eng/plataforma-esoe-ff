'use strict';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SIN_EXPEDIENTE = 'Su cuenta no esta ligada a un expediente. Contacte a la administracion.';
const SIN_PERMISO = 'No tiene permiso para consultar este recurso.';
const CUENTA_INACTIVA = 'Su cuenta esta desactivada.';

function esUuid(valor) {
  return typeof valor === 'string' && UUID.test(valor);
}

function crearPermisos(db) {
  async function expedienteDe(usuarioIdProveedor) {
    const { rows } = await db.consultar(
      'SELECT id, rol, referencia_id, institucion_id, activo FROM usuarios WHERE proveedor_id = $1',
      [usuarioIdProveedor]
    );
    return rows[0] || null;
  }

  async function resolverVinculo(req, res, next) {
    try {
      const fila = await expedienteDe(req.identidad.usuarioId);
      if (!fila) return res.status(403).json({ error: SIN_EXPEDIENTE, codigo: 'SIN_EXPEDIENTE' });
      if (fila.activo === false) return res.status(403).json({ error: CUENTA_INACTIVA, codigo: 'CUENTA_INACTIVA' });
      req.vinculo = Object.freeze({
        usuarioLocalId: fila.id,
        rolRegistrado: fila.rol,
        referenciaId: fila.referencia_id,
        institucionId: fila.institucion_id
      });
      next();
    } catch (error) {
      next(error);
    }
  }

  const TABLAS_CON_INSTITUCION = new Set(['clases', 'estudiantes']);
  async function esDeLaInstitucion(tabla, id, institucionId) {
    if (!TABLAS_CON_INSTITUCION.has(tabla) || !esUuid(id) || !esUuid(institucionId)) return false;
    const { rows } = await db.consultar(
      `SELECT 1 FROM ${tabla} WHERE id = $1 AND institucion_id = $2`, [id, institucionId]);
    return rows.length > 0;
  }

  async function imparteLaClase(catedraticoId, claseId) {
    if (!esUuid(catedraticoId) || !esUuid(claseId)) return false;
    const { rows } = await db.consultar(
      'SELECT 1 FROM clases WHERE id = $1 AND catedratico_id = $2',
      [claseId, catedraticoId]
    );
    return rows.length > 0;
  }

  async function ensenaAlEstudiante(catedraticoId, estudianteId) {
    if (!esUuid(catedraticoId) || !esUuid(estudianteId)) return false;
    const { rows } = await db.consultar(
      `SELECT 1
         FROM estudiantes e
         JOIN clases c ON c.promocion_id = e.promocion_id
        WHERE e.id = $1 AND c.catedratico_id = $2 AND c.activa = TRUE`,
      [estudianteId, catedraticoId]
    );
    return rows.length > 0;
  }

  function exigirClasePropia(nombreDelParametro = 'id') {
    return async function guardianDeClasePropia(req, res, next) {
      try {
        const claseId = req.params[nombreDelParametro];
        if (!esUuid(claseId)) return res.status(404).json({ error: 'Clase no encontrada.' });
        if (req.identidad.rol === 'ADMIN') {
          if (!await esDeLaInstitucion('clases', claseId, req.vinculo.institucionId)) {
            return res.status(404).json({ error: 'Clase no encontrada.' });
          }
          return next();
        }
        if (req.identidad.rol !== 'CATEDRATICO') {
          return res.status(403).json({ error: SIN_PERMISO, codigo: 'NO_ES_SUYO' });
        }
        if (!await imparteLaClase(req.vinculo.referenciaId, claseId)) {
          return res.status(403).json({ error: SIN_PERMISO, codigo: 'NO_ES_SUYO' });
        }
        next();
      } catch (error) {
        next(error);
      }
    };
  }

  function exigirEstudiantePropio(nombreDelParametro = 'id') {
    return async function guardianDeEstudiantePropio(req, res, next) {
      try {
        const estudianteId = req.params[nombreDelParametro];
        if (!esUuid(estudianteId)) return res.status(404).json({ error: 'Estudiante no encontrado.' });
        if (req.identidad.rol === 'ADMIN') {
          if (!await esDeLaInstitucion('estudiantes', estudianteId, req.vinculo.institucionId)) {
            return res.status(404).json({ error: 'Estudiante no encontrado.' });
          }
          return next();
        }
        if (req.identidad.rol === 'ESTUDIANTE') {
          if (req.vinculo.referenciaId !== estudianteId) {
            return res.status(403).json({ error: SIN_PERMISO, codigo: 'NO_ES_SUYO' });
          }
          return next();
        }
        if (req.identidad.rol === 'CATEDRATICO') {
          if (!await ensenaAlEstudiante(req.vinculo.referenciaId, estudianteId)) {
            return res.status(403).json({ error: SIN_PERMISO, codigo: 'NO_ES_SUYO' });
          }
          return next();
        }
        res.status(403).json({ error: SIN_PERMISO, codigo: 'NO_ES_SUYO' });
      } catch (error) {
        next(error);
      }
    };
  }

  return {
    resolverVinculo,
    exigirClasePropia,
    exigirEstudiantePropio,
    imparteLaClase,
    ensenaAlEstudiante,
    esDeLaInstitucion,
    esUuid
  };
}

module.exports = { crearPermisos, esUuid, SIN_EXPEDIENTE, SIN_PERMISO, CUENTA_INACTIVA };
