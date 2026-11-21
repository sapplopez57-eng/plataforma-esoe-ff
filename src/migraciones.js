'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DIRECTORIO = path.join(__dirname, '..', 'database', 'migraciones');
const NOMBRE_VALIDO = /^(\d{4})_([a-z0-9_]+)\.sql$/;
const CANDADO = 815_042_001;

class ErrorDeMigracion extends Error {
  constructor(mensaje, codigo) {
    super(mensaje);
    this.name = 'ErrorDeMigracion';
    this.codigo = codigo;
  }
}

function huella(contenido) {
  return crypto.createHash('sha256').update(contenido, 'utf8').digest('hex');
}

function leerMigraciones(directorio = DIRECTORIO) {
  const archivos = fs.readdirSync(directorio).filter((n) => n.endsWith('.sql')).sort();
  const migraciones = [];
  for (const archivo of archivos) {
    const partes = NOMBRE_VALIDO.exec(archivo);
    if (!partes) {
      throw new ErrorDeMigracion(
        `El archivo ${archivo} no sigue el formato NNNN_descripcion.sql (minusculas, digitos y guion bajo).`,
        'NOMBRE_INVALIDO'
      );
    }
    const version = Number(partes[1]);
    const contenido = fs.readFileSync(path.join(directorio, archivo), 'utf8');
    migraciones.push({ version, nombre: partes[2], archivo, contenido, huella: huella(contenido) });
  }
  migraciones.forEach((m, i) => {
    if (m.version !== i + 1) {
      throw new ErrorDeMigracion(
        `Se esperaba la migracion ${String(i + 1).padStart(4, '0')} y se encontro ${m.archivo}. `
        + 'Las versiones van seguidas, desde 0001, sin saltos ni repetidos.',
        'SECUENCIA_ROTA'
      );
    }
  });
  return migraciones;
}

function tablasQueCrea(contenido) {
  return [...contenido.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?([a-z_][a-z0-9_]*)/gi)].map((m) => m[1].toLowerCase());
}

async function adoptarBaseExistente(cliente, primera, registrar) {
  const esperadas = tablasQueCrea(primera.contenido);
  if (esperadas.length === 0) return false;
  const { rows } = await cliente.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_name = ANY($1)`,
    [esperadas]
  );
  if (rows.length === 0) return false;
  if (rows.length < esperadas.length) {
    const hay = new Set(rows.map((r) => r.table_name));
    throw new ErrorDeMigracion(
      `La base tiene parte del esquema inicial pero le faltan tablas (${esperadas.filter((t) => !hay.has(t)).join(', ')}). `
      + 'No se puede adoptar ni migrar automaticamente: revisela a mano.',
      'ESQUEMA_PARCIAL'
    );
  }
  await cliente.query(
    'INSERT INTO migraciones_aplicadas (version, nombre, huella) VALUES ($1, $2, $3)',
    [primera.version, primera.nombre, primera.huella]
  );
  registrar(`Adoptada ${primera.archivo}: la base ya tenia el esquema inicial`);
  return true;
}

async function migrar({ cliente, directorio = DIRECTORIO, registrar = () => {} } = {}) {
  if (!cliente || typeof cliente.query !== 'function') {
    throw new ErrorDeMigracion('migrar() necesita un cliente de pg de una sola conexion.', 'SIN_CLIENTE');
  }
  const migraciones = leerMigraciones(directorio);

  await cliente.query('SELECT pg_advisory_lock($1)', [CANDADO]);
  try {
    await cliente.query(`
      CREATE TABLE IF NOT EXISTS migraciones_aplicadas (
        version INTEGER PRIMARY KEY,
        nombre VARCHAR(120) NOT NULL,
        huella CHAR(64) NOT NULL,
        aplicada_en TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
    let { rows } = await cliente.query('SELECT version, nombre, huella FROM migraciones_aplicadas ORDER BY version');

    let adoptada = false;
    if (rows.length === 0 && migraciones.length > 0) {
      adoptada = await adoptarBaseExistente(cliente, migraciones[0], registrar);
      if (adoptada) ({ rows } = await cliente.query('SELECT version, nombre, huella FROM migraciones_aplicadas ORDER BY version'));
    }
    const aplicadas = new Map(rows.map((r) => [r.version, r]));

    const ultimaConocida = migraciones.length;
    const ajena = rows.find((r) => r.version > ultimaConocida);
    if (ajena) {
      throw new ErrorDeMigracion(
        `La base ya tiene la migracion ${ajena.version} (${ajena.nombre}), que este codigo no conoce. `
        + 'Actualice el codigo antes de migrar.',
        'BASE_MAS_NUEVA'
      );
    }

    for (const m of migraciones) {
      const previa = aplicadas.get(m.version);
      if (previa && previa.huella !== m.huella) {
        throw new ErrorDeMigracion(
          `La migracion ${m.archivo} cambio despues de aplicarse. Una migracion aplicada no se edita: `
          + 'escriba una nueva con el cambio.',
          'MIGRACION_ALTERADA'
        );
      }
    }

    const nuevas = migraciones.filter((m) => !aplicadas.has(m.version));
    for (const m of nuevas) {
      await cliente.query('BEGIN');
      try {
        await cliente.query(m.contenido);
        await cliente.query(
          'INSERT INTO migraciones_aplicadas (version, nombre, huella) VALUES ($1, $2, $3)',
          [m.version, m.nombre, m.huella]
        );
        await cliente.query('COMMIT');
        registrar(`Aplicada ${m.archivo}`);
      } catch (error) {
        await cliente.query('ROLLBACK');
        throw new ErrorDeMigracion(`Fallo la migracion ${m.archivo}: ${error.message}`, 'FALLO_AL_APLICAR');
      }
    }

    return {
      version: migraciones.length,
      aplicadas: nuevas.map((m) => m.archivo),
      yaEstaban: migraciones.length - nuevas.length,
      adoptada
    };
  } finally {
    await cliente.query('SELECT pg_advisory_unlock($1)', [CANDADO]);
  }
}

module.exports = { migrar, leerMigraciones, ErrorDeMigracion, DIRECTORIO };
