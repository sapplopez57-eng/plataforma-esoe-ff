/* ESOE SMS - Ambiente: reloj, plano del campus, modo noche y sonido ambiental.
   El sonido se sintetiza en el navegador (Web Audio): un acorde lento y el
   rumor del mar. No descarga archivos ni suena solo: arranca cuando la persona
   lo pide y se apaga con el mismo boton. El modo noche se recuerda en este
   navegador; si el almacenamiento no esta disponible, simplemente no se recuerda. */

const CLAVE_NOCHE = 'esoe.noche';

function marcarBotones(selector, activo) {
  document.querySelectorAll(selector).forEach((boton) => boton.setAttribute('aria-pressed', String(activo)));
}

// ---------- Reloj ----------

function horaLocal(fecha) {
  const dos = (n) => String(n).padStart(2, '0');
  return `${dos(fecha.getHours())}:${dos(fecha.getMinutes())}`;
}

function actualizarReloj(fecha = new Date()) {
  const texto = horaLocal(fecha);
  document.querySelectorAll('[data-reloj]').forEach((t) => {
    t.textContent = texto;
    t.setAttribute('datetime', texto);
  });
}

// ---------- Plano ----------

function alternarPlano() {
  const pantalla = document.getElementById('login-screen');
  const oculto = pantalla.classList.toggle('plano-oculto');
  marcarBotones('[data-atlas]', !oculto);
}

// ---------- Noche ----------

function aplicarNoche(activa) {
  if (activa) document.documentElement.setAttribute('data-noche', '');
  else document.documentElement.removeAttribute('data-noche');
  marcarBotones('[data-noche]', activa);
  return activa;
}

function alternarNoche() {
  const activa = aplicarNoche(!document.documentElement.hasAttribute('data-noche'));
  try { localStorage.setItem(CLAVE_NOCHE, activa ? '1' : '0'); } catch { /* sin almacenamiento */ }
}

// ---------- Sonido ----------

const sonido = { contexto: null, maestro: null, activo: false };

// Notas del acorde (La menor con novena): graves y suaves, para acompanar sin distraer.
const ACORDE = [110, 164.81, 220, 246.94, 329.63];

function construirSonido(Contexto) {
  const ctx = new Contexto();
  const maestro = ctx.createGain();
  maestro.gain.value = 0;
  maestro.connect(ctx.destination);

  // Acorde: dos osciladores ligeramente desafinados por nota, por un filtro que respira.
  const filtro = ctx.createBiquadFilter();
  filtro.type = 'lowpass';
  filtro.frequency.value = 700;
  filtro.connect(maestro);
  const respiro = ctx.createOscillator();
  const profundidad = ctx.createGain();
  respiro.frequency.value = 0.05;
  profundidad.gain.value = 260;
  respiro.connect(profundidad);
  profundidad.connect(filtro.frequency);
  respiro.start();
  for (const frecuencia of ACORDE) {
    for (const desvio of [-3, 3]) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = frecuencia;
      osc.detune.value = desvio;
      g.gain.value = 0.018;
      osc.connect(g);
      g.connect(filtro);
      osc.start();
    }
  }

  // Mar: ruido filtrado cuyo volumen sube y baja como las olas.
  const muestras = ctx.sampleRate * 2;
  const buffer = ctx.createBuffer(1, muestras, ctx.sampleRate);
  const datos = buffer.getChannelData(0);
  for (let i = 0; i < muestras; i += 1) datos[i] = Math.random() * 2 - 1;
  const ruido = ctx.createBufferSource();
  ruido.buffer = buffer;
  ruido.loop = true;
  const banda = ctx.createBiquadFilter();
  banda.type = 'bandpass';
  banda.frequency.value = 420;
  banda.Q.value = 0.6;
  const olas = ctx.createGain();
  olas.gain.value = 0.05;
  const ritmo = ctx.createOscillator();
  const amplitud = ctx.createGain();
  ritmo.frequency.value = 0.09;
  amplitud.gain.value = 0.04;
  ritmo.connect(amplitud);
  amplitud.connect(olas.gain);
  ruido.connect(banda);
  banda.connect(olas);
  olas.connect(maestro);
  ruido.start();
  ritmo.start();

  return { ctx, maestro };
}

function alternarSonido() {
  const Contexto = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Contexto) return false;
  if (!sonido.contexto) {
    const { ctx, maestro } = construirSonido(Contexto);
    sonido.contexto = ctx;
    sonido.maestro = maestro;
  }
  const ctx = sonido.contexto;
  const ahora = ctx.currentTime;
  sonido.activo = !sonido.activo;
  sonido.maestro.gain.cancelScheduledValues(ahora);
  sonido.maestro.gain.setValueAtTime(sonido.maestro.gain.value, ahora);
  if (sonido.activo) {
    if (ctx.state === 'suspended') ctx.resume();
    sonido.maestro.gain.linearRampToValueAtTime(0.5, ahora + 2);
  } else {
    sonido.maestro.gain.linearRampToValueAtTime(0, ahora + 0.8);
  }
  marcarBotones('[data-sonido]', sonido.activo);
  return sonido.activo;
}

// ---------- Movimiento ----------

