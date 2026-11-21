'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUBLICO = path.join(__dirname, '..', 'public');
const html = fs.readFileSync(path.join(PUBLICO, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(PUBLICO, 'css', 'styles.css'), 'utf8');
const lectura = fs.readFileSync(path.join(PUBLICO, 'js', 'lectura.js'), 'utf8');

function bloque(id, hasta) {
  const inicio = html.indexOf(`id="${id}"`);
  const fin = html.indexOf(hasta, inicio);
  assert.ok(inicio > 0 && fin > inicio, `no se encontro el bloque ${id}`);
  return html.slice(inicio, fin);
}
const contar = (texto, re) => (texto.match(re) || []).length;

test('estructura: cada <nav> tiene nombre (TecNM deja tres sin nombre)', () => {
  const navs = html.match(/<nav\b[^>]*>/g) || [];
  assert.ok(navs.length >= 1);
  for (const nav of navs) assert.match(nav, /aria-label(ledby)?="[^"]+"/, nav);
});

test('estructura: hay dos <main> y solo el del acceso empieza visible', () => {
  const mains = html.match(/<main\b[^>]*>/g) || [];
  assert.equal(mains.length, 2);
  const visibles = mains.filter((m) => !/\shidden(\s|>|=)/.test(m));
  assert.equal(visibles.length, 1, 'un solo <main> sin hidden');
  assert.match(visibles[0], /id="acceso-principal"/);
});

test('estructura: el acceso tiene encabezado institucional y formulario como contenido principal', () => {
  const acceso = bloque('login-screen', 'id="app-shell"');
  assert.match(acceso, /<header class="login-brand-panel">/);
  assert.match(acceso, /<main id="acceso-principal"[^>]*aria-labelledby="titulo-acceso"/);
  assert.match(acceso, /<h2 id="titulo-acceso"[^>]*>/);
});

test('estructura: un <h1> por pantalla (INFOP Academias no tiene ninguno)', () => {
  assert.equal(contar(bloque('login-screen', 'id="app-shell"'), /<h1\b/g), 1);
  assert.equal(contar(bloque('app-shell', 'id="modal-backdrop"'), /<h1\b/g), 1);
});

test('estructura: el acceso responde las dudas frecuentes con <details>', () => {
  const ayuda = bloque('acceso-principal', '</main>');
  assert.ok(contar(ayuda, /<details>/g) >= 3);
  assert.equal(contar(ayuda, /<details>/g), contar(ayuda, /<summary>/g));
});

test('lectura: la escala tipografica esta en rem para que siga al navegador', () => {
  const raiz = css.slice(css.indexOf(':root'), css.indexOf('}', css.indexOf(':root')));
  const escala = [...raiz.matchAll(/--fs-[a-z0-9]+:\s*([^;]+);/g)].map((m) => m[1].trim());
  assert.ok(escala.length >= 8);
  for (const valor of escala) assert.match(valor, /^\d+(\.\d+)?rem$/, valor);
});

test('lectura: cada boton de tamano tiene su regla y su nombre completo', () => {
  const botones = [...html.matchAll(/<button[^>]*data-tamano-texto="([^"]+)"[^>]*>(.*?)<\/button>/g)];
  assert.equal(botones.length, 6, 'tres botones en el acceso y tres en la barra superior');
  for (const [, tamano, contenido] of botones) {
    if (tamano !== 'normal') assert.match(css, new RegExp(`html\\[data-texto="${tamano}"\\]\\s*\\{\\s*font-size:`));
    assert.match(contenido, /class="solo-lectores"/, `el boton ${tamano} necesita nombre para lectores`);
  }
});

function entorno({ almacenamiento } = {}) {
  const atributos = {};
  const clases = (inicial) => {
    const set = new Set(inicial);
    return { toggle: (c, si) => (si ? set.add(c) : set.delete(c)), contains: (c) => set.has(c) };
  };
  const nodos = {
    'login-screen': { classList: clases([]) },
    'app-shell': { classList: clases(['hidden']) },
    'acceso-principal': { hidden: false },
    'content-area': { hidden: true }
  };
  const botones = ['normal', 'grande', 'muy-grande'].map((t) => {
    const b = { dataset: { tamanoTexto: t }, attrs: {} };
    b.setAttribute = (k, v) => { b.attrs[k] = v; };
    return b;
  });
  const documento = {
    getElementById: (id) => nodos[id],
    querySelectorAll: () => botones,
    documentElement: {
      setAttribute: (k, v) => { atributos[k] = v; },
      removeAttribute: (k) => { delete atributos[k]; }
    }
  };
  const contexto = { document: documento, localStorage: almacenamiento };
  vm.createContext(contexto);
  vm.runInContext(lectura, contexto);
  return { contexto, nodos, botones, atributos };
}

test('lectura: mostrarPantalla deja un solo <main> visible', () => {
  const { contexto, nodos } = entorno({ almacenamiento: { getItem: () => null, setItem() {} } });
  contexto.mostrarPantalla('app');
  assert.equal(nodos['acceso-principal'].hidden, true);
  assert.equal(nodos['content-area'].hidden, false);
  assert.equal(nodos['login-screen'].classList.contains('hidden'), true);
  contexto.mostrarPantalla('acceso');
  assert.equal(nodos['acceso-principal'].hidden, false);
  assert.equal(nodos['content-area'].hidden, true);
  assert.equal(nodos['app-shell'].classList.contains('hidden'), true);
});

test('lectura: el tamano elegido se aplica, se marca y se recuerda', () => {
  const guardado = {};
  const { contexto, botones, atributos } = entorno({
    almacenamiento: { getItem: (k) => guardado[k] ?? null, setItem: (k, v) => { guardado[k] = v; } }
  });
  contexto.cambiarTamanoTexto('grande');
  assert.equal(atributos['data-texto'], 'grande');
  assert.deepEqual(botones.map((b) => b.attrs['aria-pressed']), ['false', 'true', 'false']);
  assert.equal(guardado['esoe.tamanoTexto'], 'grande');
  contexto.cambiarTamanoTexto('normal');
  assert.equal('data-texto' in atributos, false);
});

test('lectura: un valor guardado invalido o un almacenamiento bloqueado no rompen la pagina', () => {
  const malo = entorno({ almacenamiento: { getItem: () => '"><script>', setItem() {} } });
  assert.equal('data-texto' in malo.atributos, false);
  const bloqueado = { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('bloqueado'); } };
  const { contexto, atributos } = entorno({ almacenamiento: bloqueado });
  assert.doesNotThrow(() => contexto.cambiarTamanoTexto('muy-grande'));
  assert.equal(atributos['data-texto'], 'muy-grande');
});

