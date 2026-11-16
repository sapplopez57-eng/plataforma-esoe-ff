'use strict';

// Estructura de la interfaz, medida con la misma vara que los sitios de referencia
// (Harvard, Campus Virtual UNAH, INFOP, TecNM): regiones con nombre, un solo <main>
// visible, un <h1> por pantalla y un texto que la persona puede agrandar.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUBLICO = path.join(__dirname, '..', 'public');
const html = fs.readFileSync(path.join(PUBLICO, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(PUBLICO, 'css', 'styles.css'), 'utf8');
const lectura = fs.readFileSync(path.join(PUBLICO, 'js', 'lectura.js'), 'utf8');

// Trozo del documento entre la apertura de un elemento con ese id y el siguiente bloque de pantalla.
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
  assert.match(acceso, /<h2 id="titulo-acceso">/);
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

// Un DOM minimo: lo justo para ejecutar lectura.js de verdad.
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
