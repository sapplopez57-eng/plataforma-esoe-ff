'use strict';

const { Client } = require('pg');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const { crearRegistro } = require('../src/registro');
const { tlsDeBaseDeDatos, urlSinParametrosTls, hostDeBaseDeDatos } = require('../src/config');

const OBJETIVO = join(__dirname, '..', 'deploy', 'moodle', 'version-objetivo.json');
const PREFIJO_POR_DEFECTO = 'mdl_';
const PREFIJO_VALIDO = /^[a-z][a-z0-9_]{0,20}$/;
const VERSION_VALIDA = /^(\d{1,12})(?:\.(\d{1,6}))?$/;
const TIEMPO_MAXIMO_MS = 10000;
const SIN_TABLA = '42P01';
const SIN_PERMISO = '42501';

function informeNuevo() {
  return { datos: {}, fallos: [], avisos: [] };
}

function leerObjetivo(ruta = OBJETIVO) {
  const crudo = JSON.parse(readFileSync(ruta, 'utf8'));
  const version = String(crudo.version || '').trim();
  if (!VERSION_VALIDA.test(version)) {
    throw new Error(`version-objetivo.json declara una version que no se puede comparar: ${version}`);
  }
  return { version, rama: String(crudo.rama || ''), release: String(crudo.release || '') };
}

function partesDeVersion(texto) {
  const coincidencia = VERSION_VALIDA.exec(String(texto).trim());
  if (!coincidencia) return null;
  return [Number(coincidencia[1]), Number((coincidencia[2] || '0').padEnd(6, '0'))];
}

function compararVersiones(unaTexto, otraTexto) {
  const una = partesDeVersion(unaTexto);
  const otra = partesDeVersion(otraTexto);
  if (!una || !otra) return null;
  if (una[0] !== otra[0]) return una[0] < otra[0] ? -1 : 1;
  if (una[1] !== otra[1]) return una[1] < otra[1] ? -1 : 1;
  return 0;
}

function prefijoDe(entorno) {
  const crudo = String(entorno.MOODLE_DB_PREFIX || PREFIJO_POR_DEFECTO).trim();
  if (!PREFIJO_VALIDO.test(crudo)) {
    throw new Error(
      `MOODLE_DB_PREFIX no sirve como prefijo de tabla: ${crudo}. Moodle solo admite minusculas, `
      + 'digitos y guion bajo, empezando por una letra.'
    );
  }
  return crudo;
}

function entornoDeMoodle(entorno) {
  return {
    ...entorno,
    DATABASE_URL: entorno.MOODLE_DB_URL || '',
    DB_SSL: entorno.MOODLE_DB_SSL || entorno.DB_SSL || '',
    DB_CA_CERT: entorno.MOODLE_DB_CA_CERT || entorno.DB_CA_CERT || ''
  };
}

async function conectarConPg(url, ssl) {
  const cliente = new Client({
    connectionString: url,
    ssl,
    connectionTimeoutMillis: TIEMPO_MAXIMO_MS,
    statement_timeout: TIEMPO_MAXIMO_MS,
    query_timeout: TIEMPO_MAXIMO_MS
  });
  await cliente.connect();
  return cliente;
}

async function leerValorDeConfig(cliente, prefijo, nombre) {
  const { rows } = await cliente.query(
    `SELECT value FROM ${prefijo}config WHERE name = $1`, [nombre]);
  return rows.length === 0 ? null : String(rows[0].value);
}