const ambiente = fs.readFileSync(path.join(PUBLICO, 'js', 'ambiente.js'), 'utf8');

test('ambiente: la escena es decorativa y la barra tiene nombre', () => {
  assert.match(html, /<div class="escena" aria-hidden="true">/);
  assert.match(html, /<img src="img\/campus-esoe\.svg" alt=""/);
  assert.match(html, /<div class="barra-ambiente" role="toolbar" aria-label="Ambiente">/);
  const botones = [...html.matchAll(/<button[^>]*class="ambiente-btn"[^>]*>(.*?)<\/button>/g)];
  assert.ok(botones.length >= 5, 'plano, sonido y noche en el acceso; sonido y noche dentro');
  for (const [boton, contenido] of botones) {
    assert.match(boton, /aria-pressed="(true|false)"/);
    assert.ok(contenido.replace(/<[^>]+>/g, '').replace(/[▦♪☾]/g, '').trim().length > 0, `sin nombre: ${boton}`);
  }
});

function introFalsa({ reproduce = true } = {}) {
  const oyentes = {};
  const video = {
    currentTime: 3, duration: 8.5, reproducido: 0, pausado: 0,
    play() { this.reproducido += 1; return reproduce ? Promise.resolve() : Promise.reject(new Error('bloqueado')); },
    pause() { this.pausado += 1; },
    addEventListener(tipo, f) { oyentes[tipo] = f; }
  };
  const clases = new Set();
  const intro = {
    hidden: true, video, oyentes,
    classList: { add: (c) => clases.add(c), remove: (c) => clases.delete(c), contains: (c) => clases.has(c) },
    querySelector: (sel) => (sel === 'video' ? video : sel === '.intro-saltar' ? { focus() { intro.enfocado = true; } } : { style: {} })
  };
  return intro;
}

