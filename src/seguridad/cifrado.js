'use strict';

// Cifrado autenticado (AES-256-GCM) para las credenciales de plataformas externas.
// Formato del texto cifrado: v1.<iv>.<etiqueta>.<datos> en base64url.

const crypto = require('node:crypto');

const VERSION = 'v1';

function crearCifrador(claveHex) {
  if (!/^[0-9a-f]{64}$/i.test(claveHex || '')) return null;
  const clave = Buffer.from(claveHex, 'hex');

  function cifrar(texto) {
    const iv = crypto.randomBytes(12);
    const cifrador = crypto.createCipheriv('aes-256-gcm', clave, iv);
    const datos = Buffer.concat([cifrador.update(String(texto), 'utf8'), cifrador.final()]);
    return [VERSION, iv, cifrador.getAuthTag(), datos]
      .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
      .join('.');
  }

  function descifrar(textoCifrado) {
    const [version, iv, etiqueta, datos] = String(textoCifrado).split('.');
    if (version !== VERSION || !iv || !etiqueta || !datos) throw new Error('Formato de cifrado desconocido.');
    const descifrador = crypto.createDecipheriv('aes-256-gcm', clave, Buffer.from(iv, 'base64url'));
    descifrador.setAuthTag(Buffer.from(etiqueta, 'base64url'));
    return Buffer.concat([descifrador.update(Buffer.from(datos, 'base64url')), descifrador.final()]).toString('utf8');
  }

  return { cifrar, descifrar };
}

module.exports = { crearCifrador };
