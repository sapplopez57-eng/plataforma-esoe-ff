'use strict';

const net = require('node:net');

const { NIVELES } = require('./registro');
const { esDireccionInterna } = require('./seguridad/red');

const VALORES_DE_EJEMPLO = ['esoe_secure_2026', 'esoe_jwt_secret_key_change_in_prod', 'changeme', 'cambiar'];
const CLAVE_CIFRADO_HEX = /^[0-9a-f]{64}$/i;
const MODOS_TLS = ['desactivado', 'requerido', 'verificado'];
const CERTIFICADO_PEM = /^-----BEGIN CERTIFICATE-----[\sA-Za-z0-9+/=-]+-----END CERTIFICATE-----$/;
const HOSTS_LOCALES = ['localhost', '127.0.0.1', '::1', '[::1]'];
const SUFIJOS_DE_RED_PRIVADA = ['.local', '.internal', '.lan', '.localdomain'];
const PARAMETROS_TLS_DE_URL = ['sslmode', 'ssl', 'sslrootcert', 'sslcert', 'sslkey', 'sslnegotiation'];
const MODO_POR_SSLMODE = Object.freeze({
  disable: 'desactivado',
  require: 'verificado',
  'verify-ca': 'verificado',
  'verify-full': 'verificado'
});
const FUERZA_TLS = Object.freeze({ desactivado: 0, requerido: 1, verificado: 2 });
const SERVIDOR_ADMINISTRADO = /(^|\.)supabase\.(co|com|net)$/;
const PUERTO_DIRECTO_ADMINISTRADO = '5432';
const PUERTO_AGRUPADOR_ADMINISTRADO = '6543';
const NIVELES_DE_REGISTRO = Object.freeze(Object.keys(NIVELES));

function errorDeConfig(mensaje) {
  const error = new Error(`Configuracion invalida: ${mensaje}`);
  error.code = 'CONFIG_INVALIDA';
  return error;
}

function partesDeBaseDeDatos(databaseUrl) {
  if (!databaseUrl) return { host: '', puerto: '' };
  try {
    const url = new URL(databaseUrl);
    return { host: url.hostname.toLowerCase(), puerto: url.port || PUERTO_DIRECTO_ADMINISTRADO };
  } catch {
    return { host: '', puerto: '' };
  }
}

function hostDeBaseDeDatos(databaseUrl) {
  return partesDeBaseDeDatos(databaseUrl).host;
}

function esHostLocal(host) {
  if (!host) return true;
  const limpio = String(host).replace(/^\[|\]$/g, '').toLowerCase();
  if (HOSTS_LOCALES.includes(limpio)) return true;
  if (net.isIP(limpio)) return esDireccionInterna(limpio);
  if (!limpio.includes('.')) return true;
  return SUFIJOS_DE_RED_PRIVADA.some((sufijo) => limpio.endsWith(sufijo));
}

function parametrosTlsDeUrl(databaseUrl) {
  let url;
  try {
    url = new URL(String(databaseUrl || ''));
  } catch {
    return [];
  }
  return PARAMETROS_TLS_DE_URL
    .filter((nombre) => url.searchParams.has(nombre))
    .map((nombre) => ({ nombre, valor: url.searchParams.get(nombre) }));
}

function urlSinParametrosTls(databaseUrl) {
  const texto = String(databaseUrl || '');
  let url;
  try {
    url = new URL(texto);
  } catch {
    return texto;
  }
  let cambio = false;
  for (const nombre of PARAMETROS_TLS_DE_URL) {
    if (url.searchParams.has(nombre)) {
      url.searchParams.delete(nombre);
      cambio = true;
    }
  }
  return cambio ? url.toString().replace(/\?$/, '') : texto;
}

function modoImplicitoPorUrl(databaseUrl) {
  const pedido = parametrosTlsDeUrl(databaseUrl).find((p) => p.nombre === 'sslmode');
  if (!pedido) return '';
  const valor = String(pedido.valor || '').trim().toLowerCase();
  return MODO_POR_SSLMODE[valor] || 'no_admitido';
}

function modoTlsPorDefecto(databaseUrl) {
  const { host } = partesDeBaseDeDatos(databaseUrl);
  if (!host) return 'desactivado';
  return esHostLocal(host) ? 'desactivado' : 'verificado';
}

