'use strict';

// Cliente de los servicios web de Moodle. Sirve para cualquier sitio Moodle,
// incluidas las plataformas E-Learning y Academias de INFOP.
//
// Las credenciales viajan siempre en el cuerpo de la peticion, nunca en la URL,
// para que no queden en registros de acceso.

const { enviar, ErrorDeRed } = require('../seguridad/red');

const SERVICIO_MOVIL = 'moodle_mobile_app';

class ErrorDeMoodle extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorDeMoodle';
    this.codigo = codigo;
  }
}

const CODIGOS_DE_CREDENCIAL = new Set(['invalidlogin', 'invalidtoken', 'accessexception', 'usernamenotfound']);

function traducirError(codigo, mensaje) {
  if (CODIGOS_DE_CREDENCIAL.has(codigo)) {
    return new ErrorDeMoodle('CREDENCIAL_RECHAZADA', 'La plataforma rechazo las credenciales.');
  }
  if (codigo === 'enablewsdescription' || codigo === 'servicenotavailable') {
    return new ErrorDeMoodle('SERVICIO_NO_DISPONIBLE', 'La plataforma no tiene habilitados los servicios web.');
  }
  if (codigo === 'sitemaintenance' || codigo === 'upgraderunning') {
    return new ErrorDeMoodle('EN_MANTENIMIENTO', 'La plataforma esta en mantenimiento.');
  }
  return new ErrorDeMoodle('ERROR_REMOTO', String(mensaje || 'La plataforma devolvio un error.').slice(0, 200));
}

function crearClienteMoodle(opciones = {}) {
  const red = { permitirRedPrivada: opciones.permitirRedPrivada, tiempoMaximoMs: opciones.tiempoMaximoMs };

  // Datos publicos del sitio: no requiere credenciales.
  async function configuracionPublica(urlBase) {
    const respuesta = await enviar(`${urlBase}/lib/ajax/service-nologin.php?info=tool_mobile_get_public_config`, {
      ...red,
      json: [{ index: 0, methodname: 'tool_mobile_get_public_config', args: {} }]
    });
    const primero = Array.isArray(respuesta) ? respuesta[0] : null;
    if (!primero || primero.error || !primero.data || !primero.data.wwwroot) {
      throw new ErrorDeMoodle('NO_ES_MOODLE', 'La direccion no corresponde a un sitio Moodle.');
    }
    const d = primero.data;
    return {
      nombre: String(d.sitename || ''),
      url: String(d.httpswwwroot || d.wwwroot),
      serviciosWeb: d.enablewebservices === 1,
      servicioMovil: d.enablemobilewebservice === 1,
      enMantenimiento: d.maintenanceenabled === 1,
      // 1 = formulario propio; 2 y 3 = inicio de sesion en el navegador (SSO).
      inicioConFormulario: d.typeoflogin === 1
    };
  }

  // Cambia usuario y contrasena por un token personal. La contrasena no se conserva.
  async function obtenerToken(urlBase, usuario, clave) {
    const respuesta = await enviar(`${urlBase}/login/token.php`, {
      ...red,
      formulario: { username: usuario, password: clave, service: SERVICIO_MOVIL }
    });
    if (respuesta && typeof respuesta.token === 'string' && respuesta.token) return respuesta.token;
    throw traducirError(respuesta && respuesta.errorcode, respuesta && respuesta.error);
  }

  async function llamar(urlBase, token, funcion, parametros = {}) {
    const respuesta = await enviar(`${urlBase}/webservice/rest/server.php`, {
      ...red,
      formulario: { wstoken: token, wsfunction: funcion, moodlewsrestformat: 'json', ...parametros }
    });
    if (respuesta && respuesta.exception) throw traducirError(respuesta.errorcode, respuesta.message);
    return respuesta;
  }

  async function infoDelSitio(urlBase, token) {
    const info = await llamar(urlBase, token, 'core_webservice_get_site_info');
    if (!info || !Number.isInteger(info.userid)) {
      throw new ErrorDeMoodle('ERROR_REMOTO', 'La plataforma no devolvio la identidad del usuario.');
    }
    return {
      usuarioId: info.userid,
      nombreCompleto: String(info.fullname || ''),
      sitio: String(info.sitename || ''),
      version: String(info.release || '')
    };
  }

  // Cursos en los que esta inscrito el usuario, con avance y calificacion.
  async function cursosDelUsuario(urlBase, token, usuarioId) {
    const [cursos, notas] = await Promise.all([
      llamar(urlBase, token, 'core_enrol_get_users_courses', { userid: usuarioId }),
      llamar(urlBase, token, 'gradereport_overview_get_course_grades', { userid: usuarioId })
        .catch(() => ({ grades: [] }))
    ]);
    const notaPorCurso = new Map(((notas && notas.grades) || []).map((n) => [n.courseid, n.grade]));
    return (Array.isArray(cursos) ? cursos : []).map((curso) => ({
      id: curso.id,
      nombre: String(curso.fullname || ''),
      codigo: String(curso.shortname || ''),
      avance: typeof curso.progress === 'number' ? Math.round(curso.progress) : null,
      completado: curso.completed === true,
      calificacion: notaPorCurso.has(curso.id) ? String(notaPorCurso.get(curso.id)) : null,
      inicio: curso.startdate ? new Date(curso.startdate * 1000).toISOString() : null,
      fin: curso.enddate ? new Date(curso.enddate * 1000).toISOString() : null,
      enlace: `${urlBase}/course/view.php?id=${encodeURIComponent(curso.id)}`
    }));
  }

  return { configuracionPublica, obtenerToken, infoDelSitio, cursosDelUsuario };
}

module.exports = { crearClienteMoodle, ErrorDeMoodle, ErrorDeRed };
