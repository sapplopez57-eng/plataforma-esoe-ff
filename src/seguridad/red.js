'use strict';

const dns = require('node:dns');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');

const TAMANO_MAXIMO = 2 * 1024 * 1024;
const CODIGOS_TRANSITORIOS = Object.freeze(['TIEMPO_AGOTADO', 'SIN_CONEXION']);
const ESTADOS_TRANSITORIOS = Object.freeze([429, 502, 503, 504]);
const INTENTOS_POR_DEFECTO = 3;
const ESPERA_BASE_MS = 200;
const ESPERA_MAXIMA_MS = 2000;

const redesInternas = new net.BlockList();
[
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3]
].forEach(([red, prefijo]) => redesInternas.addSubnet(red, prefijo, 'ipv4'));
[['::', 127], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]]
  .forEach(([red, prefijo]) => redesInternas.addSubnet(red, prefijo, 'ipv6'));

class ErrorDeRed extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorDeRed';
    this.codigo = codigo;
  }
}

function esDireccionInterna(direccion) {
  const familia = net.isIP(direccion);
  if (familia === 0) return true;
  if (familia === 6) {
    const mapeada = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(direccion);
    if (mapeada) return redesInternas.check(mapeada[1], 'ipv4');
    return redesInternas.check(direccion, 'ipv6');
  }
  return redesInternas.check(direccion, 'ipv4');
}