function entornoAmbiente({ almacenamiento, Audio, sesion, movimientoReducido = false, intro = introFalsa() } = {}) {
  const atributos = {};
  const botones = { '[data-noche]': [], '[data-sonido]': [], '[data-atlas]': [], '[data-reloj]': [] };
  const nuevo = () => { const b = { attrs: {}, hidden: false }; b.setAttribute = (k, v) => { b.attrs[k] = v; }; return b; };
  for (const k of Object.keys(botones)) botones[k].push(nuevo(), nuevo());
  const clases = new Set();
  const pantalla = {
    classList: {
      toggle: (c) => (clases.has(c) ? (clases.delete(c), false) : (clases.add(c), true)),
      add: (c) => clases.add(c), remove: (c) => clases.delete(c), contains: (c) => clases.has(c)
    },
    addEventListener() {}
  };
  const teclas = {};
  const documento = {
    querySelectorAll: (sel) => botones[sel] || [],
    querySelector: () => null,
    addEventListener: (tipo, f) => { teclas[tipo] = f; },
    removeEventListener: (tipo) => { delete teclas[tipo]; },
    getElementById: (id) => ({ intro, 'login-screen': pantalla })[id] || null,
    documentElement: {
      setAttribute: (k, v) => { atributos[k] = v; },
      removeAttribute: (k) => { delete atributos[k]; },
      hasAttribute: (k) => k in atributos
    }
  };
  const pendientes = [];
  const contexto = {
    document: documento, localStorage: almacenamiento, sessionStorage: sesion || { getItem: () => null, setItem() {} },
    setInterval: () => 0, setTimeout: (f) => pendientes.push(f), Date, Math,
    matchMedia: () => ({ matches: movimientoReducido })
  };
  if (Audio) contexto.AudioContext = Audio;
  contexto.globalThis = contexto;
  vm.createContext(contexto);
  vm.runInContext(ambiente, contexto);
  const avanzar = () => { while (pendientes.length) pendientes.shift()(); };
  return { contexto, atributos, botones, intro, pantalla, teclas, avanzar };
}

function audioFalso(registro) {
  const parametro = () => ({ value: 0, setValueAtTime() {}, cancelScheduledValues() {}, linearRampToValueAtTime(v) { registro.push(v); } });
  const nodo = () => ({ connect() {}, start() {}, gain: parametro(), frequency: parametro(), detune: parametro(), Q: parametro() });
  return class {
    constructor() { this.currentTime = 0; this.sampleRate = 8000; this.state = 'suspended'; this.destination = {}; }
    createGain() { return nodo(); }
    createOscillator() { return nodo(); }
    createBiquadFilter() { return nodo(); }
    createBufferSource() { return nodo(); }
    createBuffer(c, n) { return { getChannelData: () => new Float32Array(n) }; }
    resume() { this.state = 'running'; }
  };
}

test('ambiente: el reloj muestra la hora local con dos cifras', () => {
  const { contexto, botones } = entornoAmbiente({ almacenamiento: { getItem: () => null, setItem() {} } });
  assert.equal(contexto.horaLocal(new Date(2026, 0, 1, 7, 5)), '07:05');
  contexto.actualizarReloj(new Date(2026, 0, 1, 23, 40));
  assert.equal(botones['[data-reloj]'][0].textContent, '23:40');
});

test('ambiente: el modo noche se aplica, se marca y se recuerda', () => {
  const guardado = {};
  const { contexto, atributos, botones } = entornoAmbiente({
    almacenamiento: { getItem: (k) => guardado[k] ?? null, setItem: (k, v) => { guardado[k] = v; } }
  });
  assert.equal('data-noche' in atributos, false);
  contexto.alternarNoche();
  assert.equal('data-noche' in atributos, true);
  assert.deepEqual(botones['[data-noche]'].map((b) => b.attrs['aria-pressed']), ['true', 'true']);
  assert.equal(guardado['esoe.noche'], '1');
  const otra = entornoAmbiente({ almacenamiento: { getItem: () => '1', setItem() {} } });
  assert.equal('data-noche' in otra.atributos, true, 'la siguiente visita empieza de noche');
});

