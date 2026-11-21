const sesionReal = { activa: false, clerk: null, integraciones: false, nombre: '', correo: '' };

function esc(valor) {
  return String(valor === null || valor === undefined ? '' : valor).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function cargarScript(src, atributos) {
  return new Promise((resolver, rechazar) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.crossOrigin = 'anonymous';
    Object.entries(atributos || {}).forEach(([clave, valor]) => script.setAttribute(clave, valor));
    script.onload = resolver;
    script.onerror = () => rechazar(new Error('No se pudo cargar el inicio de sesion.'));
    document.head.appendChild(script);
  });
}

class ErrorDeApi extends Error {
  constructor(estado, cuerpo) {
    super((cuerpo && cuerpo.error) || 'No se pudo completar la operacion.');
    this.estado = estado;
    this.codigo = cuerpo && cuerpo.codigo;
    this.campos = cuerpo && cuerpo.campos;
  }
}

async function api(ruta, opciones) {
  const { metodo = 'GET', cuerpo } = opciones || {};
  const cabeceras = { Accept: 'application/json' };
  if (sesionReal.clerk && sesionReal.clerk.session) {
    cabeceras.Authorization = `Bearer ${await sesionReal.clerk.session.getToken()}`;
  }
  if (cuerpo !== undefined) cabeceras['Content-Type'] = 'application/json';
  const respuesta = await fetch(`/api${ruta}`, {
    method: metodo,
    headers: cabeceras,
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo)
  });
  if (respuesta.status === 204) return null;
  const datos = await respuesta.json().catch(() => null);
  if (!respuesta.ok) throw new ErrorDeApi(respuesta.status, datos);
  return datos;
}

function mostrarAvisoDeAcceso(texto) {
  const aviso = document.getElementById('login-aviso');
  aviso.textContent = texto;
  aviso.classList.toggle('hidden', !texto);
}

async function entrarConSesionReal() {
  const clerk = sesionReal.clerk;
  let identidad;
  try {
    identidad = await api('/sesion');
  } catch (error) {
    document.getElementById('login-clerk').innerHTML = '';
    mostrarAvisoDeAcceso(error.estado === 403
      ? 'Su cuenta todavía no tiene un rol asignado. Solicítelo a la administración.'
      : 'No se pudo validar la sesión. Intente de nuevo.');
    const salir = document.getElementById('login-salir');
    salir.classList.remove('hidden');
    return;
  }

  const usuario = clerk.user || {};
  sesionReal.nombre = usuario.fullName || usuario.username || '';
  sesionReal.correo = (usuario.primaryEmailAddress && usuario.primaryEmailAddress.emailAddress) || '';
  appState.authenticated = true;
  appState.currentRole = identidad.rol;
  appState.currentView = identidad.rol === 'ESTUDIANTE' ? 'boletin' : 'dashboard';

  store = emptyStore();
  await cargarDesdeServidor();

  mostrarPantalla('app');
  renderSidebarAndHeader();
  renderMainView();
}

async function iniciarSesionReal(configuracion) {
  const { llavePublica, dominio } = configuracion.autenticacion;
  await cargarScript(`https://${dominio}/npm/@clerk/ui@1/dist/ui.browser.js`);
  await cargarScript(`https://${dominio}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`, {
    'data-clerk-publishable-key': llavePublica
  });
  await window.Clerk.load({
    ui: { ClerkUI: window.__internal_ClerkUICtor },
    localization: window.LOCALIZACION_ES
  });

  sesionReal.activa = true;
  sesionReal.clerk = window.Clerk;
  sesionReal.integraciones = Boolean(configuracion.integraciones);

  document.getElementById('login-demo').classList.add('hidden');
  document.getElementById('role-quick-switch').classList.add('hidden');

  if (sesionReal.clerk.isSignedIn) {
    await entrarConSesionReal();
  } else {
    sesionReal.clerk.mountSignIn(document.getElementById('login-clerk'));
    sesionReal.clerk.addListener(({ session }) => {
      if (session && !appState.authenticated) entrarConSesionReal();
    });
  }
}

async function cerrarSesionReal() {
  await sesionReal.clerk.signOut();
  window.location.reload();
}

async function iniciarPlataforma() {
  if (window.location.protocol === 'file:') return;
  let configuracion;
  try {
    const respuesta = await fetch('/api/config', { headers: { Accept: 'application/json' } });
    if (!respuesta.ok) return;
    configuracion = await respuesta.json();
  } catch {
    return;
  }
  if (!configuracion.autenticacion) return;

  document.getElementById('login-demo').classList.add('hidden');
  try {
    await iniciarSesionReal(configuracion);
  } catch {
    mostrarAvisoDeAcceso('No se pudo cargar el inicio de sesión. Revise su conexión y recargue la página.');
  }
}

document.addEventListener('DOMContentLoaded', iniciarPlataforma);
