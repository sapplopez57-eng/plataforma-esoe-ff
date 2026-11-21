'use strict';

const express = require('express');
const { validar } = require('./validacion');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const RECURSOS = [
  {
    ruta: 'periodos', tabla: 'periodos_lectivos', tipo: 'periodo', clave: 'periodo',
    columnas: ['codigo', 'nombre', 'modalidad', 'fecha_inicio', 'fecha_fin', 'activo'],
    lectura: `id, codigo, nombre, modalidad, to_char(fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio,
              to_char(fecha_fin, 'YYYY-MM-DD') AS fecha_fin, activo`,
    orden: 'fecha_inicio DESC, codigo'
  },
  {
    ruta: 'promociones', tabla: 'promociones', tipo: 'promocion', clave: 'promocion',
    columnas: ['codigo', 'nombre', 'anio_ingreso', 'anio_egreso', 'descripcion', 'activa'],
    lectura: 'id, codigo, nombre, anio_ingreso, anio_egreso, descripcion, activa',
    orden: 'anio_ingreso DESC, codigo'
  },
  {
    ruta: 'materias', tabla: 'materias', tipo: 'materia', clave: 'materia',
    columnas: ['codigo', 'nombre', 'unidades_valorativas', 'horas_semanales', 'descripcion', 'activa'],
    lectura: 'id, codigo, nombre, unidades_valorativas, horas_semanales, descripcion, activa',
    orden: 'codigo'
  }
];

const rechazar = (res, campos) => res.status(422).json({ error: 'Hay datos que corregir.', campos });

function esDuplicado(error) {
  return error && error.code === '23505';
}

function crearRutasEstructura({ auth, db, permisos }) {
  const rutas = express.Router();
  if (!db) return rutas;
  const { resolverVinculo } = permisos;
  const conSesion = [auth.exigirSesion, resolverVinculo];
  const soloAdministracion = [auth.exigirRol('ADMIN'), resolverVinculo];

  for (const r of RECURSOS) {
    rutas.get(`/${r.ruta}`, ...conSesion, async (req, res, next) => {
      try {
        const { rows } = await db.consultar(
          `SELECT ${r.lectura} FROM ${r.tabla} WHERE institucion_id = $1 ORDER BY ${r.orden}`,
          [req.vinculo.institucionId]);
        res.set('Cache-Control', 'no-store');
        res.json({ [r.ruta]: rows });
      } catch (error) {
        next(error);
      }
    });

    rutas.post(`/${r.ruta}`, ...soloAdministracion, async (req, res, next) => {
      const { datos, campos } = validar(r.tipo, req.body);
      if (Object.keys(campos).length) return rechazar(res, campos);
      const nombres = Object.keys(datos).filter((c) => r.columnas.includes(c));
      try {
        const { rows } = await db.consultar(
          `INSERT INTO ${r.tabla} (institucion_id, ${nombres.join(', ')})
           VALUES ($1, ${nombres.map((_, i) => `$${i + 2}`).join(', ')})
           RETURNING ${r.lectura}`,
          [req.vinculo.institucionId, ...nombres.map((c) => datos[c])]
        );
        res.status(201).json({ [r.clave]: rows[0] });
      } catch (error) {
        if (esDuplicado(error)) return res.status(409).json({ error: 'Ese codigo ya existe.', campos: { codigo: 'Ya existe.' } });
        next(error);
      }
    });

    rutas.put(`/${r.ruta}/:id`, ...soloAdministracion, async (req, res, next) => {
      if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'Recurso no encontrado.' });
      try {
        const existente = await db.consultar(
          `SELECT ${r.lectura} FROM ${r.tabla} WHERE id = $1 AND institucion_id = $2`,
          [req.params.id, req.vinculo.institucionId]);
        if (!existente.rows.length) return res.status(404).json({ error: 'Recurso no encontrado.' });
        const { datos, campos } = validar(r.tipo, req.body, { parcial: true, actual: existente.rows[0] });
        if (Object.keys(campos).length) return rechazar(res, campos);
        const nombres = Object.keys(datos).filter((c) => r.columnas.includes(c));
        const { rows } = await db.consultar(
          `UPDATE ${r.tabla} SET ${nombres.map((c, i) => `${c} = $${i + 2}`).join(', ')}
            WHERE id = $1 RETURNING ${r.lectura}`,
          [req.params.id, ...nombres.map((c) => datos[c])]
        );
        res.json({ [r.clave]: rows[0] });
      } catch (error) {
        if (esDuplicado(error)) return res.status(409).json({ error: 'Ese codigo ya existe.', campos: { codigo: 'Ya existe.' } });
        next(error);
      }
    });
  }
  return rutas;
}

module.exports = { crearRutasEstructura, RECURSOS };
