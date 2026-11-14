'use strict';

const SECRETOS_INSEGUROS = new Set([
  '',
  'esoe_secure_2026',
  'esoe_jwt_secret_key_change_in_prod',
  'changeme',
  'cambiar'
]);

const LONGITUD_MINIMA_SECRETO = 32;

function leerEntero(valor, porDefecto) {
  const n = Number.parseInt(valor, 10);
  return Number.isFinite(n) && n > 0 ? n : porDefecto;
}

function leerOrigenes(valor) {
  return String(valor || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

function cargarConfig(env = process.env) {
  const entorno = env.NODE_ENV || 'development';
  const config = {
    entorno,
    esProduccion: entorno === 'production',
    puerto: leerEntero(env.PORT, 8080),
    host: env.HOST || '0.0.0.0',
    origenesPermitidos: leerOrigenes(env.CORS_ORIGINS),
    proxiesDeConfianza: leerEntero(env.TRUST_PROXY, 0),
    limitePeticiones: {
      ventanaMs: leerEntero(env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
      maximo: leerEntero(env.RATE_LIMIT_MAX, 300)
    },
    databaseUrl: env.DATABASE_URL || '',
    jwtSecret: env.JWT_SECRET || ''
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
  if (!config.esProduccion) return errores;

  if (SECRETOS_INSEGUROS.has(config.jwtSecret) || config.jwtSecret.length < LONGITUD_MINIMA_SECRETO) {
    errores.push(`JWT_SECRET debe definirse con al menos ${LONGITUD_MINIMA_SECRETO} caracteres aleatorios.`);
  }
  if (!config.databaseUrl) {
    errores.push('DATABASE_URL es obligatoria en produccion.');
  } else if ([...SECRETOS_INSEGUROS].some((s) => s && config.databaseUrl.includes(s))) {
    errores.push('DATABASE_URL usa una contrasena de ejemplo; genere una propia.');
  }
  return errores;
}

module.exports = { cargarConfig, validarConfig };
