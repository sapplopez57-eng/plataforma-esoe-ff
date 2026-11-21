'use strict';

const express = require('express');
const { validar } = require('./validacion');
const { esUuid } = require('../permisos');

const CAMPOS = {
  estudianteCompleto: ['id', 'codigo_alumno', 'dni', 'nombres', 'apellidos', 'condicion', 'grado',
    'fecha_nacimiento', 'tipo_sangre', 'telefono', 'correo', 'direccion', 'lugar_procedencia',
    'contacto_emergencia_nombre', 'contacto_emergencia_telefono', 'promocion_id', 'estado'],
  estudianteAula: ['id', 'codigo_alumno', 'nombres', 'apellidos', 'condicion', 'grado', 'promocion_id', 'estado'],
  catedraticoCompleto: ['id', 'dni', 'nombres', 'apellidos', 'titulo', 'condicion', 'grado', 'correo', 'telefono', 'activo'],
  catedraticoDirectorio: ['id', 'nombres', 'apellidos', 'titulo', 'condicion', 'grado']
};

const FECHAS = ['fecha_nacimiento'];
const seleccion = (campos) => campos
  .map((c) => (FECHAS.includes(c) ? `to_char(${c}, 'YYYY-MM-DD') AS ${c}` : c))
  .join(', ');

const ESTUDIANTE = {
  tabla: 'estudiantes',
  tipo: 'estudiante',
  completo: seleccion(CAMPOS.estudianteCompleto),
  aula: seleccion(CAMPOS.estudianteAula),
  columnas: CAMPOS.estudianteCompleto.filter((c) => c !== 'id'),
  unicos: ['codigo_alumno', 'dni']
};

const CATEDRATICO = {
  tabla: 'catedraticos',
  tipo: 'catedratico',
  completo: seleccion(CAMPOS.catedraticoCompleto),
  directorio: seleccion(CAMPOS.catedraticoDirectorio),
  columnas: CAMPOS.catedraticoCompleto.filter((c) => c !== 'id'),
  unicos: ['dni']
};

const rechazar = (res, campos) => res.status(422).json({ error: 'Hay datos que corregir.', campos });

function traducirError(error, recurso) {
  if (!error) return null;
  if (error.code === '23505') {
    const campo = recurso.unicos.find((c) => String(error.constraint || '').includes(c)) || recurso.unicos[0];
    return { estado: 409, cuerpo: { error: 'Ese dato ya esta registrado.', campos: { [campo]: 'Ya existe.' } } };
  }
  if (error.code === '23503' && String(error.constraint || '').includes('promocion')) {
    return { estado: 422, cuerpo: { error: 'Hay datos que corregir.', campos: { promocion_id: 'No existe esa promocion.' } } };
  }
  return null;
}

