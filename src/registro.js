'use strict';

const crypto = require('node:crypto');

const NIVELES = Object.freeze({ depuracion: 10, info: 20, aviso: 30, error: 40, silencio: 100 });
const ORDEN = Object.freeze(['depuracion', 'info', 'aviso', 'error']);
const CABECERA_PETICION = 'x-peticion-id';
const IDENTIFICADOR_VALIDO = /^[A-Za-z0-9_-]{8,64}$/;
const REDACTADO = '[REDACTADO]';
const CLAVE_SENSIBLE = /(authorization|cookie|clave|contrasena|password|passwd|secret|secreto|token|llave|apikey|api_key|dni|correo|email|identidad|cedula)/i;
const MAXIMO_TEXTO = 512;
const PROFUNDIDAD_MAXIMA = 4;
const MAXIMO_ELEMENTOS = 20;
const MAXIMO_CLAVES = 40;
const PAREJA_SENSIBLE = /\b(authorization|cookie|clave|contrasena|password|passwd|secret|secreto|token|llave|apikey|api_key)\b(\s*[:=]\s*|\s+)("[^"]*"|'[^']*'|\S+)/gi;
const CORREO = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const IDENTIDAD_LARGA = /\b\d{13,}\b/g;
const IDENTIDAD_CON_GUIONES = /\b\d{4}-\d{4}-\d{5}\b/g;
const CREDENCIAL_EN_URL = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/?#:@]+:[^\s/?#]*@/gi;
const ESQUEMA_DE_AUTORIZACION = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g;
const TESTIGO_FIRMADO = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g;
const LLAVE_DE_PROVEEDOR = /\b(sk|rk|whsec)_[A-Za-z0-9_]{6,}/g;
const SECRETO_LARGO = /\b[A-Za-z0-9_]{32,}\b/g;

function recortar(texto) {
  return texto.length > MAXIMO_TEXTO ? `${texto.slice(0, MAXIMO_TEXTO)}[...]` : texto;
}

function redactarTexto(texto) {
  return String(texto)
    .replace(CREDENCIAL_EN_URL, (_entero, esquema) => `${esquema}${REDACTADO}@`)
    .replace(ESQUEMA_DE_AUTORIZACION, (_entero, esquema) => `${esquema} ${REDACTADO}`)
    .replace(TESTIGO_FIRMADO, REDACTADO)
    .replace(LLAVE_DE_PROVEEDOR, REDACTADO)
    .replace(PAREJA_SENSIBLE, (_entero, clave, separador) => `${clave}${separador}${REDACTADO}`)
    .replace(CORREO, REDACTADO)
    .replace(IDENTIDAD_LARGA, REDACTADO)
    .replace(IDENTIDAD_CON_GUIONES, REDACTADO)
    .replace(SECRETO_LARGO, REDACTADO);
}

function limpiar(texto) {
  return recortar(redactarTexto(texto));
}

function redactar(valor, profundidad = 0, vistos = new WeakSet()) {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === 'string') return limpiar(valor);
  if (typeof valor === 'boolean') return valor;
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : String(valor);
  if (typeof valor === 'bigint') return valor.toString();
  if (typeof valor === 'function' || typeof valor === 'symbol') return REDACTADO;
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? REDACTADO : valor.toISOString();
  if (valor instanceof Error) {
    return {
      nombre: valor.name,
      mensaje: limpiar(String(valor.message || '')),
      ...(valor.codigo ? { codigo: limpiar(String(valor.codigo)) } : {}),
      ...(valor.code ? { code: limpiar(String(valor.code)) } : {})
    };
  }
  if (profundidad >= PROFUNDIDAD_MAXIMA) return REDACTADO;
  if (vistos.has(valor)) return '[CICLO]';
  vistos.add(valor);
  if (Array.isArray(valor)) {
    return valor.slice(0, MAXIMO_ELEMENTOS).map((elemento) => redactar(elemento, profundidad + 1, vistos));
  }
  const salida = {};
  for (const [clave, interno] of Object.entries(valor).slice(0, MAXIMO_CLAVES)) {
    salida[clave] = CLAVE_SENSIBLE.test(clave) ? REDACTADO : redactar(interno, profundidad + 1, vistos);
  }
  return salida;
}

function objetoDeDatos(datos) {
  const limpio = redactar(datos);
  if (limpio === null) return {};
  return typeof limpio === 'object' && !Array.isArray(limpio) ? limpio : { detalle: limpio };
}

function crearRegistro({ servicio = 'ESOE-SMS', entorno = 'development', version = '', nivel = 'info', salida } = {}) {
  const umbral = NIVELES[nivel] === undefined ? NIVELES.info : NIVELES[nivel];
  const escribir = salida || ((linea) => process.stdout.write(`${linea}\n`));
  const base = Object.freeze({ servicio, entorno, ...(version ? { version } : {}) });

  function emitir(nivelEvento, contexto, mensaje, datos) {
    if (NIVELES[nivelEvento] < umbral) return;
    const marca = new Date().toISOString();
    let linea;
    try {
      const evento = { t: marca, nivel: nivelEvento, ...base, ...contexto, mensaje: limpiar(String(mensaje)) };
      if (datos !== undefined) Object.assign(evento, objetoDeDatos(datos));
      linea = JSON.stringify(evento);
    } catch {
      linea = JSON.stringify({ t: marca, nivel: 'error', ...base, mensaje: 'Evento de registro no serializable.' });
    }
    escribir(linea);
  }

  function construir(contexto) {
    const registro = {
      nivel,
      contexto,
      hijo: (extra) => construir({ ...contexto, ...objetoDeDatos(extra) })
    };
    for (const nombre of ORDEN) {
      registro[nombre] = (mensaje, datos) => emitir(nombre, contexto, mensaje, datos);
    }
    return Object.freeze(registro);
  }

  return construir({});
}

function identificadorDePeticion(recibido) {
  const texto = String(recibido || '').trim();
  return IDENTIFICADOR_VALIDO.test(texto) ? texto : crypto.randomUUID();
}

function rutaDePeticion(req) {
  if (req.route && typeof req.route.path === 'string') {
    return limpiar(`${req.baseUrl || ''}${req.route.path}`) || '/';
  }
  return limpiar(String(req.path || '/'));
}

function nivelPorEstado(estado) {
  if (estado >= 500) return 'error';
  if (estado >= 400) return 'aviso';
  return 'info';
}

function registroDePeticiones(registro) {
  return (req, res, siguiente) => {
    const peticion = identificadorDePeticion(req.get(CABECERA_PETICION));
    const inicio = process.hrtime.bigint();
    req.peticionId = peticion;
    req.registro = registro.hijo({ peticion });
    res.set(CABECERA_PETICION, peticion);
    res.on('finish', () => {
      const transcurrido = Number(process.hrtime.bigint() - inicio) / 1e6;
      req.registro[nivelPorEstado(res.statusCode)]('peticion atendida', {
        metodo: req.method,
        ruta: rutaDePeticion(req),
        estado: res.statusCode,
        ms: Math.round(transcurrido * 100) / 100,
        origen: req.ip || ''
      });
    });
    siguiente();
  };
}

module.exports = {
  crearRegistro,
  registroDePeticiones,
  redactar,
  redactarTexto,
  identificadorDePeticion,
  NIVELES,
  CABECERA_PETICION
};
