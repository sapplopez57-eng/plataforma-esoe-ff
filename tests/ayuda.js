'use strict';

const { crearApp } = require('../src/app');
const { cargarConfig } = require('../src/config');

async function levantar(env = {}) {
  const config = cargarConfig({ NODE_ENV: 'test', ...env });
  const servidor = crearApp(config).listen(0, '127.0.0.1');
  await new Promise((resolve) => servidor.once('listening', resolve));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  return {
    base,
    pedir: (ruta, opciones) => fetch(base + ruta, opciones),
    cerrar: () => new Promise((resolve) => servidor.close(resolve))
  };
}

module.exports = { levantar };
