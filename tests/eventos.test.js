'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { analizar, crearDespachador } = require('../public/js/eventos');

const PUBLICO = path.join(__dirname, '..', 'public');

function archivosPublicos() {
  const lista = [path.join(PUBLICO, 'index.html')];
  const dirJs = path.join(PUBLICO, 'js');
  fs.readdirSync(dirJs).filter((f) => f.endsWith('.js') && f !== 'clerk-es.js').forEach((f) => lista.push(path.join(dirJs, f)));
  return lista;
}

test('eventos: interpreta llamadas con argumentos permitidos', () => {
  const [llamada] = analizar("setEstadoAsistencia('s1', 'e1', 'PRESENTE')");
  assert.equal(llamada.nombre, 'setEstadoAsistencia');
  assert.deepEqual(llamada.argumentos.map((a) => a.valor), ['s1', 'e1', 'PRESENTE']);
  assert.equal(analizar('closeModal()')[0].argumentos.length, 0);
  assert.equal(analizar("closeModal(); verBoletinDeEstudiante('e1')").length, 2);
});

test('eventos: una coma o un punto y coma dentro de un texto no parte la llamada', () => {
  const [llamada] = analizar("avisar('uno, dos; tres')");
  assert.deepEqual(llamada.argumentos.map((a) => a.valor), ['uno, dos; tres']);
});

test('eventos: rechaza todo lo que no sea una llamada simple', () => {
  const rechazados = [
    'alert(1)',
    'eval("1")',
    'fetch(\'/x\')',
    'window.print()',
    'a.b()',
    "x = 1",
    "f(document.cookie)",
    "f(1 + 2)",
    "f(function(){})",
    "f('sin cerrar)",
    "f(`plantilla`)"
  ];
  rechazados.forEach((texto) => assert.throws(() => analizar(texto), Error, texto));
});

test('eventos: ejecuta solo funciones globales existentes y pasa this/event/dataset', () => {
  const llamadas = [];
  const global = { registrar: (...args) => llamadas.push(args), noEsFuncion: 5 };
  const { ejecutar } = crearDespachador(global);
  const elemento = { value: 'valor', dataset: { id: 'abc' } };
  const evento = { tipo: 'prueba' };

  ejecutar("registrar('a', this.value, this.dataset.id, event, 3, true, null)", elemento, evento);
  assert.deepEqual(llamadas[0], ['a', 'valor', 'abc', evento, 3, true, null]);

  assert.throws(() => ejecutar('noExiste()', elemento, evento), /No existe la funcion/);
  assert.throws(() => ejecutar('noEsFuncion()', elemento, evento), /No existe la funcion/);
});

test('eventos: sube por los ancestros como lo hacia onclick y respeta stopPropagation', () => {
  const orden = [];
  const global = { hijo: () => orden.push('hijo'), padre: () => orden.push('padre'), detener: (e) => { e.cancelBubble = true; } };
  const { crearDespachador: crear } = require('../public/js/eventos');
  const { instalar } = crear(global);
  const oyentes = {};
  const documento = { addEventListener: (tipo, fn) => { oyentes[tipo] = fn; } };
  instalar(documento);

  const raiz = { nodeType: 1, getAttribute: (n) => (n === 'data-on-click' ? 'padre()' : null), parentElement: null };
  const medio = { nodeType: 1, getAttribute: (n) => (n === 'data-on-click' ? 'hijo()' : null), parentElement: raiz };
  oyentes.click({ target: medio });
  assert.deepEqual(orden, ['hijo', 'padre']);

  orden.length = 0;
  const cortado = { nodeType: 1, getAttribute: (n) => (n === 'data-on-click' ? 'hijo(); detener(event)' : null), parentElement: raiz };
  oyentes.click({ target: cortado });
  assert.deepEqual(orden, ['hijo']);
});

test('interfaz: no quedan manejadores en linea en el HTML ni en las plantillas', () => {
  const atributo = /\bon(click|change|input|submit|blur|focus|keyup|keydown|load|error|mouseover)\s*=\s*["']/i;
  archivosPublicos().forEach((archivo) => {
    const texto = fs.readFileSync(archivo, 'utf8');
    assert.doesNotMatch(texto, atributo, `${path.basename(archivo)} contiene un manejador en linea`);
  });
});

test('interfaz: todo data-on-* apunta a una funcion que existe en la interfaz', () => {
  const fuentes = archivosPublicos().map((a) => fs.readFileSync(a, 'utf8')).join('\n');
  const usados = new Set();
  for (const m of fuentes.matchAll(/data-on-(?:click|change|input|submit)="([^"]*)"/g)) {
    analizar(m[1].replace(/\$\{[^}]*\}/g, 'x')).forEach((l) => usados.add(l.nombre));
  }
  assert.ok(usados.size > 15, 'se esperaban muchos manejadores migrados');
  usados.forEach((nombre) => {
    assert.match(fuentes, new RegExp(`function\\s+${nombre}\\s*\\(|(?:const|let|var)\\s+${nombre}\\s*=|window\\.${nombre}\\s*=`), `falta definir ${nombre}`);
  });
});