function tlsDeBaseDeDatos(env = process.env) {
  const databaseUrl = env.DATABASE_URL || '';
  const implicito = modoImplicitoPorUrl(databaseUrl);
  if (implicito === 'no_admitido') {
    throw errorDeConfig(
      'DATABASE_URL trae un sslmode que esta plataforma no admite. Los admitidos son disable, require, '
      + 'verify-ca y verify-full; prefer y allow dejan la decision al servidor y no sirven aqui. '
      + 'Lo recomendado es quitar el sslmode de la URL y declarar la politica en DB_SSL.'
    );
  }
  const sobrantes = parametrosTlsDeUrl(databaseUrl).filter((p) => p.nombre !== 'sslmode');
  if (sobrantes.length > 0) {
    throw errorDeConfig(
      `DATABASE_URL trae parametros de TLS (${sobrantes.map((p) => p.nombre).join(', ')}) que node-postgres `
      + 'hace prevalecer sobre las opciones de la aplicacion. Quitelos y use DB_SSL y DB_CA_CERT.'
    );
  }
  const pedido = String(env.DB_SSL || '').trim().toLowerCase();
  if (pedido && implicito && FUERZA_TLS[implicito] < FUERZA_TLS[pedido]) {
    throw errorDeConfig(
      `DB_SSL pide ${pedido} y el sslmode de DATABASE_URL pide ${implicito}, que es mas debil. `
      + 'node-postgres haria caso al de la URL, asi que la politica declarada no seria la real. '
      + 'Quite el sslmode de DATABASE_URL.'
    );
  }
  const masFuerte = pedido && implicito
    ? (FUERZA_TLS[implicito] > FUERZA_TLS[pedido] ? implicito : pedido)
    : (pedido || implicito);
  const modo = masFuerte || modoTlsPorDefecto(databaseUrl);
  if (!MODOS_TLS.includes(modo)) {
    throw errorDeConfig(`DB_SSL debe ser uno de: ${MODOS_TLS.join(', ')}.`);
  }
  const autoridad = (env.DB_CA_CERT || '').replace(/\\n/g, '\n').trim();
  if (autoridad && !CERTIFICADO_PEM.test(autoridad)) {
    throw errorDeConfig('DB_CA_CERT debe ser un certificado PEM completo, de BEGIN CERTIFICATE a END CERTIFICATE.');
  }
  if (autoridad && modo !== 'verificado') {
    throw errorDeConfig('DB_CA_CERT solo se usa con DB_SSL=verificado.');
  }
  if (modo === 'desactivado') return { modo, ssl: false };
  if (modo === 'requerido') return { modo, ssl: { rejectUnauthorized: false } };
  return { modo, ssl: { rejectUnauthorized: true, ...(autoridad ? { ca: autoridad } : {}) } };
}

function leerEntero(valor, porDefecto) {
  const n = Number.parseInt(valor, 10);
  return Number.isFinite(n) && n > 0 ? n : porDefecto;
}

