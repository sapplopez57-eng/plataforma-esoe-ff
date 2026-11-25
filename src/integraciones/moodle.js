'use strict';

const { enviar, conReintentos, ErrorDeRed } = require('../seguridad/red');

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
  const registro = opciones.registro || null;
  const reintentos = {
    ...(opciones.reintentos || {}),
    anotar: (detalle) => {
      if (registro) registro.aviso('reintento contra plataforma remota', detalle);
    }
  };

  async function leer(direccion, peticion) {
    try {
      return await conReintentos(() => enviar(direccion, { ...red, ...peticion }), reintentos);
    } catch (error) {
      if (error instanceof ErrorDeRed && error.estado === 503) {
        throw new ErrorDeMoodle('EN_MANTENIMIENTO', 'La plataforma esta en mantenimiento.');
      }
      throw error;
    }
  }

  async function configuracionPublica(urlBase) {
    const respuesta = await leer(`${urlBase}/lib/ajax/service-nologin.php?info=tool_mobile_get_public_config`, {
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
      inicioConFormulario: d.typeoflogin === 1
    };
  }

  async function obtenerToken(urlBase, usuario, clave) {
    const respuesta = await enviar(`${urlBase}/login/token.php`, {
      ...red,
      formulario: { username: usuario, password: clave, service: SERVICIO_MOVIL }
    });
    if (respuesta && typeof respuesta.token === 'string' && respuesta.token) return respuesta.token;
    throw traducirError(respuesta && respuesta.errorcode, respuesta && respuesta.error);
  }

  async function llamar(urlBase, token, funcion, parametros = {}) {
    const respuesta = await leer(`${urlBase}/webservice/rest/server.php`, {
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

  async function buscarUsuarioExacto(urlBase, tokenServicio, campo, valor) {
    const buscado = String(valor || '').trim();
    if (!buscado) return null;
    const respuesta = await llamar(urlBase, tokenServicio, 'core_user_get_users_by_field', { field: campo, 'values[0]': buscado });
    const lista = Array.isArray(respuesta) ? respuesta : [];
    const iguales = lista.filter((u) => Number.isInteger(u.id)
      && String(campo === 'email' ? u.email : u.idnumber || '').trim().toLowerCase() === buscado.toLowerCase());
    if (iguales.length !== 1) return null;
    return { usuarioId: iguales[0].id, nombreCompleto: String(iguales[0].fullname || '') };
  }

  async function detectarInscripcion(urlBase, tokenServicio, { correo, identidad }) {
    const porCorreo = await buscarUsuarioExacto(urlBase, tokenServicio, 'email', correo);
    if (porCorreo) return { ...porCorreo, coincidencia: 'CORREO' };
    const porIdentidad = await buscarUsuarioExacto(urlBase, tokenServicio, 'idnumber', identidad);
    if (porIdentidad) return { ...porIdentidad, coincidencia: 'IDENTIDAD' };
    return null;
  }

  async function capacidades(urlBase, token) {
    const info = await llamar(urlBase, token, 'core_webservice_get_site_info');
    if (!info || !Number.isInteger(info.userid)) {
      throw new ErrorDeMoodle('ERROR_REMOTO', 'La plataforma no devolvio la identidad del usuario.');
    }
    const lista = Array.isArray(info.functions) ? info.functions : [];
    return {
      usuarioId: info.userid,
      sitio: String(info.sitename || ''),
      release: String(info.release || ''),
      funciones: lista.map((f) => String((f && f.name) || '')).filter(Boolean)
    };
  }

  return { configuracionPublica, obtenerToken, infoDelSitio, cursosDelUsuario, detectarInscripcion, capacidades };
}

module.exports = { crearClienteMoodle, ErrorDeMoodle, ErrorDeRed };
