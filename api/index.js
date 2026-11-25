'use strict';

const { cargarConfig } = require('../src/config');
const { crearApp } = require('../src/app');
const { crearBaseDeDatos } = require('../src/db');
const { crearRegistro } = require('../src/registro');

const config = cargarConfig();
const registro = crearRegistro({
  entorno: config.entorno,
  version: config.version,
  nivel: config.registro.nivel
});
const db = crearBaseDeDatos(config.databaseUrl, config.baseDeDatos, { registro });

module.exports = crearApp(config, { db, registro });
