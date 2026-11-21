function mostrarPantalla(cual) {
  const enApp = cual === 'app';
  document.getElementById('login-screen').classList.toggle('hidden', enApp);
  document.getElementById('app-shell').classList.toggle('hidden', !enApp);
  document.getElementById('acceso-principal').hidden = enApp;
  document.getElementById('content-area').hidden = !enApp;
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
  try { localStorage.setItem(CLAVE_TAMANO_TEXTO, elegido); } catch {}
}

function duracionAviso(texto) {
  const palabras = String(texto || '').trim().split(/\s+/).filter(Boolean).length;
  return Math.min(12000, Math.max(4000, 1500 + palabras * 350));
}

(function restaurarTamanoTexto() {
  let guardado = null;
  try { guardado = localStorage.getItem(CLAVE_TAMANO_TEXTO); } catch {}
  aplicarTamanoTexto(guardado);
})();
