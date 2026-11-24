'use strict';

const { Client } = require('pg');
const { cargarConfig, tlsDeBaseDeDatos, hostDeBaseDeDatos, esHostLocal } = require('../src/config');
const { leerMigraciones } = require('../src/migraciones');

const TIEMPO_MAXIMO_MS = 10000;
const ATRIBUTOS_DE_ADMINISTRACION = {
  rolsuper: 'superusuario',
  rolcreatedb: 'crear bases',
  rolcreaterole: 'crear roles',
  rolbypassrls: 'omitir seguridad por fila'
};

async function conectarConPg(url, ssl) {
  const cliente = new Client({
    connectionString: url,
    ssl,
    connectionTimeoutMillis: TIEMPO_MAXIMO_MS,
    statement_timeout: TIEMPO_MAXIMO_MS,
    query_timeout: TIEMPO_MAXIMO_MS
  });
  await cliente.connect();
  return cliente;
}

function revisarConfiguracion(env, informe) {
  try {
    const config = cargarConfig(env);
    informe.datos.entorno = config.entorno;
    informe.datos.tls = config.tlsBaseDeDatos;
    informe.datos.sinEstado = config.sinEstado;
    if (!config.esProduccion) {
      informe.avisos.push(`NODE_ENV es ${config.entorno}: no se comprueban las exigencias de produccion.`);
    }
    return config;
  } catch (error) {
    informe.fallos.push(error.message);
    return null;
  }
}

async function revisarBaseDeDatos(config, env, informe, conectar) {
  if (!config.databaseUrl) {
    informe.fallos.push('DATABASE_URL no esta definida: no hay base de datos que comprobar.');
    return;
  }
  const { ssl } = tlsDeBaseDeDatos(env);
  const host = hostDeBaseDeDatos(config.databaseUrl);
  informe.datos.host = host;
  let cliente;
  try {
    cliente = await conectar(config.databaseUrl, ssl);
  } catch (error) {
    informe.fallos.push(`No se pudo conectar a la base de datos: ${error.message}`);
    return;
  }
  try {
    const { rows: [cifrado] } = await cliente.query(
      'SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()');
    const conCifrado = Boolean(cifrado && cifrado.ssl);
    informe.datos.conexionCifrada = conCifrado;
    if (!conCifrado && !esHostLocal(host)) {
      informe.fallos.push('La conexion con una base remota viaja sin cifrar. Revise DB_SSL y el servidor.');
    }

    const { rows: [rol] } = await cliente.query(
      `SELECT current_user AS usuario, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls
         FROM pg_roles WHERE rolname = current_user`);
    informe.datos.usuario = rol ? rol.usuario : '';
    const privilegios = rol
      ? Object.entries(ATRIBUTOS_DE_ADMINISTRACION).filter(([col]) => rol[col] === true).map(([, nombre]) => nombre)
      : [];
    if (privilegios.length > 0) {
      informe.fallos.push(`El rol ${rol.usuario} tiene privilegios de administracion (${privilegios.join(', ')}). La aplicacion debe usar un rol sin ellos.`);
    }

    const { rows: [escritura] } = await cliente.query(
      "SELECT NOT pg_is_in_recovery() AND current_setting('transaction_read_only') = 'off' AS disponible");
    if (!escritura || escritura.disponible !== true) {
      informe.fallos.push('La base de datos no acepta escrituras.');
    }

    const { rows: [permisos] } = await cliente.query(
      `SELECT has_table_privilege('estudiantes', 'INSERT') AS inserta,
              has_table_privilege('calificaciones', 'UPDATE') AS actualiza`);
    informe.datos.puedeEscribir = Boolean(permisos && permisos.inserta && permisos.actualiza);
    if (!informe.datos.puedeEscribir) {
      informe.fallos.push(`El rol ${informe.datos.usuario} no tiene permiso para escribir en las tablas de la aplicacion.`);
    }

    const esperada = leerMigraciones().length;
    informe.datos.esquemaEsperado = esperada;
    const { rows } = await cliente.query(
      `SELECT COALESCE(MAX(version), 0) AS version FROM migraciones_aplicadas`);
    const aplicada = Number(rows[0].version);
    informe.datos.esquemaAplicado = aplicada;
    if (aplicada < esperada) {
      informe.fallos.push(`El esquema esta en la version ${aplicada} y el codigo espera la ${esperada}. Ejecute 'npm run migrar'.`);
    } else if (aplicada > esperada) {
      informe.fallos.push(`El esquema esta en la version ${aplicada}, mas nueva que la ${esperada} que conoce este codigo. Actualice el codigo.`);
    }
  } catch (error) {
    if (error.code === '42P01') {
      informe.fallos.push("La base de datos no tiene el esquema aplicado. Ejecute 'npm run migrar'.");
    } else {
      informe.fallos.push(`Fallo una comprobacion en la base de datos: ${error.message}`);
    }
  } finally {
    await cliente.end().catch(() => {});
  }
}

async function comprobarDespliegue({ env = process.env, conectar = conectarConPg } = {}) {
  const informe = { fallos: [], avisos: [], datos: {} };
  const config = revisarConfiguracion(env, informe);
  if (config) await revisarBaseDeDatos(config, env, informe, conectar);
  return informe;
}

function imprimir(informe) {
  for (const [clave, valor] of Object.entries(informe.datos)) {
    console.log(`   ${clave}: ${valor}`);
  }
  for (const aviso of informe.avisos) console.log(`   AVISO  ${aviso}`);
  for (const fallo of informe.fallos) console.error(`   FALLO  ${fallo}`);
  if (informe.fallos.length > 0) {
    console.error(`[ESOE-SMS] El despliegue NO esta listo: ${informe.fallos.length} fallo(s).`);
    return 1;
  }
  console.log('[ESOE-SMS] Despliegue listo: configuracion, cifrado, rol y esquema en orden.');
  return 0;
}

if (require.main === module) {
  comprobarDespliegue()
    .then((informe) => { process.exitCode = imprimir(informe); })
    .catch((error) => {
      console.error(`[ESOE-SMS] No se pudo comprobar el despliegue: ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = { comprobarDespliegue, imprimir };
