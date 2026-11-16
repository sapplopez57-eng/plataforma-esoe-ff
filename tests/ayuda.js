'use strict';

const crypto = require('node:crypto');
const http = require('node:http');
const { Client } = require('pg');
const { crearApp } = require('../src/app');
const { cargarConfig } = require('../src/config');
const { crearBaseDeDatos } = require('../src/db');
const { migrar } = require('../src/migraciones');

// --- Sesiones de prueba -----------------------------------------------------
// Se genera un par de llaves por ejecucion. El servidor verifica las sesiones
// con la llave publica, igual que en produccion, sin salir a la red.

const DOMINIO_CLERK = 'clerk.pruebas.example';
const ORIGEN = 'https://esoe.pruebas.example';
const CATEGORIA_SESION = 'cl_B7d4PD111AAA';
const llaves = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const otrasLlaves = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

const ENTORNO_CON_SESION = Object.freeze({
  CLERK_PUBLISHABLE_KEY: `pk_test_${Buffer.from(`${DOMINIO_CLERK}$`).toString('base64')}`,
  CLERK_SECRET_KEY: `sk_test_${'p'.repeat(40)}`,
  CLERK_JWT_KEY: llaves.publicKey.export({ type: 'spki', format: 'pem' }),
  ORIGEN_PUBLICO: ORIGEN,
  CLAVE_CIFRADO: crypto.randomBytes(32).toString('hex'),
  INTEGRACIONES_RED_PRIVADA: 'true',
  INTEGRACIONES_TIEMPO_MS: '1500'
});

function b64(objeto) {
  return Buffer.from(JSON.stringify(objeto)).toString('base64url');
}

function firmarSesion({ usuario = 'user_prueba', rol, firmante = llaves, ...reclamos } = {}) {
  const ahora = Math.floor(Date.now() / 1000);
  const cabecera = b64({ alg: 'RS256', typ: 'JWT', kid: 'ins_pruebas', cat: CATEGORIA_SESION });
  const cuerpo = b64({
    iss: `https://${DOMINIO_CLERK}`, sub: usuario, sid: `sess_${usuario}`, azp: ORIGEN,
    iat: ahora - 5, nbf: ahora - 5, exp: ahora + 60,
    ...(rol ? { metadata: { rol } } : {}),
    ...reclamos
  });
  const firma = crypto.sign('RSA-SHA256', Buffer.from(`${cabecera}.${cuerpo}`), firmante.privateKey).toString('base64url');
  return `${cabecera}.${cuerpo}.${firma}`;
}

function como(rol, usuario) {
  return { Authorization: `Bearer ${firmarSesion({ rol, usuario })}` };
}

// --- Servidor bajo prueba ---------------------------------------------------

async function levantar(env = {}, dependencias = {}) {
  const config = cargarConfig({ NODE_ENV: 'test', ...env });
  const servidor = crearApp(config, dependencias).listen(0, '127.0.0.1');
  await new Promise((resolve) => servidor.once('listening', resolve));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  return {
    base,
    pedir: (ruta, opciones) => fetch(base + ruta, { redirect: 'manual', ...opciones }),
    enviar: (ruta, cuerpo, cabeceras = {}, metodo = 'POST') => fetch(base + ruta, {
      method: metodo,
      redirect: 'manual',
      headers: { 'Content-Type': 'application/json', ...cabeceras },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo)
    }),
    cerrar: () => new Promise((resolve) => servidor.close(resolve))
  };
}

// --- Base de datos desechable ----------------------------------------------

const URL_ADMIN = process.env.PRUEBAS_DATABASE_URL || '';

