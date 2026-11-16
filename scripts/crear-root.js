'use strict';

// Crea (o actualiza) la cuenta root de la plataforma en Clerk, con rol ADMIN.
// Usuario, nombre, correo y contrasena salen de .env (ESOE_ROOT_USUARIO, ESOE_ROOT_NOMBRE,
// ESOE_ROOT_CORREO, ESOE_ROOT_CLAVE): nunca de la linea de comandos ni del codigo, y la contrasena
// no se imprime.
//
// Uso: node scripts/crear-root.js
// Requiere CLERK_SECRET_KEY y que la instancia de Clerk admita usuario y contrasena.

const fs = require('node:fs');
const path = require('node:path');
const { createClerkClient } = require('@clerk/express');

function leerEnv() {
  const archivo = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(archivo)) return;
  for (const linea of fs.readFileSync(archivo, 'utf8').split('\n')) {
    const partes = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(linea);
    if (!partes || process.env[partes[1]] !== undefined) continue;
    process.env[partes[1]] = partes[2].replace(/^"(.*)"$/s, '$1').replace(/^'(.*)'$/s, '$1');
  }
}

function datosRoot(env) {
  const usuario = String(env.ESOE_ROOT_USUARIO || '').trim().toLowerCase();
  const clave = String(env.ESOE_ROOT_CLAVE || '');
  const nombre = String(env.ESOE_ROOT_NOMBRE || usuario).trim();
  // La instancia de Clerk exige correo en cada cuenta.
  const correo = String(env.ESOE_ROOT_CORREO || '').trim();
  const faltan = [];
  if (!/^[a-z0-9_-]{3,40}$/.test(usuario)) faltan.push('ESOE_ROOT_USUARIO (3 a 40: letras, numeros, - o _)');
  if (clave.length < 8) faltan.push('ESOE_ROOT_CLAVE (8 caracteres como minimo)');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) faltan.push('ESOE_ROOT_CORREO');
  if (!env.CLERK_SECRET_KEY) faltan.push('CLERK_SECRET_KEY');
  return { usuario, clave, nombre, correo, faltan };
}

async function principal() {
  leerEnv();
  const { usuario, clave, nombre, correo, faltan } = datosRoot(process.env);
  if (faltan.length) {
    console.error(`Falta o no es valido en .env: ${faltan.join(', ')}.`);
    process.exit(2);
  }
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY, telemetry: { disabled: true } });
  const { data: existentes } = await clerk.users.getUserList({ username: [usuario], limit: 2 });
  const metadatos = { publicMetadata: { rol: 'ADMIN', root: true } };
  let cuenta;
  if (existentes.length === 0) {
    cuenta = await clerk.users.createUser({
      username: usuario, emailAddress: [correo], password: clave, firstName: nombre, skipPasswordChecks: true, ...metadatos
    });
    console.log(`Cuenta root creada: ${cuenta.username} (${cuenta.id}), rol ADMIN.`);
  } else {
    cuenta = await clerk.users.updateUser(existentes[0].id, { password: clave, firstName: nombre, skipPasswordChecks: true });
    await clerk.users.updateUserMetadata(cuenta.id, metadatos);
    console.log(`Cuenta root actualizada: ${cuenta.username} (${cuenta.id}), rol ADMIN; contrasena renovada.`);
  }
}

if (require.main === module) {
  principal().catch((error) => {
    const detalle = (error.errors || []).map((e) => e.longMessage || e.message).join(' ') || error.message;
    console.error(`No se pudo crear la cuenta root: ${detalle}`);
    process.exit(1);
  });
}

module.exports = { datosRoot };