function leerLista(valor) {
  return String(valor || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

function leerEnteroAcotado(env, nombre, porDefecto, minimo, maximo) {
  const valor = env[nombre];
  if (valor === undefined || valor === '') return porDefecto;
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero < minimo || numero > maximo) {
    const error = new Error(`Configuracion invalida: ${nombre} debe ser un entero entre ${minimo} y ${maximo}.`);
    error.code = 'CONFIG_INVALIDA';
    throw error;
  }
  return numero;
}

function leerBooleano(valor) {
  return ['1', 'true', 'si', 'yes'].includes(String(valor || '').trim().toLowerCase());
}

function dominioDeClerk(llavePublica) {
  const partes = /^pk_(test|live)_(.+)$/.exec(llavePublica || '');
  if (!partes) return '';
  const dominio = Buffer.from(partes[2], 'base64').toString('utf8').replace(/\$$/, '');
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(dominio) ? dominio : '';
}

function tiemposHttpDe(env) {
  const keepAliveMs = leerEnteroAcotado(env, 'HTTP_KEEPALIVE_TIMEOUT_MS', 5000, 1000, 300000);
  const cabecerasMs = leerEnteroAcotado(env, 'HTTP_HEADERS_TIMEOUT_MS', 10000, 1000, 300000);
  const peticionMs = leerEnteroAcotado(env, 'HTTP_REQUEST_TIMEOUT_MS', 30000, 1000, 600000);
  const revisionMs = Math.max(250, Math.floor(Math.min(keepAliveMs, cabecerasMs) / 2));
  return { keepAliveMs, cabecerasMs, peticionMs, revisionMs };
}

function cargarConfig(env = process.env) {
  const entorno = env.NODE_ENV || 'development';
  const llavePublica = (env.CLERK_PUBLISHABLE_KEY || '').trim();
  const llaveSecreta = (env.CLERK_SECRET_KEY || '').trim();
  const tls = tlsDeBaseDeDatos(env);

  const config = {
    entorno,
    esProduccion: entorno === 'production',
    version: /^[0-9a-f]{7,40}$/.test(env.APP_VERSION || '') ? env.APP_VERSION.slice(0, 12) : '',
    puerto: leerEntero(env.PORT, 8080),
    host: env.HOST || '0.0.0.0',
    origenesPermitidos: leerLista(env.CORS_ORIGINS),
    proxiesDeConfianza: leerEntero(env.TRUST_PROXY, 0),
    limitePeticiones: {
      ventanaMs: leerEntero(env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
      maximo: leerEntero(env.RATE_LIMIT_MAX, 300),
      maximoPublico: leerEntero(env.RATE_LIMIT_PUBLIC_MAX, 1200),
      almacen: env.RATE_LIMIT_STORE || (entorno === 'production' ? 'postgres' : 'memory')
    },
    databaseUrl: urlSinParametrosTls(env.DATABASE_URL || ''),
    sinEstado: env.VERCEL === '1',
    registro: {
      nivel: (env.LOG_NIVEL || (entorno === 'test' ? 'silencio' : 'info')).trim().toLowerCase()
    },
    tiemposHttp: tiemposHttpDe(env),
    tlsBaseDeDatos: tls.modo,
    baseDeDatos: {
      max: leerEnteroAcotado(env, 'DB_POOL_MAX', env.VERCEL === '1' ? 2 : 10, 1, 100),
      connectionTimeoutMillis: leerEnteroAcotado(env, 'DB_CONNECTION_TIMEOUT_MS', 3000, 100, 60000),
      idleTimeoutMillis: leerEnteroAcotado(env, 'DB_IDLE_TIMEOUT_MS', 30000, 1000, 600000),
      statement_timeout: leerEnteroAcotado(env, 'DB_STATEMENT_TIMEOUT_MS', 10000, 100, 120000),
      ssl: tls.ssl
    },
    clerk: {
      habilitado: Boolean(llavePublica && llaveSecreta),
      llavePublica,
      llaveSecreta,
      llaveJwt: (env.CLERK_JWT_KEY || '').replace(/\\n/g, '\n').trim(),
      dominio: dominioDeClerk(llavePublica),
      origenesAutorizados: leerLista(env.ORIGEN_PUBLICO)
    },
    integraciones: {
      claveCifrado: (env.CLAVE_CIFRADO || '').trim(),
      permitirRedPrivada: leerBooleano(env.INTEGRACIONES_RED_PRIVADA),
      tiempoMaximoMs: leerEntero(env.INTEGRACIONES_TIEMPO_MS, 10000)
    },
    voz: {
      token: (env.VOZ_TOKEN || '').trim(),
      limiteVerificacion: leerEntero(env.VOZ_LIMITE_VERIFICACION, 120)
    }
  };

  const errores = validarConfig(config);
  if (errores.length > 0) {
    const error = new Error(`Configuracion invalida:\n- ${errores.join('\n- ')}`);
    error.code = 'CONFIG_INVALIDA';
    throw error;
  }
  return Object.freeze(config);
}

function validarConfig(config) {
  const errores = [];
  const { clerk, integraciones } = config;

  if (clerk.llavePublica && !clerk.dominio) {
    errores.push('CLERK_PUBLISHABLE_KEY no tiene el formato esperado (pk_test_... o pk_live_...).');
  }
  if (Boolean(clerk.llavePublica) !== Boolean(clerk.llaveSecreta)) {
    errores.push('CLERK_PUBLISHABLE_KEY y CLERK_SECRET_KEY deben definirse juntas.');
  }
  if (integraciones.claveCifrado && !CLAVE_CIFRADO_HEX.test(integraciones.claveCifrado)) {
    errores.push('CLAVE_CIFRADO debe tener 64 caracteres hexadecimales (openssl rand -hex 32).');
  }
  if (config.voz.token && config.voz.token.length < 32) {
    errores.push('VOZ_TOKEN debe tener al menos 32 caracteres (openssl rand -hex 32).');
  }
  if (!['memory', 'postgres'].includes(config.limitePeticiones.almacen)) {
    errores.push('RATE_LIMIT_STORE debe ser memory o postgres.');
  }
  if (config.registro && !NIVELES_DE_REGISTRO.includes(config.registro.nivel)) {
    errores.push(`LOG_NIVEL debe ser uno de: ${NIVELES_DE_REGISTRO.join(', ')}.`);
  }
  if (config.tiemposHttp) {
    const { keepAliveMs, cabecerasMs, peticionMs } = config.tiemposHttp;
    if (cabecerasMs <= keepAliveMs) {
      errores.push('HTTP_HEADERS_TIMEOUT_MS debe ser mayor que HTTP_KEEPALIVE_TIMEOUT_MS para que Node cierre la conexion ociosa antes de agotar la cabecera.');
    }
    if (peticionMs <= cabecerasMs) {
      errores.push('HTTP_REQUEST_TIMEOUT_MS debe ser mayor que HTTP_HEADERS_TIMEOUT_MS.');
    }
  }
  if (!config.esProduccion) return errores;

  if (config.limitePeticiones.almacen !== 'postgres') {
    errores.push('RATE_LIMIT_STORE debe ser postgres en produccion para compartir las cuotas entre instancias.');
  }

  if (!clerk.habilitado) {
    errores.push('CLERK_PUBLISHABLE_KEY y CLERK_SECRET_KEY son obligatorias en produccion.');
  }
  if (clerk.origenesAutorizados.length === 0) {
    errores.push('ORIGEN_PUBLICO es obligatorio en produccion (por ejemplo https://esoe.ejemplo.hn).');
  }
  for (const origen of clerk.origenesAutorizados) {
    try {
      const url = new URL(origen);
      if (url.protocol !== 'https:' || url.origin !== origen) throw new Error('Origen no canonico.');
    } catch {
      errores.push('ORIGEN_PUBLICO debe contener origenes HTTPS sin rutas, credenciales ni barra final.');
    }
  }
  if (!integraciones.claveCifrado) {
    errores.push('CLAVE_CIFRADO es obligatoria en produccion.');
  }
  if (!config.databaseUrl) {
    errores.push('DATABASE_URL es obligatoria en produccion.');
  } else if (VALORES_DE_EJEMPLO.some((s) => config.databaseUrl.includes(s))) {
    errores.push('DATABASE_URL usa una contrasena de ejemplo; genere una propia.');
  }
  if (config.databaseUrl) {
    const { host, puerto } = partesDeBaseDeDatos(config.databaseUrl);
    if (!esHostLocal(host) && config.tlsBaseDeDatos === 'desactivado') {
      errores.push('DB_SSL no puede quedar desactivado con una base de datos remota: use verificado.');
    }
    if (!esHostLocal(host) && config.tlsBaseDeDatos === 'requerido') {
      errores.push(
        'DB_SSL=requerido cifra pero no comprueba el certificado, asi que un intermediario puede suplantar '
        + 'la base de datos. Con una base remota en produccion use verificado.'
      );
    }
    if (config.sinEstado && SERVIDOR_ADMINISTRADO.test(host) && puerto === PUERTO_DIRECTO_ADMINISTRADO) {
      errores.push(`En un despliegue sin estado use el agrupador de conexiones en el puerto ${PUERTO_AGRUPADOR_ADMINISTRADO}, no la conexion directa ${PUERTO_DIRECTO_ADMINISTRADO}.`);
    }
  }
  return errores;
}

module.exports = { cargarConfig, validarConfig, tiemposHttpDe, urlSinParametrosTls, parametrosTlsDeUrl, modoImplicitoPorUrl, dominioDeClerk, tlsDeBaseDeDatos, hostDeBaseDeDatos, esHostLocal, MODOS_TLS };
