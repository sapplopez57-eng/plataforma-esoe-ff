'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const { crearBaseDePrueba, URL_ADMIN } = require('./ayuda');
const { leerMigraciones } = require('../src/migraciones');

const sinBase = { skip: URL_ADMIN ? false : 'PRUEBAS_DATABASE_URL no definida' };
const MIGRACION = path.join(__dirname, '..', 'database', 'migraciones', '0012_calificacion_serializada.sql');
const SQL_0012 = fs.readFileSync(MIGRACION, 'utf8');
const VENTAJA_MS = 500;
const PLAZO_MS = 30000;

const TABLAS_MINIMAS = `
CREATE TABLE tareas (id INT PRIMARY KEY, puntaje_maximo NUMERIC(5,2) NOT NULL DEFAULT 100
  CHECK (puntaje_maximo > 0 AND puntaje_maximo <= 100));
CREATE TABLE entregas (id INT PRIMARY KEY, tarea_id INT NOT NULL, nota NUMERIC(5,2));
CREATE FUNCTION exigir_nota_dentro_del_puntaje() RETURNS trigger AS $$
DECLARE tope NUMERIC(5,2);
BEGIN
  IF NEW.nota IS NULL THEN RETURN NEW; END IF;
  SELECT puntaje_maximo INTO tope FROM tareas WHERE id = NEW.tarea_id;
  IF tope IS NOT NULL AND NEW.nota > tope THEN
    RAISE EXCEPTION 'La nota % pasa del puntaje maximo % de la tarea.', NEW.nota, tope USING ERRCODE='check_violation';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER entregas_nota_dentro_del_puntaje BEFORE INSERT OR UPDATE OF nota, tarea_id ON entregas
  FOR EACH ROW EXECUTE FUNCTION exigir_nota_dentro_del_puntaje();
CREATE FUNCTION exigir_puntaje_sobre_las_notas() RETURNS trigger AS $$
DECLARE mayor NUMERIC(5,2);
BEGIN
  IF NEW.puntaje_maximo >= OLD.puntaje_maximo THEN RETURN NEW; END IF;
  SELECT MAX(nota) INTO mayor FROM entregas WHERE tarea_id = NEW.id;
  IF mayor IS NOT NULL AND mayor > NEW.puntaje_maximo THEN
    RAISE EXCEPTION 'Ya hay una nota de % en esta tarea: el puntaje maximo no puede bajar a %.', mayor, NEW.puntaje_maximo USING ERRCODE='check_violation';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER tareas_puntaje_sobre_las_notas BEFORE UPDATE OF puntaje_maximo ON tareas
  FOR EACH ROW EXECUTE FUNCTION exigir_puntaje_sobre_las_notas();
INSERT INTO tareas (id, puntaje_maximo) VALUES (1, 100);
INSERT INTO entregas (id, tarea_id, nota) VALUES (1, 1, NULL);
`;

async function baseDesnuda(conLaMigracion) {
  const nombre = `prueba_carrera_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const admin = new Client({ connectionString: URL_ADMIN });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${nombre}`);
  const url = new URL(URL_ADMIN);
  url.pathname = `/${nombre}`;
  const preparar = new Client({ connectionString: url.toString() });
  await preparar.connect();
  await preparar.query(TABLAS_MINIMAS);
  if (conLaMigracion) await preparar.query(SQL_0012);
  await preparar.end();
  return {
    url: url.toString(),
    async cerrar() {
      await admin.query(`DROP DATABASE IF EXISTS ${nombre}`);
      await admin.end();
    }
  };
}

