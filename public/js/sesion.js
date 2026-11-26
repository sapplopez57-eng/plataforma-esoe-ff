const sesionReal = { activa: false, clerk: null, integraciones: false, sinServidor: false, nombre: '', correo: '' };

function tokenDeTema(nombre, respaldo) {
  const valor = getComputedStyle(document.documentElement).getPropertyValue(nombre);
  return (valor || '').trim() || respaldo;
}

function variablesDeAcceso() {
  const esNoche = document.documentElement.hasAttribute('data-noche');
  return {
    fontFamily: "'DM Sans', system-ui, sans-serif",
    fontFamilyButtons: "'DM Sans', system-ui, sans-serif",
    borderRadius: '14px',
    colorPrimary: tokenDeTema('--marca-2', '#0A2A35'),
    colorText: tokenDeTema('--texto', '#0F2A33'),
    colorTextSecondary: tokenDeTema('--sobre-estructura-tenue', '#41606B'),
    colorBackground: 'transparent',
    colorInputBackground: esNoche
      ? tokenDeTema('--acceso-campo-noche', 'rgba(255, 255, 255, 0.08)')
      : tokenDeTema('--vidrio-pulgar', 'rgba(255, 255, 255, 0.72)'),
    colorInputText: tokenDeTema('--texto', '#0F2A33'),
    colorDanger: tokenDeTema('--acento-titulo', '#B8440C')
  };
}

const APARIENCIA_ACCESO = {
  get variables() {
    return variablesDeAcceso();
  },
  layout: { socialButtonsPlacement: 'bottom', socialButtonsVariant: 'blockButton', showOptionalFields: false },
  elements: {
    rootBox: 'acceso-raiz',
    cardBox: 'acceso-tarjeta',
    card: 'acceso-tarjeta-interior',
    header: 'acceso-oculto',
    socialButtonsRoot: 'acceso-oculto',
    dividerRow: 'acceso-oculto',
    footer: 'acceso-pie',
    footerAction: 'acceso-oculto',
    formFieldLabel: 'acceso-etiqueta',
    formFieldInput: 'acceso-campo',
    formButtonPrimary: 'acceso-boton',
    identityPreview: 'acceso-identidad',
    formFieldAction: 'acceso-enlace',
    footerActionLink: 'acceso-enlace'
  }
};

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
  const elegida = typeof leerInstitucionElegida === 'function' ? leerInstitucionElegida() : '';
  if (elegida) cabeceras['X-Institucion'] = elegida;
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

const ROLES_DE_ACCESO = ['ADMIN', 'CATEDRATICO', 'ESTUDIANTE'];

function identidadDesdeClerk(clerk) {
  const metadatos = (clerk.user && clerk.user.publicMetadata) || {};
  if (!ROLES_DE_ACCESO.includes(metadatos.rol)) throw new ErrorDeApi(403, null);
  return { rol: metadatos.rol };
}

