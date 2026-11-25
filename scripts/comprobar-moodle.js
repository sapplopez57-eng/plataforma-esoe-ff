'use strict';

const { crearRegistro } = require('../src/registro');
const { normalizarUrlBase, obtener, ErrorDeRed } = require('../src/seguridad/red');
const { crearClienteMoodle, ErrorDeMoodle } = require('../src/integraciones/moodle');

const FUNCIONES_EXIGIDAS = Object.freeze([
  'core_webservice_get_site_info',
  'core_enrol_get_users_courses',
  'core_user_get_users_by_field'
]);
const FUNCIONES_RECOMENDADAS = Object.freeze(['gradereport_overview_get_course_grades']);
const ARCHIVOS_FUERA_DEL_DOCROOT = Object.freeze([
  'composer.json', 'composer.lock', 'UPGRADING.md', 'Gruntfile.js', 'phpunit.xml.dist'
]);
const CODIGOS_DE_ARCHIVO_SERVIDO = Object.freeze(['RESPUESTA_DEMASIADO_GRANDE', 'TIEMPO_AGOTADO']);
const RELEASE_INESTABLE = /(^|[^a-z])(dev|alpha|beta|rc[0-9]*)([^a-z]|$)/i;
const TIEMPO_MAXIMO_MS = 10000;

function informeNuevo() {
  return { datos: {}, fallos: [], avisos: [] };
}

async function revisarDocroot(urlBase, red, informe) {
  const expuestos = [];
  for (const archivo of ARCHIVOS_FUERA_DEL_DOCROOT) {
    try {
      const respuesta = await obtener(`${urlBase}/${archivo}`, red);
      if (respuesta.estado === 200) expuestos.push(archivo);
    } catch (error) {
      if (!(error instanceof ErrorDeRed)) throw error;
      if (CODIGOS_DE_ARCHIVO_SERVIDO.includes(error.codigo) && error.estado === 200) expuestos.push(archivo);
    }
  }
  informe.datos.archivosExpuestos = expuestos;
  if (expuestos.length > 0) {
    informe.fallos.push(
      `El servidor publica archivos que viven fuera de public/ (${expuestos.join(', ')}). `
      + 'El DocumentRoot apunta a la raiz del codigo en vez de a public/: corrijalo antes de abrir el sitio.'
    );
  }
}

function revisarRelease(release, esProduccion, informe) {
  informe.datos.release = release;
  if (!release) {
    informe.avisos.push('La plataforma no declaro su version: no se pudo comprobar la madurez.');
    return;
  }
  if (!RELEASE_INESTABLE.test(release)) return;
  const texto = `La plataforma declara la version ${release}, que es una rama de desarrollo y no una estable.`;
  if (esProduccion) {
    informe.fallos.push(`${texto} No la use en produccion con expedientes reales.`);
  } else {
    informe.avisos.push(texto);
  }
}

async function revisarSitio(cliente, urlBase, informe) {
  const sitio = await cliente.configuracionPublica(urlBase);
  informe.datos.sitio = sitio.nombre;
  informe.datos.urlDeclarada = sitio.url;
  informe.datos.enMantenimiento = sitio.enMantenimiento;
  if (!sitio.serviciosWeb) {
    informe.fallos.push('La plataforma no tiene habilitados los servicios web: la integracion no puede funcionar.');
  }
  if (!sitio.servicioMovil) {
    informe.fallos.push('La plataforma no tiene habilitado el servicio movil (moodle_mobile_app), que es el que usa la integracion.');
  }
  if (sitio.enMantenimiento) {
    informe.avisos.push('La plataforma esta en mantenimiento ahora mismo.');
  }
  return sitio;
}

async function revisarCapacidades(cliente, urlBase, token, informe) {
  const capacidades = await cliente.capacidades(urlBase, token);
  informe.datos.funcionesDisponibles = capacidades.funciones.length;
  const faltan = FUNCIONES_EXIGIDAS.filter((f) => !capacidades.funciones.includes(f));
  const recomendadasQueFaltan = FUNCIONES_RECOMENDADAS.filter((f) => !capacidades.funciones.includes(f));
  if (faltan.length > 0) {
    informe.fallos.push(
      `El token no puede llamar a funciones que la integracion necesita (${faltan.join(', ')}). `
      + 'Agreguelas al servicio externo de la plataforma.'
    );
  }
  if (recomendadasQueFaltan.length > 0) {
    informe.avisos.push(
      `El token no puede llamar a ${recomendadasQueFaltan.join(', ')}: las calificaciones del portal se veran vacias.`
    );
  }
  return capacidades;
}

async function comprobar(entorno = process.env, dependencias = {}) {
  const informe = informeNuevo();
  const esProduccion = (entorno.NODE_ENV || 'development') === 'production';
  const permitirRedPrivada = ['1', 'true', 'si', 'yes']
    .includes(String(entorno.INTEGRACIONES_RED_PRIVADA || '').trim().toLowerCase());
  const red = { permitirRedPrivada, tiempoMaximoMs: TIEMPO_MAXIMO_MS };
  const cliente = dependencias.cliente || crearClienteMoodle(red);

  let urlBase;
  try {
    urlBase = normalizarUrlBase(entorno.MOODLE_URL, { permitirRedPrivada });
  } catch (error) {
    informe.fallos.push(`MOODLE_URL no sirve: ${error.message}`);
    return informe;
  }
  informe.datos.url = urlBase;

  try {
    await revisarSitio(cliente, urlBase, informe);
    await revisarDocroot(urlBase, red, informe);
  } catch (error) {
    if (error instanceof ErrorDeMoodle || error instanceof ErrorDeRed) {
      informe.fallos.push(`No se pudo interrogar a la plataforma: ${error.message}`);
      return informe;
    }
    throw error;
  }

  const token = String(entorno.MOODLE_TOKEN_SERVICIO || '').trim();
  if (!token) {
    informe.avisos.push('MOODLE_TOKEN_SERVICIO no definido: no se comprobaron las funciones del servicio externo.');
    return informe;
  }

  try {
    const capacidades = await revisarCapacidades(cliente, urlBase, token, informe);
    revisarRelease(capacidades.release, esProduccion, informe);
  } catch (error) {
    if (error instanceof ErrorDeMoodle || error instanceof ErrorDeRed) {
      informe.fallos.push(`El token de servicio no sirve: ${error.message}`);
      return informe;
    }
    throw error;
  }
  return informe;
}

async function principal() {
  const registro = crearRegistro({
    entorno: process.env.NODE_ENV || 'development',
    nivel: (process.env.LOG_NIVEL || 'info').trim().toLowerCase()
  }).hijo({ proceso: 'comprobar-moodle' });

  const informe = await comprobar();
  for (const aviso of informe.avisos) registro.aviso(aviso);
  for (const fallo of informe.fallos) registro.error(fallo);
  if (informe.fallos.length > 0) {
    registro.error('la plataforma Moodle no esta lista para la integracion', informe.datos);
    process.exitCode = 1;
    return;
  }
  registro.info('la plataforma Moodle esta lista para la integracion', informe.datos);
}

if (require.main === module) {
  principal().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      nivel: 'error', mensaje: 'la comprobacion de Moodle fallo', detalle: String(error && error.message)
    })}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  comprobar, revisarRelease, revisarDocroot, revisarCapacidades,
  FUNCIONES_EXIGIDAS, FUNCIONES_RECOMENDADAS, ARCHIVOS_FUERA_DEL_DOCROOT
};