async function carreraDeCalificacion(url) {
  const bajaElMaximo = new Client({ connectionString: url });
  const califica = new Client({ connectionString: url, statement_timeout: PLAZO_MS });
  await bajaElMaximo.connect();
  await califica.connect();
  const resultado = { confirmaron: 0, error: null };
  try {
    await bajaElMaximo.query('BEGIN');
    await bajaElMaximo.query('UPDATE tareas SET puntaje_maximo = 50 WHERE id = 1');

    await califica.query('BEGIN');
    const calificando = califica.query('UPDATE entregas SET nota = 90 WHERE id = 1')
      .then(() => ({ fallo: null }), (error) => ({ fallo: error }));
    await new Promise((seguir) => setTimeout(seguir, VENTAJA_MS));

    await bajaElMaximo.query('COMMIT');
    resultado.confirmaron += 1;
    const { fallo } = await calificando;
    if (fallo) {
      resultado.error = fallo.message;
      await califica.query('ROLLBACK').catch(() => {});
    } else {
      try {
        await califica.query('COMMIT');
        resultado.confirmaron += 1;
      } catch (error) {
        resultado.error = error.message;
        await califica.query('ROLLBACK').catch(() => {});
      }
    }
    const { rows } = await bajaElMaximo.query(
      'SELECT t.puntaje_maximo AS tope, e.nota FROM tareas t JOIN entregas e ON e.tarea_id = t.id');
    resultado.tope = Number(rows[0].tope);
    resultado.nota = rows[0].nota === null ? null : Number(rows[0].nota);
  } finally {
    await bajaElMaximo.end().catch(() => {});
    await califica.end().catch(() => {});
  }
  return resultado;
}

test('carrera: sin la migracion 0012 el invariante se rompe de verdad', sinBase, async () => {
  const base = await baseDesnuda(false);
  try {
    const r = await carreraDeCalificacion(base.url);
    assert.equal(r.confirmaron, 2, 'las dos transacciones deberian confirmar sin el candado');
    assert.equal(r.tope, 50);
    assert.equal(r.nota, 90);
    assert.ok(r.nota > r.tope, `el invariante deberia quedar roto: nota ${r.nota} sobre tope ${r.tope}`);
  } finally {
    await base.cerrar();
  }
});

test('carrera: con la migracion 0012 la calificacion se serializa y el invariante aguanta', sinBase, async () => {
  const base = await baseDesnuda(true);
  try {
    const r = await carreraDeCalificacion(base.url);
    assert.equal(r.tope, 50);
    assert.ok(r.nota === null || r.nota <= r.tope,
      `el invariante no debe romperse: nota ${r.nota} sobre tope ${r.tope}`);
    assert.equal(r.confirmaron, 1, 'la calificacion que pasaba del nuevo tope no debe confirmar');
    assert.match(String(r.error), /puntaje maximo/i);
  } finally {
    await base.cerrar();
  }
});

test('carrera: con el candado, una nota que si cabe en el nuevo tope se acepta', sinBase, async () => {
  const base = await baseDesnuda(true);
  try {
    const cliente = new Client({ connectionString: base.url });
    await cliente.connect();
    await cliente.query('UPDATE tareas SET puntaje_maximo = 50 WHERE id = 1');
    await cliente.query('UPDATE entregas SET nota = 40 WHERE id = 1');
    const { rows } = await cliente.query('SELECT nota FROM entregas WHERE id = 1');
    assert.equal(Number(rows[0].nota), 40);
    await assert.rejects(cliente.query('UPDATE entregas SET nota = 60 WHERE id = 1'), /puntaje maximo/i);
    await cliente.end();
  } finally {
    await base.cerrar();
  }
});

test('carrera: la migracion 0012 se aplica sobre el esquema real sin romper nada', sinBase, async () => {
  const base = await crearBaseDePrueba();
  try {
    const ultima = Math.max(...leerMigraciones().map((m) => m.version));
    const { rows } = await base.db.consultar(
      'SELECT MAX(version) AS version FROM migraciones_aplicadas');
    assert.equal(Number(rows[0].version), ultima,
      `el esquema real debe llegar a la ultima migracion en disco, la ${ultima}`);
    const { rows: funcion } = await base.db.consultar(
      `SELECT prosrc FROM pg_proc WHERE proname = 'exigir_nota_dentro_del_puntaje'`);
    assert.equal(funcion.length, 1);
    assert.match(funcion[0].prosrc, /FOR UPDATE/,
      'la funcion viva en el esquema real debe tomar el candado sobre la tarea');
  } finally {
    await base.cerrar();
  }
});
