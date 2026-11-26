'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { LIMITE_LISTADO, conTope, avisarSiTopa } = require('../src/tope-de-listado');

const RAIZ = path.join(__dirname, '..');

function registroFalso() {
  const avisos = [];
  return { avisos, aviso: (mensaje, detalle) => avisos.push({ mensaje, detalle }) };
}

test('tope: la consulta sale con el limite al final', () => {
  assert.match(conTope('SELECT 1 FROM cosas ORDER BY id'), /ORDER BY id\s+LIMIT 1000$/);
  assert.match(conTope('SELECT 1', 25), /LIMIT 25$/);
});

test('tope: un limite que no es un entero positivo se rechaza', () => {
  assert.throws(() => conTope('SELECT 1', 0), TypeError);
  assert.throws(() => conTope('SELECT 1', -5), TypeError);
  assert.throws(() => conTope('SELECT 1', 'muchas'), TypeError);
  assert.throws(() => conTope('SELECT 1', 1.5), /entero positivo/);
});

test('tope: el limite no se puede inyectar desde quien llama', () => {
  assert.throws(() => conTope('SELECT 1', '1; DROP TABLE estudiantes'), TypeError);
  assert.match(conTope('SELECT 1', '50'), /LIMIT 50$/);
});

test('tope: alcanzar el limite deja aviso, y no alcanzarlo no', () => {
  const registro = registroFalso();
  avisarSiTopa(registro, new Array(LIMITE_LISTADO).fill({}), 'estudiantes');
  assert.equal(registro.avisos.length, 1, 'un listado recortado no puede pasar en silencio');
  assert.match(registro.avisos[0].mensaje, /recortado/);
  assert.equal(registro.avisos[0].detalle.listado, 'estudiantes');
  assert.equal(registro.avisos[0].detalle.filas, LIMITE_LISTADO);

  const tranquilo = registroFalso();
  avisarSiTopa(tranquilo, new Array(LIMITE_LISTADO - 1).fill({}), 'estudiantes');
  assert.deepEqual(tranquilo.avisos, []);
});

test('tope: sin registro no falla y devuelve las filas tal cual', () => {
  const filas = [{ id: 1 }, { id: 2 }];
  assert.equal(avisarSiTopa(null, filas, 'cosas'), filas);
  assert.equal(avisarSiTopa(undefined, filas, 'cosas', 1), filas);
});

test('tope: los listados que crecen con la institucion quedan acotados', () => {
  const vigilados = [
    'src/academico/expedientes.js',
    'src/academico/instituciones.js',
    'src/academico/estructura.js'
  ];
  for (const relativa of vigilados) {
    const texto = fs.readFileSync(path.join(RAIZ, relativa), 'utf8');
    assert.match(texto, /require\('\.\.\/tope-de-listado'\)/,
      `${relativa} debe usar el tope compartido`);
    assert.match(texto, /conTope\(/, `${relativa} debe acotar su listado`);
    assert.match(texto, /avisarSiTopa\(/, `${relativa} debe avisar cuando recorta`);
  }
});
