'use strict';

// Plataformas conocidas que un administrativo puede agregar con un clic.
// Verificadas el 14-11-2026: ambas son Moodle con servicios web y servicio movil activos.
const PLATAFORMAS_CONOCIDAS = Object.freeze([
  Object.freeze({
    clave: 'infop-elearning',
    nombre: 'INFOP — E-Learning',
    tipo: 'MOODLE',
    urlBase: 'https://plataformavirtual.infop.hn',
    descripcion: 'Cursos virtuales del Instituto Nacional de Formación Profesional.'
  }),
  Object.freeze({
    clave: 'infop-academias',
    nombre: 'INFOP — Academias',
    tipo: 'MOODLE',
    urlBase: 'https://academias.infop.hn',
    descripcion: 'Academias en línea del Instituto Nacional de Formación Profesional.'
  })
]);

const TIPOS_ADMITIDOS = Object.freeze(['MOODLE']);

module.exports = { PLATAFORMAS_CONOCIDAS, TIPOS_ADMITIDOS };