test('ambiente: sin almacenamiento el modo noche funciona igual', () => {
  const bloqueado = { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('bloqueado'); } };
  const { contexto, atributos } = entornoAmbiente({ almacenamiento: bloqueado });
  assert.doesNotThrow(() => contexto.alternarNoche());
  assert.equal('data-noche' in atributos, true);
});

test('ambiente: el sonido solo arranca cuando se pide y se apaga con el mismo boton', () => {
  const volumen = [];
  const { contexto, botones } = entornoAmbiente({ almacenamiento: { getItem: () => null, setItem() {} }, Audio: audioFalso(volumen) });
  const estado = () => vm.runInContext('sonido', contexto);
  assert.equal(estado().contexto, null, 'nada suena al cargar');
  assert.equal(contexto.alternarSonido(), true);
  assert.equal(estado().contexto.state, 'running');
  assert.deepEqual(botones['[data-sonido]'].map((b) => b.attrs['aria-pressed']), ['true', 'true']);
  assert.equal(contexto.alternarSonido(), false);
  assert.deepEqual(volumen, [0.5, 0], 'sube suave y baja a cero');
});

test('ambiente: sin Web Audio el boton de sonido se oculta', () => {
  const { contexto, botones } = entornoAmbiente({ almacenamiento: { getItem: () => null, setItem() {} } });
  assert.equal(botones['[data-sonido]'].every((b) => b.hidden), true);
  assert.equal(contexto.alternarSonido(), false);
});

test('presentacion: el video del escudo esta en la pagina, en dos formatos, y se puede saltar', () => {
  assert.match(html, /<div id="intro" class="intro" role="dialog" aria-modal="true" aria-label="[^"]+" hidden>/);
  for (const archivo of ['escudo-esoe.webm', 'escudo-esoe.mp4', 'escudo-esoe.jpg']) {
    assert.ok(fs.existsSync(path.join(PUBLICO, 'video', archivo)), `falta video/${archivo}`);
  }
  assert.match(html, /<video class="intro-video" muted playsinline/);
  assert.match(html, /class="intro-saltar[^"]*" data-on-click="cerrarIntro\(\)">Saltar intro/);
  assert.match(html, /data-on-click="verIntro\(\)">[^<]*Ver presentación/);
});

test('presentacion: se ve una vez por sesion y al terminar deja el acceso', () => {
  const guardado = {};
  const sesion = { getItem: (k) => guardado[k] ?? null, setItem: (k, v) => { guardado[k] = v; } };
  const e = entornoAmbiente({ almacenamiento: { getItem: () => null, setItem() {} }, sesion });
  assert.equal(e.intro.hidden, false, 'la primera visita la muestra');
  assert.equal(e.intro.video.reproducido, 1);
  assert.equal(e.intro.enfocado, true, 'el foco va a "Saltar intro"');
  assert.equal(e.pantalla.classList.contains('esperando-intro'), true);
  e.intro.oyentes.ended();
  e.avanzar();
  assert.equal(e.intro.hidden, true);
  assert.equal(e.pantalla.classList.contains('esperando-intro'), false);
  assert.equal(guardado['esoe.intro'], '1');
  const otra = entornoAmbiente({ almacenamiento: { getItem: () => null, setItem() {} }, sesion });
  assert.equal(otra.intro.hidden, true, 'en la misma sesion no se repite');
});

test('presentacion: Escape la salta y "Ver presentacion" la repite', () => {
  const e = entornoAmbiente({ almacenamiento: { getItem: () => null, setItem() {} } });
  e.teclas.keydown({ key: 'Escape' });
  e.avanzar();
  assert.equal(e.intro.hidden, true);
  assert.equal(e.contexto.verIntro(), true);
  assert.equal(e.intro.hidden, false);
  assert.equal(e.intro.video.currentTime, 0, 'empieza desde el principio');
});