async function crearBaseDePrueba() {
  const nombre = `esoe_prueba_${crypto.randomBytes(6).toString('hex')}`;
  const admin = new Client({ connectionString: URL_ADMIN });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${nombre}`);
  const url = new URL(URL_ADMIN);
  url.pathname = `/${nombre}`;
  // El esquema se crea con las migraciones, igual que en produccion, y con un
  // cliente de una sola conexion (ver src/migraciones.js).
  const cliente = new Client({ connectionString: url.toString() });
  await cliente.connect();
  try {
    await migrar({ cliente });
  } finally {
    await cliente.end();
  }
  const db = crearBaseDeDatos(url.toString());
  return {
    db,
    async cerrar() {
      await db.cerrar();
      await admin.query(`DROP DATABASE IF EXISTS ${nombre} WITH (FORCE)`);
      await admin.end();
    }
  };
}

// --- Moodle de imitacion ----------------------------------------------------
// Reproduce los tres puntos de entrada que usa el conector, con el mismo
// formato de respuesta que un Moodle real (errores incluidos, con estado 200).

async function crearMoodleFalso(opciones = {}) {
  const estado = {
    serviciosWeb: opciones.serviciosWeb !== false,
    usuarios: { 'alumno.prueba': { clave: 'Clave-Correcta-1', id: 42, nombre: 'Alumno De Prueba', token: 'tok-alumno-42' } },
    tokensRevocados: new Set(),
    peticiones: [],
    caido: false
  };

  const servidor = http.createServer((req, res) => {
    const trozos = [];
    req.on('data', (t) => trozos.push(t));
    req.on('end', () => {
      const cuerpo = Buffer.concat(trozos).toString('utf8');
      const url = new URL(req.url, 'http://moodle.local');
      estado.peticiones.push({ ruta: url.pathname, consulta: url.search, cuerpo });
      const responder = (dato, codigo = 200) => {
        res.writeHead(codigo, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(dato));
      };
      if (estado.caido) return responder({ error: 'caido' }, 500);

      if (url.pathname === '/lib/ajax/service-nologin.php') {
        return responder([{ error: false, data: {
          wwwroot: `http://127.0.0.1:${servidor.address().port}`, sitename: 'Moodle de pruebas',
          enablewebservices: estado.serviciosWeb ? 1 : 0, enablemobilewebservice: estado.serviciosWeb ? 1 : 0,
          maintenanceenabled: 0, typeoflogin: 1
        } }]);
      }

      const campos = new URLSearchParams(cuerpo);
      if (url.pathname === '/login/token.php') {
        const usuario = estado.usuarios[campos.get('username')];
        if (!usuario || usuario.clave !== campos.get('password')) {
          return responder({ error: 'Datos erroneos', errorcode: 'invalidlogin' });
        }
        return responder({ token: usuario.token, privatetoken: null });
      }

      if (url.pathname === '/webservice/rest/server.php') {
        const token = campos.get('wstoken');
        const usuario = Object.values(estado.usuarios).find((u) => u.token === token);
        if (!usuario || estado.tokensRevocados.has(token)) {
          return responder({ exception: 'moodle_exception', errorcode: 'invalidtoken', message: 'Token invalido' });
        }
        switch (campos.get('wsfunction')) {
          case 'core_webservice_get_site_info':
            return responder({ userid: usuario.id, fullname: usuario.nombre, sitename: 'Moodle de pruebas', release: '4.5' });
          case 'core_enrol_get_users_courses':
            return responder([
              { id: 7, fullname: 'Electricidad Básica', shortname: 'ELEC-1', progress: 62.4, completed: false, startdate: 1790000000, enddate: 0 },
              { id: 9, fullname: 'Ofimática <b>Avanzada</b>', shortname: 'OFI-2', progress: 100, completed: true, startdate: 1780000000, enddate: 1785000000 }
            ]);
          case 'gradereport_overview_get_course_grades':
            return responder({ grades: [{ courseid: 9, grade: '95.00' }] });
          default:
            return responder({ exception: 'dml_missing_record_exception', errorcode: 'invalidrecord', message: 'Funcion desconocida' });
        }
      }
      responder({ error: 'no encontrado' }, 404);
    });
  });

  await new Promise((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${servidor.address().port}`,
    estado,
    cerrar: () => new Promise((resolve) => servidor.close(resolve))
  };
}

module.exports = {
  levantar, firmarSesion, como, crearBaseDePrueba, crearMoodleFalso,
  ENTORNO_CON_SESION, ORIGEN, DOMINIO_CLERK, URL_ADMIN, otrasLlaves
};
