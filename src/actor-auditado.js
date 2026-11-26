'use strict';

function crearActorAuditado(db) {
  return function comoUsuario(req, trabajo) {
    return db.transaccion(async (consultar) => {
      await consultar(
        `SELECT set_config('esoe.usuario_id', $1, true), set_config('esoe.autor', $2, true)`,
        [req.vinculo?.usuarioLocalId || '', `api:${req.identidad.usuarioId}`]
      );
      return trabajo(consultar);
    });
  };
}

module.exports = { crearActorAuditado };
