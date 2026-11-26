'use strict';

const LIMITE_LISTADO = 1000;

function conTope(consulta, limite = LIMITE_LISTADO) {
  const tope = typeof limite === 'number' ? limite : Number(String(limite).trim());
  if (!Number.isSafeInteger(tope) || tope < 1) {
    throw new TypeError('El tope de un listado debe ser un entero positivo.');
  }
  return `${consulta}\n LIMIT ${tope}`;
}

function avisarSiTopa(registro, filas, listado, limite = LIMITE_LISTADO) {
  if (Array.isArray(filas) && filas.length >= limite && registro) {
    registro.aviso('un listado alcanzo el tope de filas y puede estar recortado', {
      listado, filas: filas.length, limite
    });
  }
  return filas;
}

module.exports = { LIMITE_LISTADO, conTope, avisarSiTopa };