function revisarVersion(instalada, objetivo, informe) {
  informe.datos.esquemaInstalado = instalada;
  if (instalada === null) {
    informe.avisos.push(
      'La tabla de configuracion existe pero no declara una version de esquema. La base esta a medio '
      + 'instalar: termine la instalacion o parta de una base limpia.'
    );
    return;
  }
  const orden = compararVersiones(instalada, objetivo.version);
  if (orden === null) {
    informe.fallos.push(
      `La base declara la version de esquema ${instalada}, que no se puede comparar con la ${objetivo.version} `
      + 'que fija version-objetivo.json. Revise la base a mano antes de levantar el sitio.'
    );
    return;
  }
  if (orden > 0) {
    informe.fallos.push(
      `La base arrastra el esquema ${instalada}, por delante de la version ${objetivo.version} de `
      + `${objetivo.rama}. Moodle no baja de version, asi que el sitio no arrancara sobre la rama estable: `
      + 'hay que partir de una base limpia o de un respaldo anterior a esa migracion.'
    );
    return;
  }
  if (orden < 0) {
    informe.avisos.push(
      `La base esta en el esquema ${instalada}, por detras de la ${objetivo.version}: Moodle la actualizara `
      + 'hacia adelante al levantar el sitio. Respalde antes de actualizar.'
    );
    return;
  }
  informe.datos.alineada = true;
}

async function comprobar(entorno = process.env, dependencias = {}) {
  const informe = informeNuevo();
  const conectar = dependencias.conectar || conectarConPg;
  const objetivo = dependencias.objetivo || leerObjetivo();
  informe.datos.esquemaObjetivo = objetivo.version;
  informe.datos.ramaObjetivo = objetivo.rama;

  const url = String(entorno.MOODLE_DB_URL || '').trim();
  if (!url) {
    informe.fallos.push(
      'MOODLE_DB_URL no esta definida: no se puede comprobar si la base del Moodle institucional arrastra '
      + 'un esquema por delante de la rama estable.'
    );
    return informe;
  }

  let prefijo;
  let ssl;
  try {
    prefijo = prefijoDe(entorno);
    ssl = tlsDeBaseDeDatos(entornoDeMoodle(entorno)).ssl;
  } catch (error) {
    informe.fallos.push(error.message);
    return informe;
  }
  informe.datos.prefijo = prefijo;
  informe.datos.host = hostDeBaseDeDatos(url);

  let cliente;
  try {
    cliente = await conectar(urlSinParametrosTls(url), ssl);
  } catch (error) {
    informe.fallos.push(`No se pudo conectar a la base del Moodle: ${error.message}`);
    return informe;
  }

  try {
    const instalada = await leerValorDeConfig(cliente, prefijo, 'version');
    revisarVersion(instalada, objetivo, informe);
    const release = await leerValorDeConfig(cliente, prefijo, 'release');
    if (release !== null) informe.datos.releaseInstalado = release;
  } catch (error) {
    if (error.code === SIN_TABLA) {
      informe.datos.esquemaInstalado = null;
      informe.avisos.push(
        `No existe la tabla ${prefijo}config: la base esta limpia y sin instalar, asi que no arrastra `
        + 'esquema de ninguna rama. Se puede levantar el sitio sobre la rama estable.'
      );
    } else if (error.code === SIN_PERMISO) {
      informe.fallos.push(
        `El rol no puede leer ${prefijo}config, asi que no se puede comprobar la version del esquema. `
        + 'Use un rol con lectura sobre esa tabla.'
      );
    } else {
      informe.fallos.push(`Fallo la consulta de la version del esquema: ${error.message}`);
    }
  } finally {
    await cliente.end().catch(() => {});
  }
  return informe;
}

async function principal() {
  const registro = crearRegistro({
    entorno: process.env.NODE_ENV || 'development',
    nivel: (process.env.LOG_NIVEL || 'info').trim().toLowerCase()
  }).hijo({ proceso: 'comprobar-moodle-base' });

  const informe = await comprobar();
  for (const aviso of informe.avisos) registro.aviso(aviso);
  for (const fallo of informe.fallos) registro.error(fallo);
  if (informe.fallos.length > 0) {
    registro.error('la base del Moodle no admite la rama estable', informe.datos);
    process.exitCode = 1;
    return;
  }
  registro.info('la base del Moodle admite la rama estable', informe.datos);
}

if (require.main === module) {
  principal().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      nivel: 'error',
      mensaje: 'la comprobacion de la base del Moodle fallo',
      detalle: String(error && error.message)
    })}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  comprobar, leerObjetivo, compararVersiones, partesDeVersion, prefijoDe, revisarVersion,
  PREFIJO_POR_DEFECTO, PREFIJO_VALIDO
};
