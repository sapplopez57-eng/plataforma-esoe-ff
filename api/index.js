'use strict';

const { cargarConfig } = require('../src/config');
const { crearApp } = require('../src/app');
const { crearBaseDeDatos } = require('../src/db');

const config = cargarConfig();
const db = crearBaseDeDatos(config.databaseUrl);

module.exports = crearApp(config, { db });