// Quien pidio a su sistema reducir el movimiento no ve la presentacion, ni la
// escena siguiendo el puntero, ni cifras contando.
function sinMovimiento() {
  return Boolean(globalThis.matchMedia && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

// ---------- Presentacion (video del escudo) ----------

const CLAVE_INTRO = 'esoe.intro';

function teclaIntro(evento) {
  if (evento.key === 'Escape') cerrarIntro();
}

function cerrarIntro() {
  const intro = document.getElementById('intro');
  if (!intro || intro.hidden) return;
  try { sessionStorage.setItem(CLAVE_INTRO, '1'); } catch { /* sin almacenamiento */ }
  document.removeEventListener('keydown', teclaIntro);
  intro.classList.add('intro-saliendo');
  setTimeout(() => {
    intro.hidden = true;
    intro.classList.remove('intro-saliendo');
    const video = intro.querySelector('video');
    if (video) video.pause();
    const pantalla = document.getElementById('login-screen');
    if (pantalla) pantalla.classList.remove('esperando-intro');
  }, 650);
}

function verIntro() {
  const intro = document.getElementById('intro');
  if (!intro) return false;
  const video = intro.querySelector('video');
  intro.hidden = false;
  document.addEventListener('keydown', teclaIntro);
  const saltar = intro.querySelector('.intro-saltar');
  if (saltar) saltar.focus();
  if (!video || typeof video.play !== 'function') { cerrarIntro(); return false; }
  video.currentTime = 0;
  const reproduccion = video.play();
  // Si el navegador no deja reproducir, no se insiste: se pasa al acceso.
  if (reproduccion && typeof reproduccion.catch === 'function') reproduccion.catch(cerrarIntro);
  return true;
}

function prepararIntro() {
  const intro = document.getElementById('intro');
  if (!intro) return;
  const video = intro.querySelector('video');
  const barra = intro.querySelector('.intro-progreso span');
  if (video) {
    video.addEventListener('ended', () => setTimeout(cerrarIntro, 500));
    video.addEventListener('error', cerrarIntro);
    if (barra) {
      video.addEventListener('timeupdate', () => {
        if (video.duration) barra.style.width = `${(video.currentTime / video.duration) * 100}%`;
      });
    }
  }
  let vista = null;
  try { vista = sessionStorage.getItem(CLAVE_INTRO); } catch { /* sin almacenamiento */ }
  if (vista || sinMovimiento()) return;
  const pantalla = document.getElementById('login-screen');
  if (pantalla) pantalla.classList.add('esperando-intro');
  verIntro();
}

// ---------- Escena que sigue al puntero ----------

function prepararParalaje() {
  const pantalla = document.getElementById('login-screen');
  const plano = document.querySelector('.escena-plano');
  if (!pantalla || !plano || sinMovimiento()) return;
  let pendiente = false;
  pantalla.addEventListener('pointermove', (evento) => {
    if (evento.pointerType !== 'mouse' || pendiente) return;
    pendiente = true;
    requestAnimationFrame(() => {
      const x = (evento.clientX / globalThis.innerWidth - 0.5) * -18;
      const y = (evento.clientY / globalThis.innerHeight - 0.5) * -12;
      plano.style.setProperty('--paralaje-x', `${x.toFixed(1)}px`);
      plano.style.setProperty('--paralaje-y', `${y.toFixed(1)}px`);
      pendiente = false;
    });
  });
}

// ---------- Cifras que cuentan y vistas que llegan ----------

function contarHasta(elemento, duracion = 900) {
  const texto = elemento.textContent.trim();
  const partes = /^(\d+)(%?)$/.exec(texto);
  if (!partes) return false;
  const final = Number(partes[1]);
  const inicio = performance.now();
  const paso = (ahora) => {
    const t = Math.min(1, (ahora - inicio) / duracion);
    const suave = 1 - (1 - t) ** 3;
    elemento.textContent = `${Math.round(final * suave)}${partes[2]}`;
    if (t < 1) requestAnimationFrame(paso);
  };
  requestAnimationFrame(paso);
  return true;
}

function prepararVistas() {
  const area = document.getElementById('content-area');
  if (!area || typeof MutationObserver === 'undefined') return;
  let ultima = null;
  new MutationObserver(() => {
    // appState es un let de app.js: se ve por su nombre, no como globalThis.appState.
    const actual = typeof appState !== 'undefined' ? appState.currentView : null;
    if (actual === ultima) return;
    ultima = actual;
    if (sinMovimiento()) return;
    area.classList.remove('vista-nueva');
    void area.offsetWidth;
    area.classList.add('vista-nueva');
    area.querySelectorAll('.stat-card-info h3').forEach((cifra) => contarHasta(cifra));
  }).observe(area, { childList: true });
}

// ---------- Campus 3D ----------

// Si el equipo tiene WebGL, el plano se vuelve una escena Three.js (se descarga
// solo aqui, en el acceso). Si algo falla, queda el dibujo SVG tal cual.
function prepararCampus3D() {
  if (!document.querySelector || sinMovimiento()) return false;
  const plano = document.querySelector('.escena-plano');
  if (!plano) return false;
  const prueba = document.createElement('canvas');
  const gl = prueba.getContext && (prueba.getContext('webgl2') || prueba.getContext('webgl'));
  if (!gl) return false;
  import('../vendor/campus3d.js')
    .then((modulo) => {
      modulo.iniciarCampus3D(plano, { puntos: [...plano.querySelectorAll('.punto')] });
      plano.closest('.escena').classList.add('escena-3d');
    })
    .catch(() => { /* sin 3D: se queda el plano dibujado */ });
  return true;
}

// ---------- Inicio ----------

(function iniciarAmbiente() {
  let noche = null;
  try { noche = localStorage.getItem(CLAVE_NOCHE); } catch { /* sin almacenamiento */ }
  aplicarNoche(noche === '1');
  if (!(globalThis.AudioContext || globalThis.webkitAudioContext)) {
    document.querySelectorAll('[data-sonido]').forEach((boton) => { boton.hidden = true; });
  }
  actualizarReloj();
  setInterval(actualizarReloj, 15000);
  prepararIntro();
  prepararParalaje();
  prepararVistas();
  prepararCampus3D();
})();
