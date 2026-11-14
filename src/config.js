'use strict';

const VALORES_DE_EJEMPLO = ['esoe_secure_2026', 'esoe_jwt_secret_key_change_in_prod', 'changeme', 'cambiar'];
const CLAVE_CIFRADO_HEX = /^[0-9a-f]{64}$/i;

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

function leerBooleano(valor) {
  return ['1', 'true', 'si', 'yes'].includes(String(valor || '').trim().toLowerCase());
}

// La llave publica de Clerk codifica el dominio de su API de navegador: pk_(test|live)_base64("dominio$").
function dominioDeClerk(llavePublica) {
  const partes = /^pk_(test|live)_(.+)$/.exec(llavePublica || '');
  if (!partes) return '';
  const dominio = Buffer.from(partes[2], 'base64').toString('utf8').replace(/\$$/, '');
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(dominio) ? dominio : '';
}

function cargarConfig(env = process.env) {
  const entorno = env.NODE_ENV || 'development';
  const llavePublica = (env.CLERK_PUBLISHABLE_KEY || '').trim();
  const llaveSecreta = (env.CLERK_SECRET_KEY || '').trim();

  const config = {
    entorno,
    esProduccion: entorno === 'production',
    puerto: leerEntero(env.PORT, 8080),
    host: env.HOST || '0.0.0.0',
    origenesPermitidos: leerLista(env.CORS_ORIGINS),
    proxiesDeConfianza: leerEntero(env.TRUST_PROXY, 0),
    limitePeticiones: {
      ventanaMs: leerEntero(env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
      maximo: leerEntero(env.RATE_LIMIT_MAX, 300)
    },
    databaseUrl: env.DATABASE_URL || '',
    clerk: {
      habilitado: Boolean(llavePublica && llaveSecreta),
      llavePublica,
      llaveSecreta,
      // Llave publica PEM de la instancia: permite verificar sesiones sin llamar a Clerk.
      llaveJwt: (env.CLERK_JWT_KEY || '').replace(/\\n/g, '\n').trim(),
      dominio: dominioDeClerk(llavePublica),
      // Origenes desde los que se aceptan sesiones (la URL publica de la plataforma).
      origenesAutorizados: leerLista(env.ORIGEN_PUBLICO)
    },
    integraciones: {
      claveCifrado: (env.CLAVE_CIFRADO || '').trim(),
      // Permite conectar con plataformas en la red interna o por HTTP (un Moodle propio en la LAN).
      permitirRedPrivada: leerBooleano(env.INTEGRACIONES_RED_PRIVADA),
      tiempoMaximoMs: leerEntero(env.INTEGRACIONES_TIEMPO_MS, 10000)
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
  if (!config.esProduccion) return errores;

  if (!clerk.habilitado) {
    errores.push('CLERK_PUBLISHABLE_KEY y CLERK_SECRET_KEY son obligatorias en produccion.');
  }
  if (clerk.origenesAutorizados.length === 0) {
    errores.push('ORIGEN_PUBLICO es obligatorio en produccion (por ejemplo https://esoe.ejemplo.hn).');
  }
  if (!integraciones.claveCifrado) {
    errores.push('CLAVE_CIFRADO es obligatoria en produccion.');
  }
  if (!config.databaseUrl) {
    errores.push('DATABASE_URL es obligatoria en produccion.');
  } else if (VALORES_DE_EJEMPLO.some((s) => config.databaseUrl.includes(s))) {
    errores.push('DATABASE_URL usa una contrasena de ejemplo; genere una propia.');
  }
  return errores;
}

module.exports = { cargarConfig, validarConfig, dominioDeClerk };
