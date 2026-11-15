'use strict';

// SEC-06. El rol dice QUE clase de cosas puede hacer una cuenta; la pertenencia
// dice SOBRE CUALES. Las dos se comprueban en el servidor y ninguna llega desde
// la interfaz.
//
// La identidad de la sesion la da el proveedor (Clerk). El expediente al que esa
// cuenta corresponde lo da la tabla `usuarios`: `proveedor_id` la liga con el
// usuario del proveedor y `referencia_id` con su expediente de estudiante o de
// catedratico. Sin esa fila, una cuenta puede entrar pero no es dueña de nada.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SIN_EXPEDIENTE = 'Su cuenta no esta ligada a un expediente. Contacte a la administracion.';
const SIN_PERMISO = 'No tiene permiso para consultar este recurso.';
const CUENTA_INACTIVA = 'Su cuenta esta desactivada.';

function esUuid(valor) {
  return typeof valor === 'string' && UUID.test(valor);
}

function crearPermisos(db) {
  // Una cuenta puede cambiar de expediente o desactivarse en cualquier momento,
  // asi que esto se consulta por peticion y no se guarda en memoria.
  async function expedienteDe(usuarioIdProveedor) {
    const { rows } = await db.consultar(
      'SELECT id, rol, referencia_id, activo FROM usuarios WHERE proveedor_id = $1',
      [usuarioIdProveedor]
    );
    return rows[0] || null;
  }

  // Deja en req.vinculo la fila de `usuarios` de quien pide. No decide permisos:
  // solo responde quien es, para que los guardianes de abajo puedan comparar.
  async function resolverVinculo(req, res, next) {
    try {
      const fila = await expedienteDe(req.identidad.usuarioId);
      if (!fila) return res.status(403).json({ error: SIN_EXPEDIENTE, codigo: 'SIN_EXPEDIENTE' });
      if (fila.activo === false) return res.status(403).json({ error: CUENTA_INACTIVA, codigo: 'CUENTA_INACTIVA' });
      req.vinculo = Object.freeze({
        usuarioLocalId: fila.id,
        rolRegistrado: fila.rol,
        referenciaId: fila.referencia_id
      });
      next();
    } catch (error) {
      next(error);
    }
  }

  // ¿Imparte esta persona esta clase? Lo responde la propia tabla de clases, no
  // un dato que venga en la peticion.
  async function imparteLaClase(catedraticoId, claseId) {
    if (!esUuid(catedraticoId) || !esUuid(claseId)) return false;
    const { rows } = await db.consultar(
      'SELECT 1 FROM clases WHERE id = $1 AND catedratico_id = $2',
      [claseId, catedraticoId]
    );
    return rows.length > 0;
  }

  // ¿Esta este estudiante en alguna clase de esta persona? La promocion del
  // estudiante tiene que coincidir con la de una clase suya.
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

  // La administracion ve todo. Un catedratico, solo sus clases. Un estudiante no
  // consulta una clase completa: para lo suyo estan sus propias rutas.
  function exigirClasePropia(nombreDelParametro = 'id') {
    return async function guardianDeClasePropia(req, res, next) {
      try {
        const claseId = req.params[nombreDelParametro];
        if (!esUuid(claseId)) return res.status(404).json({ error: 'Clase no encontrada.' });
        if (req.identidad.rol === 'ADMIN') return next();
        if (req.identidad.rol !== 'CATEDRATICO') {
          return res.status(403).json({ error: SIN_PERMISO, codigo: 'NO_ES_SUYO' });
        }
        if (!await imparteLaClase(req.vinculo.referenciaId, claseId)) {
          // Mismo cuerpo exista o no la clase: de otro modo la respuesta diria
          // que clases existen a quien no deberia saberlo.
          return res.status(403).json({ error: SIN_PERMISO, codigo: 'NO_ES_SUYO' });
        }
        next();
      } catch (error) {
        next(error);
      }
    };
  }

  // La administracion ve todo. Un estudiante, solo su propio expediente. Un
  // catedratico, solo los estudiantes a los que da clase.
  function exigirEstudiantePropio(nombreDelParametro = 'id') {
    return async function guardianDeEstudiantePropio(req, res, next) {
      try {
        const estudianteId = req.params[nombreDelParametro];
        if (!esUuid(estudianteId)) return res.status(404).json({ error: 'Estudiante no encontrado.' });
        if (req.identidad.rol === 'ADMIN') return next();
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
    esUuid
  };
}

module.exports = { crearPermisos, esUuid, SIN_EXPEDIENTE, SIN_PERMISO, CUENTA_INACTIVA };
