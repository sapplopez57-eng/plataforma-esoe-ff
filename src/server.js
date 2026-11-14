'use strict';

const { cargarConfig } = require('./config');
const { crearApp } = require('./app');

let config;
try {
  config = cargarConfig();
} catch (error) {
  console.error(`[ESOE-SMS] ${error.message}`);
  process.exit(1);
}

const servidor = crearApp(config).listen(config.puerto, config.host, () => {
  console.log(`[ESOE-SMS] Servidor activo en http://${config.host}:${config.puerto} (${config.entorno})`);
});

function apagar(senal) {
  console.log(`[ESOE-SMS] ${senal} recibido, cerrando conexiones...`);
  servidor.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => apagar('SIGTERM'));
process.on('SIGINT', () => apagar('SIGINT'));