function normalizarUrlBase(texto, { permitirRedPrivada = false } = {}) {
  let url;
  try {
    url = new URL(String(texto || '').trim());
  } catch {
    throw new ErrorDeRed('URL_INVALIDA', 'La direccion no es una URL valida.');
  }
  if (url.protocol !== 'https:' && !(permitirRedPrivada && url.protocol === 'http:')) {
    throw new ErrorDeRed('URL_INVALIDA', 'La direccion debe usar https.');
  }
  if (url.username || url.password) {
    throw new ErrorDeRed('URL_INVALIDA', 'La direccion no debe incluir usuario ni contrasena.');
  }
  if (url.search || url.hash) {
    throw new ErrorDeRed('URL_INVALIDA', 'La direccion no debe incluir parametros.');
  }
  if (net.isIP(url.hostname.replace(/^\[|\]$/g, '')) && !permitirRedPrivada) {
    throw new ErrorDeRed('URL_INVALIDA', 'Use el nombre de dominio de la plataforma, no una direccion IP.');
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

function resolucionSegura(permitirRedPrivada) {
  return (nombre, opciones, retorno) => {
    dns.lookup(nombre, { ...opciones, all: true }, (error, direcciones) => {
      if (error) return retorno(error);
      const lista = Array.isArray(direcciones) ? direcciones : [{ address: direcciones, family: opciones.family }];
      if (!permitirRedPrivada && lista.some((d) => esDireccionInterna(d.address))) {
        return retorno(new ErrorDeRed('DESTINO_NO_PERMITIDO', 'La plataforma apunta a una red interna.'));
      }
      if (opciones.all) return retorno(null, lista);
      retorno(null, lista[0].address, lista[0].family);
    });
  };
}

function enviar(direccion, { formulario, json, permitirRedPrivada = false, tiempoMaximoMs = 10000 } = {}) {
  return new Promise((resolver, rechazar) => {
    const url = new URL(direccion);
    const cuerpo = json !== undefined ? JSON.stringify(json) : new URLSearchParams(formulario || {}).toString();
    const cliente = url.protocol === 'https:' ? https : http;

    const peticion = cliente.request(url, {
      method: 'POST',
      lookup: resolucionSegura(permitirRedPrivada),
      timeout: tiempoMaximoMs,
      headers: {
        'Content-Type': json !== undefined ? 'application/json' : 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(cuerpo),
        Accept: 'application/json',
        'User-Agent': 'PlataformaESOE/1.0'
      }
    }, (respuesta) => {
      if (respuesta.statusCode >= 300 && respuesta.statusCode < 400) {
        respuesta.resume();
        return rechazar(new ErrorDeRed('REDIRECCION', 'La plataforma respondio con una redireccion; revise la direccion.'));
      }
      if (respuesta.statusCode !== 200) {
        respuesta.resume();
        const fallo = new ErrorDeRed('RESPUESTA_INESPERADA', `La plataforma respondio con el estado ${respuesta.statusCode}.`);
        fallo.estado = respuesta.statusCode;
        const espera = Number.parseInt(respuesta.headers['retry-after'], 10);
        if (Number.isFinite(espera) && espera > 0) fallo.esperaPedidaMs = espera * 1000;
        return rechazar(fallo);
      }
      const trozos = [];
      let total = 0;
      respuesta.on('data', (trozo) => {
        total += trozo.length;
        if (total > TAMANO_MAXIMO) {
          peticion.destroy(new ErrorDeRed('RESPUESTA_DEMASIADO_GRANDE', 'La respuesta de la plataforma es demasiado grande.'));
          return;
        }
        trozos.push(trozo);
      });
      respuesta.on('end', () => {
        try {
          resolver(JSON.parse(Buffer.concat(trozos).toString('utf8')));
        } catch {
          rechazar(new ErrorDeRed('RESPUESTA_INESPERADA', 'La plataforma no respondio con datos validos.'));
        }
      });
    });

    peticion.on('timeout', () => {
      peticion.destroy(new ErrorDeRed('TIEMPO_AGOTADO', 'La plataforma no respondio a tiempo.'));
    });
    peticion.on('error', (error) => {
      if (error instanceof ErrorDeRed) return rechazar(error);
      rechazar(new ErrorDeRed('SIN_CONEXION', 'No se pudo conectar con la plataforma.'));
    });
    peticion.end(cuerpo);
  });
}

function obtener(direccion, { permitirRedPrivada = false, tiempoMaximoMs = 10000, maximoBytes = 65536 } = {}) {
  return new Promise((resolver, rechazar) => {
    const url = new URL(direccion);
    const cliente = url.protocol === 'https:' ? https : http;
    const peticion = cliente.request(url, {
      method: 'GET',
      lookup: resolucionSegura(permitirRedPrivada),
      timeout: tiempoMaximoMs,
      headers: { Accept: '*/*', 'User-Agent': 'PlataformaESOE/1.0' }
    }, (respuesta) => {
      const trozos = [];
      let total = 0;
      respuesta.on('data', (trozo) => {
        total += trozo.length;
        if (total > maximoBytes) return peticion.destroy();
        trozos.push(trozo);
      });
      respuesta.on('end', () => resolver({
        estado: respuesta.statusCode,
        tipo: String(respuesta.headers['content-type'] || ''),
        cuerpo: Buffer.concat(trozos).toString('utf8').slice(0, maximoBytes)
      }));
    });
    peticion.on('timeout', () => peticion.destroy(new ErrorDeRed('TIEMPO_AGOTADO', 'La plataforma no respondio a tiempo.')));
    peticion.on('error', (error) => {
      if (error instanceof ErrorDeRed) return rechazar(error);
      rechazar(new ErrorDeRed('SIN_CONEXION', 'No se pudo conectar con la plataforma.'));
    });
    peticion.end();
  });
}

function esTransitorio(error) {
  if (!(error instanceof ErrorDeRed)) return false;
  if (CODIGOS_TRANSITORIOS.includes(error.codigo)) return true;
  return ESTADOS_TRANSITORIOS.includes(error.estado);
}

function esperar(ms) {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

function retrasoDeReintento(intento, baseMs = ESPERA_BASE_MS, maximoMs = ESPERA_MAXIMA_MS, aleatorio = Math.random) {
  const tope = Math.min(maximoMs, baseMs * 2 ** Math.max(0, intento - 1));
  const mitad = tope / 2;
  return Math.max(1, Math.round(mitad + aleatorio() * mitad));
}

async function conReintentos(trabajo, opciones = {}) {
  const intentos = Number.isSafeInteger(opciones.intentos) && opciones.intentos > 0
    ? opciones.intentos : INTENTOS_POR_DEFECTO;
  const baseMs = Number.isSafeInteger(opciones.baseMs) && opciones.baseMs > 0 ? opciones.baseMs : ESPERA_BASE_MS;
  const maximoMs = Number.isSafeInteger(opciones.maximoMs) && opciones.maximoMs > 0
    ? opciones.maximoMs : ESPERA_MAXIMA_MS;
  const transitorio = typeof opciones.transitorio === 'function' ? opciones.transitorio : esTransitorio;
  const dormir = typeof opciones.dormir === 'function' ? opciones.dormir : esperar;
  const aleatorio = typeof opciones.aleatorio === 'function' ? opciones.aleatorio : Math.random;
  const anotar = typeof opciones.anotar === 'function' ? opciones.anotar : () => {};
  const presupuestoMs = Number.isSafeInteger(opciones.presupuestoMs) && opciones.presupuestoMs > 0
    ? opciones.presupuestoMs : maximoMs * intentos;

  for (let intento = 1; ; intento += 1) {
    try {
      return await trabajo(intento);
    } catch (error) {
      if (intento >= intentos || !transitorio(error)) throw error;
      const pedida = error && error.esperaPedidaMs;
      if (Number.isFinite(pedida) && pedida > presupuestoMs) {
        anotar({ intento, intentos, esperaPedidaMs: pedida, presupuestoMs, decision: 'no se reintenta' });
        throw error;
      }
      const retraso = retrasoDeReintento(intento, baseMs, maximoMs, aleatorio);
      anotar({ intento, intentos, retraso, codigo: error && error.codigo });
      await dormir(retraso);
    }
  }
}

module.exports = {
  ErrorDeRed, esDireccionInterna, normalizarUrlBase, enviar, obtener,
  conReintentos, esTransitorio, retrasoDeReintento
};