test('presentacion: no aparece con "reducir movimiento" ni insiste si el navegador no deja reproducir', async () => {
  const quieto = entornoAmbiente({ almacenamiento: { getItem: () => null, setItem() {} }, movimientoReducido: true });
  assert.equal(quieto.intro.hidden, true);
  assert.equal(quieto.intro.video.reproducido, 0);
  const bloqueado = entornoAmbiente({ almacenamiento: { getItem: () => null, setItem() {} }, intro: introFalsa({ reproduce: false }) });
  await new Promise((r) => setImmediate(r));
  bloqueado.avanzar();
  assert.equal(bloqueado.intro.hidden, true, 'pasa directo al acceso');
});


test('campus3d: la pagina no lo carga sin escena, con "reducir movimiento" ni sin WebGL', () => {
  const sinEscena = entornoAmbiente({ almacenamiento: { getItem: () => null, setItem() {} } });
  assert.equal(sinEscena.contexto.prepararCampus3D(), false);
  const quieto = entornoAmbiente({ almacenamiento: { getItem: () => null, setItem() {} }, movimientoReducido: true });
  assert.equal(quieto.contexto.prepararCampus3D(), false);
  const e = entornoAmbiente({ almacenamiento: { getItem: () => null, setItem() {} } });
  e.contexto.document.querySelector = () => ({ querySelectorAll: () => [] });
  e.contexto.document.createElement = () => ({ getContext: () => null });
  assert.equal(e.contexto.prepararCampus3D(), false, 'sin WebGL se queda el dibujo');
});

test('avisos: el contenedor de avisos es una region que el lector de pantalla anuncia', () => {
  const contenedor = html.match(/<div id="toast-container"[^>]*>/);
  assert.ok(contenedor, 'falta el contenedor de avisos');
  assert.match(contenedor[0], /role="status"/);
  assert.match(contenedor[0], /aria-live="polite"/);
  assert.match(contenedor[0], /aria-atomic="false"/, 'cada aviso nuevo se lee solo, sin repetir los anteriores');
});

test('avisos: duran segun el largo del mensaje, con minimo y tope', () => {
  const fuente = lectura.match(/function duracionAviso[\s\S]*?\n}\n/);
  assert.ok(fuente, 'falta duracionAviso en lectura.js');
  const duracionAviso = vm.runInNewContext(`(${fuente[0]})`);
  const corto = duracionAviso('Clase registrada');
  const largo = duracionAviso('Acta de asistencia guardada en el servidor con todos los registros de la clase de hoy');
  assert.equal(corto, 4000, 'un aviso corto dura al menos 4 s (antes eran 3,2 s fijos)');
  assert.ok(largo > corto, 'un aviso largo dura mas');
  assert.equal(duracionAviso('palabra '.repeat(200)), 12000, 'con un tope de 12 s');
  assert.equal(duracionAviso(''), 4000);
});

test('presentacion: nombra a las demas instituciones que usan la plataforma', () => {
  const entes = html.match(/<div class="intro-entes">[\s\S]*?<\/div>/);
  assert.ok(entes, 'falta el bloque de instituciones en la presentacion');
  for (const [siglas, nombre] of [['UDH', 'Universidad de Defensa de Honduras'],
    ['INFOP', 'Instituto Nacional de Formación Profesional'], ['COPECO', 'Comisión Permanente de Contingencias']]) {
    assert.match(entes[0], new RegExp(`<strong>${siglas}</strong><span>${nombre}</span>`));
  }
});

test('diseno: ningun punto ni faro que parpadee sin fin en la interfaz', () => {
  const css = fs.readFileSync(path.join(PUBLICO, 'css', 'styles.css'), 'utf8');
  const keyframes = [...css.matchAll(/@keyframes\s+([\w-]+)\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g)];
  const parpadeantes = keyframes.filter(([, , cuerpo]) => /opacity/.test(cuerpo)).map(([, nombre]) => nombre);
  const tramos = [...css.matchAll(/animation:\s*([^;}]+)/g)].flatMap(([, valor]) => valor.split(','));
  for (const nombre of parpadeantes) {
    const infinita = tramos.some((t) => new RegExp(`\\b${nombre}\\b`).test(t) && /infinite/.test(t));
    assert.ok(!infinita, `${nombre} parpadea sin fin`);
  }
  assert.ok(!/reloj-punto|latido/.test(css + html), 'el punto del reloj no vuelve');
});
