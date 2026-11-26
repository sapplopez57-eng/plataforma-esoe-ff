'use strict';

const { identificadorDePeticion, CABECERA_PETICION } = require('./registro');

const RESPUESTAS = Object.freeze({
  ERR_HTTP_REQUEST_TIMEOUT: '408 Request Timeout',
  HPE_HEADER_OVERFLOW: '431 Request Header Fields Too Large'
});

function atenderErroresDeCliente(servidor, registro) {
  servidor.on('clientError', (error, socket) => {
    if (!socket.writable || socket._httpMessage?.headersSent) {
      socket.destroy(error);
      return;
    }
    const estado = RESPUESTAS[error.code] || '400 Bad Request';
    const peticion = identificadorDePeticion();
    registro.aviso('peticion rechazada antes de atenderse', {
      peticion, estado: Number.parseInt(estado, 10), code: error.code || ''
    });
    socket.end(`HTTP/1.1 ${estado}\r\nConnection: close\r\nContent-Length: 0\r\n${CABECERA_PETICION}: ${peticion}\r\n\r\n`);
  });
}

module.exports = { atenderErroresDeCliente };
