'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createClerkClient } = require('@clerk/express');
const { ROLES } = require('../src/auth');

function leerEnv() {
  const archivo = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(archivo)) return;
  for (const linea of fs.readFileSync(archivo, 'utf8').split('\n')) {
    const partes = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(linea);
    if (!partes || process.env[partes[1]] !== undefined) continue;
    const valor = partes[2].replace(/^"(.*)"$/s, '$1').replace(/^'(.*)'$/s, '$1');
    process.env[partes[1]] = valor;
  }
}

async function principal() {
  const [correo, rolPedido] = process.argv.slice(2);
  const rol = String(rolPedido || '').toUpperCase();
  if (!correo || !ROLES.includes(rol)) {
    console.error(`Uso: node scripts/asignar-rol.js <correo> <${ROLES.join('|')}>`);
    process.exit(2);
  }

  leerEnv();
  if (!process.env.CLERK_SECRET_KEY) {
    console.error('Falta CLERK_SECRET_KEY en el entorno o en .env.');
    process.exit(2);
  }

  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY, telemetry: { disabled: true } });
  const { data: usuarios } = await clerk.users.getUserList({ emailAddress: [correo], limit: 2 });
  if (usuarios.length !== 1) {
    console.error(usuarios.length === 0
      ? 'No existe un usuario con ese correo. Debe registrarse primero.'
      : 'Hay mas de un usuario con ese correo; asigne el rol desde el panel de Clerk.');
    process.exit(1);
  }

  await clerk.users.updateUserMetadata(usuarios[0].id, { publicMetadata: { rol } });
  console.log(`Rol ${rol} asignado. El cambio aplica cuando el usuario renueve su sesion.`);
}

principal().catch((error) => {
  console.error(`No se pudo asignar el rol: ${error.message}`);
  process.exit(1);
});
