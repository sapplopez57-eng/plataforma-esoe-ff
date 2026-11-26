'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('interfaz: acota la carga a cuatro peticiones, conserva orden y muestra errores parciales', async () => {
  let activas = 0;
  let maximas = 0;
  const contexto = vm.createContext({
    api: async (ruta) => {
      activas += 1;
      maximas = Math.max(maximas, activas);
      try {
        await new Promise((resolve) => setTimeout(resolve, ruta === 'lenta' ? 15 : 2));
        if (ruta === 'sin-expediente') throw Object.assign(new Error('Sin expediente'), { codigo: 'SIN_EXPEDIENTE' });
        return ruta;
      } finally { activas -= 1; }
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public/js/servidor.js'), 'utf8'), contexto);
  const rutas = ['lenta', 'b', 'sin-expediente', 'd', 'e', 'f', 'g', 'h', 'i'];
  const resultado = await contexto.pedirVarias(rutas);
  assert.equal(maximas, 4);
  assert.deepEqual(Array.from(resultado), rutas.map((ruta) => ruta === 'sin-expediente' ? null : ruta));
  assert.match(vm.runInContext('datosServidor.aviso', contexto), /no está ligada a un expediente/);
  assert.deepEqual(Array.from(await contexto.pedirVarias([])), []);
});

function contextoDeCarga(porRuta) {
  const pedidas = [];
  const contexto = vm.createContext({
    api: async (ruta) => {
      pedidas.push(ruta);
      return porRuta[ruta] ?? { estudiantes: [] };
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public/js/servidor.js'), 'utf8'), contexto);
  return { contexto, pedidas };
}

function alumno(id, promocionId) {
  return { id, codigo_alumno: `A-${id}`, nombres: 'Nombre', apellidos: 'Apellido', promocion_id: promocionId };
}

test('interfaz: el listado de estudiantes se arma por promocion, no de una sola vez', async () => {
  const { contexto, pedidas } = contextoDeCarga({
    '/estudiantes?promocion_id=p-1': { estudiantes: [alumno('1', 'p-1'), alumno('2', 'p-1')] },
    '/estudiantes?promocion_id=p-2': { estudiantes: [alumno('3', 'p-2')] }
  });
  const estudiantes = await contexto.cargarEstudiantes('ADMIN', [{ id: 'p-1' }, { id: 'p-2' }]);
  assert.deepEqual(pedidas, ['/estudiantes?promocion_id=p-1', '/estudiantes?promocion_id=p-2']);
  assert.ok(!pedidas.includes('/estudiantes'));
  assert.deepEqual(Array.from(estudiantes, (e) => e.id), ['1', '2', '3']);
});

test('interfaz: una promocion sin respuesta no borra las demas', async () => {
  const { contexto } = contextoDeCarga({
    '/estudiantes?promocion_id=p-1': { estudiantes: [alumno('1', 'p-1')] },
    '/estudiantes?promocion_id=p-2': null
  });
  const estudiantes = await contexto.cargarEstudiantes('ADMIN', [{ id: 'p-1' }, { id: 'p-2' }]);
  assert.deepEqual(Array.from(estudiantes, (e) => e.id), ['1']);
});

test('interfaz: el estudiante sigue pidiendo solo su propio expediente', async () => {
  const { contexto, pedidas } = contextoDeCarga({
    '/estudiantes': { estudiantes: [alumno('9', 'p-1')] }
  });
  const estudiantes = await contexto.cargarEstudiantes('ESTUDIANTE', [{ id: 'p-1' }, { id: 'p-2' }]);
  assert.deepEqual(pedidas, ['/estudiantes']);
  assert.deepEqual(Array.from(estudiantes, (e) => e.id), ['9']);
});

test('interfaz: sin promociones no se pide ningun listado de estudiantes', async () => {
  const { contexto, pedidas } = contextoDeCarga({});
  const estudiantes = await contexto.cargarEstudiantes('CATEDRATICO', []);
  assert.deepEqual(pedidas, []);
  assert.deepEqual(Array.from(estudiantes), []);
});

test('interfaz: el identificador de promocion viaja escapado', async () => {
  const { contexto, pedidas } = contextoDeCarga({});
  await contexto.cargarEstudiantes('ADMIN', [{ id: 'p 1&x=2' }]);
  assert.deepEqual(pedidas, ['/estudiantes?promocion_id=p%201%26x%3D2']);
});