function crearRutasExpedientes({ auth, db, permisos }) {
  const rutas = express.Router();
  if (!db) return rutas;

  const { resolverVinculo, exigirEstudiantePropio } = permisos;
  const conSesion = [auth.exigirSesion, resolverVinculo];
  const soloAdministracion = [auth.exigirRol('ADMIN'), resolverVinculo];

  const privado = (res) => res.set('Cache-Control', 'no-store');

  async function crear(recurso, req, res, next) {
    const { datos, campos } = validar(recurso.tipo, req.body);
    if (Object.keys(campos).length) return rechazar(res, campos);
    const nombres = Object.keys(datos).filter((c) => recurso.columnas.includes(c));
    try {
      const { rows } = await db.consultar(
        `INSERT INTO ${recurso.tabla} (institucion_id, ${nombres.join(', ')})
         VALUES ($1, ${nombres.map((_, i) => `$${i + 2}`).join(', ')})
         RETURNING ${recurso.completo}`,
        [req.vinculo.institucionId, ...nombres.map((c) => datos[c])]
      );
      privado(res).status(201).json({ [recurso.tipo]: rows[0] });
    } catch (error) {
      const traducido = traducirError(error, recurso);
      if (traducido) return res.status(traducido.estado).json(traducido.cuerpo);
      next(error);
    }
  }

  async function editar(recurso, req, res, next) {
    if (!esUuid(req.params.id)) return res.status(404).json({ error: 'Expediente no encontrado.' });
    try {
      const existente = await db.consultar(
        `SELECT ${recurso.completo} FROM ${recurso.tabla} WHERE id = $1 AND institucion_id = $2`,
        [req.params.id, req.vinculo.institucionId]);
      if (!existente.rows.length) return res.status(404).json({ error: 'Expediente no encontrado.' });
      const { datos, campos } = validar(recurso.tipo, req.body, { parcial: true, actual: existente.rows[0] });
      if (Object.keys(campos).length) return rechazar(res, campos);
      const nombres = Object.keys(datos).filter((c) => recurso.columnas.includes(c));
      const { rows } = await db.consultar(
        `UPDATE ${recurso.tabla} SET ${nombres.map((c, i) => `${c} = $${i + 2}`).join(', ')}
          WHERE id = $1 RETURNING ${recurso.completo}`,
        [req.params.id, ...nombres.map((c) => datos[c])]
      );
      privado(res).json({ [recurso.tipo]: rows[0] });
    } catch (error) {
      const traducido = traducirError(error, recurso);
      if (traducido) return res.status(traducido.estado).json(traducido.cuerpo);
      next(error);
    }
  }

  rutas.get('/estudiantes', ...conSesion, async (req, res, next) => {
    try {
      const { rol } = req.identidad;
      const { promocion_id: promocion } = req.query;
      if (promocion !== undefined && !esUuid(promocion)) {
        return rechazar(res, { promocion_id: 'Debe ser un identificador valido.' });
      }
      let consulta;
      let parametros;
      if (rol === 'ADMIN') {
        consulta = `SELECT ${ESTUDIANTE.completo} FROM estudiantes
                     WHERE institucion_id = $2 AND ($1::uuid IS NULL OR promocion_id = $1)
                     ORDER BY apellidos, nombres`;
        parametros = [promocion || null, req.vinculo.institucionId];
      } else if (rol === 'CATEDRATICO') {
        consulta = `SELECT ${ESTUDIANTE.aula} FROM estudiantes
                     WHERE promocion_id IN (SELECT promocion_id FROM clases
                                             WHERE catedratico_id = $1 AND activa = TRUE)
                       AND ($2::uuid IS NULL OR promocion_id = $2)
                     ORDER BY apellidos, nombres`;
        parametros = [req.vinculo.referenciaId, promocion || null];
      } else {
        consulta = `SELECT ${ESTUDIANTE.completo} FROM estudiantes WHERE id = $1`;
        parametros = [req.vinculo.referenciaId];
      }
      const { rows } = await db.consultar(consulta, parametros);
      privado(res).json({ estudiantes: rows });
    } catch (error) {
      next(error);
    }
  });

  rutas.get('/estudiantes/:id', ...conSesion, exigirEstudiantePropio('id'), async (req, res, next) => {
    try {
      const columnas = req.identidad.rol === 'CATEDRATICO' ? ESTUDIANTE.aula : ESTUDIANTE.completo;
      const { rows } = await db.consultar(
        `SELECT ${columnas} FROM estudiantes WHERE id = $1 AND institucion_id = $2`,
        [req.params.id, req.vinculo.institucionId]);
      if (!rows.length) return res.status(404).json({ error: 'Expediente no encontrado.' });
      privado(res).json({ estudiante: rows[0] });
    } catch (error) {
      next(error);
    }
  });

  rutas.post('/estudiantes', ...soloAdministracion, (req, res, next) => crear(ESTUDIANTE, req, res, next));
  rutas.put('/estudiantes/:id', ...soloAdministracion, (req, res, next) => editar(ESTUDIANTE, req, res, next));

  rutas.get('/catedraticos', ...conSesion, async (req, res, next) => {
    try {
      const consulta = req.identidad.rol === 'ADMIN'
        ? `SELECT ${CATEDRATICO.completo} FROM catedraticos WHERE institucion_id = $1 ORDER BY apellidos, nombres`
        : `SELECT ${CATEDRATICO.directorio} FROM catedraticos
            WHERE institucion_id = $1 AND activo = TRUE ORDER BY apellidos, nombres`;
      const { rows } = await db.consultar(consulta, [req.vinculo.institucionId]);
      privado(res).json({ catedraticos: rows });
    } catch (error) {
      next(error);
    }
  });

  rutas.get('/catedraticos/:id', ...conSesion, async (req, res, next) => {
    try {
      const { id } = req.params;
      if (!esUuid(id)) return res.status(404).json({ error: 'Expediente no encontrado.' });
      const { rol } = req.identidad;
      const propio = rol === 'CATEDRATICO' && req.vinculo.referenciaId === id;
      const consulta = rol === 'ADMIN' || propio
        ? `SELECT ${CATEDRATICO.completo} FROM catedraticos WHERE id = $1 AND institucion_id = $2`
        : `SELECT ${CATEDRATICO.directorio} FROM catedraticos WHERE id = $1 AND institucion_id = $2 AND activo = TRUE`;
      const { rows } = await db.consultar(consulta, [id, req.vinculo.institucionId]);
      if (!rows.length) return res.status(404).json({ error: 'Expediente no encontrado.' });
      privado(res).json({ catedratico: rows[0] });
    } catch (error) {
      next(error);
    }
  });

  rutas.post('/catedraticos', ...soloAdministracion, (req, res, next) => crear(CATEDRATICO, req, res, next));
  rutas.put('/catedraticos/:id', ...soloAdministracion, (req, res, next) => editar(CATEDRATICO, req, res, next));

  return rutas;
}

module.exports = { crearRutasExpedientes, CAMPOS };
