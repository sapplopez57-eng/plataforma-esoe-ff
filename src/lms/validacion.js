'use strict';

const { reglas, validarConEsquema } = require('../academico/validacion');

const TIPOS_CONTENIDO = ['TEXTO', 'ENLACE', 'VIDEO', 'DOCUMENTO'];
const ESTADOS_ENTREGA = ['BORRADOR', 'ENTREGADA', 'CALIFICADA', 'DEVUELTA'];
const ESTADOS_QUE_ENVIA_EL_ESTUDIANTE = ['BORRADOR', 'ENTREGADA'];
const ESTADOS_QUE_CIERRA_EL_CATEDRATICO = ['CALIFICADA', 'DEVUELTA'];
const URL_SEGURA = /^https:\/\/[^\s<>"']+$/;
const MARCA_DE_TIEMPO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

function marcaDeTiempoValida(texto) {
  if (typeof texto !== 'string' || !MARCA_DE_TIEMPO.test(texto)) return false;
  return !Number.isNaN(new Date(texto).getTime());
}

const url = (obligatorio) => reglas.patron(URL_SEGURA, 'Debe ser una direccion https valida.', 500, { obligatorio });

const marca = (v) => (marcaDeTiempoValida(v)
  ? null : 'Debe ser una fecha y hora en formato ISO 8601 con zona, por ejemplo 2026-03-01T23:59:00Z.');

const decimal = (min, max) => (v) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 'Debe ser un numero.';
  if (v < min || v > max) return `Debe estar entre ${min} y ${max}.`;
  if (Math.abs(v * 100 - Math.round(v * 100)) > 1e-9) return 'Admite hasta dos decimales.';
  return null;
};

const uuidOpcional = (v) => (v === null ? null : reglas.uuid(v));

const ESQUEMAS_LMS = {
  curso: {
    campos: {
      titulo: reglas.texto(150), descripcion: reglas.texto(2000, { obligatorio: false }),
      publicado: reglas.booleano
    },
    obligatorios: ['titulo'],
    cruzadas: () => {}
  },
  unidad: {
    campos: {
      orden: reglas.entero(1, 200), titulo: reglas.texto(150),
      descripcion: reglas.texto(2000, { obligatorio: false }), publicada: reglas.booleano
    },
    obligatorios: ['orden', 'titulo'],
    cruzadas: () => {}
  },
  contenido: {
    campos: {
      orden: reglas.entero(1, 500), titulo: reglas.texto(150),
      tipo: reglas.opcion(TIPOS_CONTENIDO), cuerpo: reglas.texto(20000, { obligatorio: false }),
      url: url(false), publicado: reglas.booleano
    },
    obligatorios: ['orden', 'titulo', 'tipo'],
    cruzadas: (d, campos) => {
      if (campos.tipo || !d.tipo) return;
      if (d.tipo === 'TEXTO') {
        if (!d.cuerpo && !campos.cuerpo) campos.cuerpo = 'Es obligatorio en un contenido de tipo TEXTO.';
        if (d.url) campos.url = 'Un contenido de tipo TEXTO no lleva direccion.';
        return;
      }
      if (!d.url && !campos.url) campos.url = `Es obligatoria en un contenido de tipo ${d.tipo}.`;
      if (d.cuerpo) campos.cuerpo = `Un contenido de tipo ${d.tipo} no lleva cuerpo.`;
    }
  },
  tarea: {
    campos: {
      titulo: reglas.texto(150), instrucciones: reglas.texto(20000),
      unidad_id: uuidOpcional, puntaje_maximo: decimal(0.01, 100),
      fecha_entrega: marca, permite_atraso: reglas.booleano, publicada: reglas.booleano
    },
    obligatorios: ['titulo', 'instrucciones', 'fecha_entrega'],
    cruzadas: () => {}
  },
  entrega: {
    campos: {
      texto: reglas.texto(20000, { obligatorio: false }), url: url(false),
      estado: reglas.opcion(ESTADOS_QUE_ENVIA_EL_ESTUDIANTE)
    },
    obligatorios: ['estado'],
    cruzadas: (d, campos) => {
      if (d.estado === 'ENTREGADA' && !d.texto && !d.url && !campos.texto && !campos.url) {
        campos.texto = 'Una entrega necesita texto o una direccion https.';
      }
    }
  },
  calificacion: {
    campos: {
      nota: decimal(0, 100), retroalimentacion: reglas.texto(5000, { obligatorio: false }),
      estado: reglas.opcion(ESTADOS_QUE_CIERRA_EL_CATEDRATICO)
    },
    obligatorios: ['estado'],
    cruzadas: (d, campos) => {
      if (d.estado === 'CALIFICADA' && typeof d.nota !== 'number' && !campos.nota) {
        campos.nota = 'Es obligatoria para dar una entrega por calificada.';
      }
    }
  }
};

function validarLms(tipo, cuerpo, opciones) {
  const esquema = ESQUEMAS_LMS[tipo];
  if (!esquema) throw new Error(`Esquema del aula virtual desconocido: ${tipo}`);
  return validarConEsquema(esquema, cuerpo, opciones);
}

module.exports = {
  validarLms, marcaDeTiempoValida, ESQUEMAS_LMS,
  TIPOS_CONTENIDO, ESTADOS_ENTREGA, ESTADOS_QUE_ENVIA_EL_ESTUDIANTE, ESTADOS_QUE_CIERRA_EL_CATEDRATICO
};