async function entrarConSesionReal() {
  const clerk = sesionReal.clerk;
  let identidad;
  try {
    identidad = sesionReal.sinServidor ? identidadDesdeClerk(clerk) : await api('/sesion');
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
  if (sesionReal.sinServidor) {
    showToast('Sesión iniciada. Los datos académicos se cargan desde la dirección institucional de la plataforma.');
  } else {
    await cargarDesdeServidor();
    await cargarInstituciones();
  }

  mostrarPantalla('app');
  renderSidebarAndHeader();
  renderMainView();
  montarBotonDeUsuario();
}

function opcionesDelBotonDeUsuario() {
  return {
    appearance: { variables: variablesDeAcceso() },
    showName: false,
    afterSignOutUrl: window.location.origin + window.location.pathname
  };
}

function montarBotonDeUsuario() {
  const caja = document.getElementById('sidebar-user-boton');
  if (!caja || !sesionReal.clerk || !sesionReal.clerk.isSignedIn) return;
  sesionReal.clerk.mountUserButton(caja, opcionesDelBotonDeUsuario());
  caja.classList.remove('hidden');
  document.getElementById('sidebar-user-avatar').classList.add('hidden');
  const salir = document.querySelector('.btn-logout');
  if (salir) salir.classList.add('hidden');
  vigilarTemaDelBoton(caja);
}

function vigilarTemaDelBoton(caja) {
  if (sesionReal.vigilaTemaBoton) return;
  let eraNoche = document.documentElement.hasAttribute('data-noche');
  sesionReal.vigilaTemaBoton = new MutationObserver(() => {
    const esNoche = document.documentElement.hasAttribute('data-noche');
    if (esNoche === eraNoche || !sesionReal.clerk.isSignedIn) return;
    eraNoche = esNoche;
    sesionReal.clerk.unmountUserButton(caja);
    sesionReal.clerk.mountUserButton(caja, opcionesDelBotonDeUsuario());
  });
  sesionReal.vigilaTemaBoton.observe(document.documentElement, { attributes: true, attributeFilter: ['data-noche'] });
}

async function iniciarSesionReal(configuracion) {
  const { llavePublica, dominio } = configuracion.autenticacion;
  await cargarScript(`https://${dominio}/npm/@clerk/ui@1/dist/ui.browser.js`);
  await cargarScript(`https://${dominio}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`, {
    'data-clerk-publishable-key': llavePublica
  });
  const regreso = window.location.origin + window.location.pathname;
  await window.Clerk.load({
    ui: { ClerkUI: window.__internal_ClerkUICtor },
    signInForceRedirectUrl: regreso,
    signUpForceRedirectUrl: regreso,
    afterSignOutUrl: regreso,
    localization: window.LOCALIZACION_ES
  });

  sesionReal.activa = true;
  sesionReal.clerk = window.Clerk;
  sesionReal.integraciones = Boolean(configuracion.integraciones);
  sesionReal.sinServidor = Boolean(configuracion.sinServidor);

  document.getElementById('login-estado').classList.add('hidden');

  if (sesionReal.clerk.isSignedIn) {
    await entrarConSesionReal();
  } else {
    montarAcceso(regreso);
    seguirElTema(regreso);
    sesionReal.clerk.addListener(({ session }) => {
      if (session && !appState.authenticated) entrarConSesionReal();
    });
  }
}

function montarAcceso(regreso) {
  const caja = document.getElementById('login-clerk');
  if (!caja || !sesionReal.clerk) return;
  sesionReal.clerk.mountSignIn(caja, {
    appearance: { ...APARIENCIA_ACCESO, variables: variablesDeAcceso() },
    routing: 'virtual',
    forceRedirectUrl: regreso,
    fallbackRedirectUrl: regreso
  });
}

function seguirElTema(regreso) {
  if (sesionReal.vigilaTema) return;
  const caja = document.getElementById('login-clerk');
  if (!caja) return;
  let eraNoche = document.documentElement.hasAttribute('data-noche');
  sesionReal.vigilaTema = new MutationObserver(() => {
    const esNoche = document.documentElement.hasAttribute('data-noche');
    if (esNoche === eraNoche) return;
    eraNoche = esNoche;
    if (sesionReal.clerk.isSignedIn) return;
    sesionReal.clerk.unmountSignIn(caja);
    montarAcceso(regreso);
  });
  sesionReal.vigilaTema.observe(document.documentElement, { attributes: true, attributeFilter: ['data-noche'] });
}

async function cerrarSesionReal() {
  if (typeof guardarInstitucionElegida === 'function') guardarInstitucionElegida('');
  await sesionReal.clerk.signOut({ redirectUrl: window.location.origin + window.location.pathname });
  window.location.reload();
}

async function leerJson(ruta) {
  try {
    const respuesta = await fetch(ruta, { headers: { Accept: 'application/json' } });
    if (!respuesta.ok) return null;
    return await respuesta.json();
  } catch {
    return null;
  }
}

async function leerConfiguracion() {
  const delServidor = await leerJson('/api/config');
  if (delServidor) return delServidor;
  const publica = await leerJson('config-publica.json');
  return publica ? { ...publica, sinServidor: true } : null;
}

async function iniciarPlataforma() {
  const estado = document.getElementById('login-estado');
  const noDisponible = () => {
    estado.classList.remove('hidden');
    estado.querySelector('p').textContent = 'El acceso institucional no está disponible en este sitio. Contacte con la administración o vuelva a intentarlo más tarde. Por seguridad, el acceso requiere verificar su cuenta.';
  };
  if (window.location.protocol === 'file:') return noDisponible();
  const configuracion = await leerConfiguracion();
  if (!configuracion || !configuracion.autenticacion) return noDisponible();

  estado.classList.add('hidden');
  try {
    await iniciarSesionReal(configuracion);
  } catch {
    noDisponible();
    mostrarAvisoDeAcceso('No se pudo cargar el inicio de sesión. Revise su conexión y recargue la página.');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('reintentar-acceso').addEventListener('click', () => window.location.reload());
  iniciarPlataforma();
});
