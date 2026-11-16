/* ESOE SMS - Pantallas y tamano del texto.
   mostrarPantalla deja un solo <main> visible: el del acceso o el de la aplicacion.
   El tamano del texto escala toda la escala tipografica (definida en rem) y se recuerda en este
   navegador; si el almacenamiento no esta disponible, simplemente no se recuerda. */

function mostrarPantalla(cual) {
  const enApp = cual === 'app';
  document.getElementById('login-screen').classList.toggle('hidden', enApp);
  document.getElementById('app-shell').classList.toggle('hidden', !enApp);
  document.getElementById('acceso-principal').hidden = enApp;
  document.getElementById('content-area').hidden = !enApp;
  // Si la sesion se abre durante la presentacion, la presentacion termina.
  if (enApp && typeof cerrarIntro === 'function') cerrarIntro();
}

const TAMANOS_TEXTO = ['normal', 'grande', 'muy-grande'];
const CLAVE_TAMANO_TEXTO = 'esoe.tamanoTexto';

function aplicarTamanoTexto(tamano) {
  const elegido = TAMANOS_TEXTO.includes(tamano) ? tamano : 'normal';
  if (elegido === 'normal') document.documentElement.removeAttribute('data-texto');
  else document.documentElement.setAttribute('data-texto', elegido);
  document.querySelectorAll('[data-tamano-texto]').forEach((boton) => {
    boton.setAttribute('aria-pressed', String(boton.dataset.tamanoTexto === elegido));
  });
  return elegido;
}

function cambiarTamanoTexto(tamano) {
  const elegido = aplicarTamanoTexto(tamano);
  try { localStorage.setItem(CLAVE_TAMANO_TEXTO, elegido); } catch { /* sin almacenamiento */ }
}

(function restaurarTamanoTexto() {
  let guardado = null;
  try { guardado = localStorage.getItem(CLAVE_TAMANO_TEXTO); } catch { /* sin almacenamiento */ }
  aplicarTamanoTexto(guardado);
})();
