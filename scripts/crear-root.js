'use strict';

const { createClerkClient } = require('@clerk/express');
const { Client } = require('pg');
const { tlsDeBaseDeDatos } = require('../src/config');

function datosRoot(env) {
  const usuario = String(env.ESOE_ROOT_USUARIO || '').trim().toLowerCase();
  const clave = String(env.ESOE_ROOT_CLAVE || '');
  const nombre = String(env.ESOE_ROOT_NOMBRE || usuario).trim();
  const correo = String(env.ESOE_ROOT_CORREO || '').trim();
  const institucion = String(env.ESOE_ROOT_INSTITUCION || 'ESOE').trim().toUpperCase();
  const faltan = [];
  if (!/^[a-z0-9_-]{3,40}$/.test(usuario)) faltan.push('ESOE_ROOT_USUARIO (3 a 40: letras, numeros, - o _)');
  if (clave.length < 8) faltan.push('ESOE_ROOT_CLAVE (8 caracteres como minimo)');
  if (correo && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) faltan.push('ESOE_ROOT_CORREO');
  if (!env.CLERK_SECRET_KEY) faltan.push('CLERK_SECRET_KEY');
  if (!env.DATABASE_URL) faltan.push('DATABASE_URL');
  if (!/^[A-Z0-9][A-Z0-9-]{1,19}$/.test(institucion)) faltan.push('ESOE_ROOT_INSTITUCION');
  return { usuario, clave, nombre, correo, institucion, faltan };
}

async function registrarAdministrador(cliente, cuenta, nombre, institucionId) {
  await cliente.query(
    `INSERT INTO usuarios (username,proveedor_id,rol,nombre_completo,institucion_id,activo,es_root)
     VALUES ($1,$2,'ADMIN',$3,$4,true,true)
     ON CONFLICT (proveedor_id) DO UPDATE
       SET username=EXCLUDED.username,rol='ADMIN',nombre_completo=EXCLUDED.nombre_completo,
           institucion_id=EXCLUDED.institucion_id,referencia_id=NULL,activo=true,es_root=true`,
    [cuenta.username, cuenta.id, nombre, institucionId]);
}

async function principal() {
  const { usuario, clave, nombre, correo, institucion, faltan } = datosRoot(process.env);
  if (faltan.length) {
    console.error(`Falta o no es valido en .env: ${faltan.join(', ')}.`);
    process.exit(2);
  }
  const cliente = new Client({ connectionString: process.env.DATABASE_URL, ssl: tlsDeBaseDeDatos(process.env).ssl, connectionTimeoutMillis: 3000 });
  await cliente.connect();
  try {
    const { rows } = await cliente.query('SELECT id FROM instituciones WHERE codigo=$1 AND activa', [institucion]);
    if (rows.length !== 1) throw new Error('La institucion no esta disponible.');
    const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY, telemetry: { disabled: true } });
    const { data: existentes } = await clerk.users.getUserList({ username: [usuario], limit: 2 });
    if (existentes.length > 1) throw new Error('El usuario no es unico.');
    const metadatos = { publicMetadata: { rol: 'ADMIN', root: true } };
    let cuenta;
    if (existentes.length === 0) {
      cuenta = await clerk.users.createUser({
        username: usuario, ...(correo ? { emailAddress: [correo] } : {}), password: clave, firstName: nombre, ...metadatos
      });
    } else {
      cuenta = await clerk.users.updateUser(existentes[0].id, { password: clave, firstName: nombre });
      await clerk.users.updateUserMetadata(cuenta.id, metadatos);
    }
    await registrarAdministrador(cliente, cuenta, nombre, rows[0].id);
    console.log(`Cuenta administradora aprovisionada: ${cuenta.username}, institucion ${institucion}.`);
  } finally {
    await cliente.end();
  }
}

if (require.main === module) {
  principal().catch(() => {
    console.error('No se pudo aprovisionar la cuenta. Revise el acceso a Clerk, su politica de contrasenas y el vinculo con la base de datos. No se omitieron controles del proveedor.');
    process.exit(1);
  });
}

module.exports = { datosRoot, registrarAdministrador };
