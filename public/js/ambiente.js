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
})();
