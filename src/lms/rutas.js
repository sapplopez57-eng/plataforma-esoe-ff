'use strict';

const express = require('express');
const { validarLms } = require('./validacion');
const { esUuid } = require('../permisos');

const LECTURA_CURSO = 'id, clase_id, titulo, descripcion, publicado, creado_en, actualizado_en';
const LECTURA_UNIDAD = 'id, curso_id, orden, titulo, descripcion, publicada';
const LECTURA_CONTENIDO = 'id, unidad_id, orden, titulo, tipo, cuerpo, url, publicado';
const LECTURA_TAREA = `id, curso_id, unidad_id, titulo, instrucciones, puntaje_maximo,
                       fecha_entrega, permite_atraso, publicada`;
const LECTURA_ENTREGA = `id, tarea_id, estudiante_id, texto, url, estado, nota,
                         retroalimentacion, entregada_en, calificada_en, actualizada_en`;

const COLUMNAS = {
  curso: ['titulo', 'descripcion', 'publicado'],
  unidad: ['orden', 'titulo', 'descripcion', 'publicada'],
  contenido: ['orden', 'titulo', 'tipo', 'cuerpo', 'url', 'publicado'],
  tarea: ['unidad_id', 'titulo', 'instrucciones', 'puntaje_maximo', 'fecha_entrega', 'permite_atraso', 'publicada']
};

const DUENO = {
  unidad: `SELECT u.institucion_id, u.curso_id, c.clase_id
             FROM unidades u JOIN cursos c ON c.id = u.curso_id WHERE u.id = $1`,
  contenido: `SELECT co.institucion_id, c.clase_id
                FROM contenidos co JOIN unidades u ON u.id = co.unidad_id
                JOIN cursos c ON c.id = u.curso_id WHERE co.id = $1`,
  tarea: `SELECT t.institucion_id, t.curso_id, t.puntaje_maximo, t.fecha_entrega, t.permite_atraso,
                 t.publicada, c.publicado AS curso_publicado, c.clase_id
            FROM tareas t JOIN cursos c ON c.id = t.curso_id WHERE t.id = $1`,
  entrega: `SELECT e.institucion_id, e.estudiante_id, e.tarea_id, t.puntaje_maximo, c.clase_id
              FROM entregas e JOIN tareas t ON t.id = e.tarea_id
              JOIN cursos c ON c.id = t.curso_id WHERE e.id = $1`
};

const NO_ENCONTRADO = {
  curso: 'El curso no existe.',
  unidad: 'Unidad no encontrada.',
  contenido: 'Contenido no encontrado.',
  tarea: 'Tarea no encontrada.',
  entrega: 'Entrega no encontrada.'
};

const SIN_PERMISO = 'No tiene permiso para consultar este recurso.';
const rechazar = (res, campos) => res.status(422).json({ error: 'Hay datos que corregir.', campos });
const privado = (res) => res.set('Cache-Control', 'no-store');

function traducirError(error) {
  const restriccion = String(error?.constraint || '');
  if (error?.code === '23505' && restriccion === 'unidades_curso_orden_key') {
    return [409, { error: 'Ese orden ya esta ocupado en el curso.', campos: { orden: 'Ya esta ocupado.' } }];
  }
  if (error?.code === '23505' && restriccion === 'contenidos_unidad_orden_key') {
    return [409, { error: 'Ese orden ya esta ocupado en la unidad.', campos: { orden: 'Ya esta ocupado.' } }];
  }
  if (error?.code === '23503' && restriccion.includes('unidad_id')) {
    return [422, { error: 'Hay datos que corregir.', campos: { unidad_id: 'No existe.' } }];
  }
  if (error?.code === '23514' && /unidad pertenece a otro curso/i.test(String(error.message))) {
    return [422, { error: 'Hay datos que corregir.', campos: { unidad_id: 'Pertenece a otro curso.' } }];
  }
  if (error?.code === '23514' && /promocion de esta clase/i.test(String(error.message))) {
    return [403, { error: 'El estudiante no pertenece a la promocion de esta clase.', codigo: 'NO_ES_SUYO' }];
  }
  return null;
}

function listaDeColumnas(tipo, datos) {
  return COLUMNAS[tipo].filter((c) => Object.prototype.hasOwnProperty.call(datos, c));
}

function crearRutasLms({ auth, db, permisos }) {
  const rutas = express.Router();
  if (!db) return rutas;

  const { resolverVinculo, exigirClasePropia, exigirClaseVisible, imparteLaClase, estudianteEnLaClase } = permisos;
  const conSesion = [auth.exigirSesion, resolverVinculo];
  const sobreLaClase = [...conSesion, exigirClasePropia('id')];
  const viendoLaClase = [...conSesion, exigirClaseVisible('id')];
  const soloLectura = (req) => req.identidad.rol === 'ESTUDIANTE';

  function exigirRecurso(tipo, { escritura = true } = {}) {
    return async function guardianDeRecurso(req, res, next) {
      try {
        const id = req.params.id;
        if (!esUuid(id)) return res.status(404).json({ error: NO_ENCONTRADO[tipo] });
        const { rows: [fila] } = await db.consultar(DUENO[tipo], [id]);
        if (!fila || fila.institucion_id !== req.vinculo.institucionId) {
          return res.status(404).json({ error: NO_ENCONTRADO[tipo] });
        }
        req.recurso = fila;
        const { rol } = req.identidad;
        if (rol === 'ADMIN') return next();
        if (rol === 'CATEDRATICO' && await imparteLaClase(req.vinculo.referenciaId, fila.clase_id)) return next();
        if (!escritura && rol === 'ESTUDIANTE'
          && await estudianteEnLaClase(req.vinculo.referenciaId, fila.clase_id)) return next();
        res.status(403).json({ error: SIN_PERMISO, codigo: 'NO_ES_SUYO' });
      } catch (error) {
        next(error);
      }
    };
  }

  async function cursoDeLaClase(claseId) {
    const { rows } = await db.consultar(`SELECT ${LECTURA_CURSO} FROM cursos WHERE clase_id = $1`, [claseId]);
    return rows[0] || null;
  }

  rutas.get('/clases/:id/curso', ...viendoLaClase, async (req, res, next) => {
    try {
      const curso = await cursoDeLaClase(req.params.id);
      if (!curso) return res.status(404).json({ error: NO_ENCONTRADO.curso });
      const soloPublicado = soloLectura(req);
      if (soloPublicado && !curso.publicado) return res.status(404).json({ error: NO_ENCONTRADO.curso });
      const { rows: unidades } = await db.consultar(
        `SELECT ${LECTURA_UNIDAD} FROM unidades
          WHERE curso_id = $1 AND ($2::boolean IS FALSE OR publicada = TRUE) ORDER BY orden`,
        [curso.id, soloPublicado]);
      const { rows: contenidos } = await db.consultar(
        `SELECT co.id, co.unidad_id, co.orden, co.titulo, co.tipo, co.cuerpo, co.url, co.publicado
           FROM contenidos co JOIN unidades u ON u.id = co.unidad_id
          WHERE co.unidad_id = ANY($1::uuid[])
            AND ($2::boolean IS FALSE OR (co.publicado = TRUE AND u.publicada = TRUE))
          ORDER BY co.orden`,
        [unidades.map((u) => u.id), soloPublicado]);
      const { rows: tareas } = await db.consultar(
        `SELECT ${LECTURA_TAREA} FROM tareas
          WHERE curso_id = $1 AND ($2::boolean IS FALSE OR publicada = TRUE) ORDER BY fecha_entrega`,
        [curso.id, soloPublicado]);
      privado(res).json({
        curso,
        unidades: unidades.map((u) => ({ ...u, contenidos: contenidos.filter((c) => c.unidad_id === u.id) })),
        tareas
      });
    } catch (error) {
      next(error);
    }
  });

  rutas.put('/clases/:id/curso', ...sobreLaClase, async (req, res, next) => {
    const { datos, campos } = validarLms('curso', req.body);
    if (Object.keys(campos).length) return rechazar(res, campos);
    const nombres = listaDeColumnas('curso', datos);
    try {
      const { rows } = await db.consultar(
        `INSERT INTO cursos (institucion_id, clase_id, ${nombres.join(', ')})
         VALUES ($1, $2, ${nombres.map((_, i) => `$${i + 3}`).join(', ')})
         ON CONFLICT (clase_id) DO UPDATE
            SET ${nombres.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}
         RETURNING ${LECTURA_CURSO}, (xmax = 0) AS nuevo`,
        [req.vinculo.institucionId, req.params.id, ...nombres.map((c) => datos[c])]);
      const { nuevo, ...curso } = rows[0];
      privado(res).status(nuevo ? 201 : 200).json({ curso });
    } catch (error) {
      const traducido = traducirError(error);
      if (traducido) return res.status(traducido[0]).json(traducido[1]);
      next(error);
    }
  });

  rutas.post('/clases/:id/curso/unidades', ...sobreLaClase, async (req, res, next) => {
    const { datos, campos } = validarLms('unidad', req.body);
    if (Object.keys(campos).length) return rechazar(res, campos);
    try {
      const curso = await cursoDeLaClase(req.params.id);
      if (!curso) return res.status(404).json({ error: NO_ENCONTRADO.curso });
      const nombres = listaDeColumnas('unidad', datos);
      const { rows } = await db.consultar(
        `INSERT INTO unidades (institucion_id, curso_id, ${nombres.join(', ')})
         VALUES ($1, $2, ${nombres.map((_, i) => `$${i + 3}`).join(', ')}) RETURNING ${LECTURA_UNIDAD}`,
        [req.vinculo.institucionId, curso.id, ...nombres.map((c) => datos[c])]);
      res.status(201).json({ unidad: rows[0] });
    } catch (error) {
      const traducido = traducirError(error);
      if (traducido) return res.status(traducido[0]).json(traducido[1]);
      next(error);
    }
  });

  rutas.put('/unidades/:id', ...conSesion, exigirRecurso('unidad'), async (req, res, next) => {
    const { datos, campos } = validarLms('unidad', req.body, { parcial: true });
    if (Object.keys(campos).length) return rechazar(res, campos);
    const nombres = listaDeColumnas('unidad', datos);
    if (!nombres.length) return rechazar(res, { _cuerpo: 'No hay nada que cambiar.' });
    try {
      const { rows } = await db.consultar(
        `UPDATE unidades SET ${nombres.map((c, i) => `${c} = $${i + 2}`).join(', ')}
          WHERE id = $1 RETURNING ${LECTURA_UNIDAD}`,
        [req.params.id, ...nombres.map((c) => datos[c])]);
      res.json({ unidad: rows[0] });
    } catch (error) {
      const traducido = traducirError(error);
      if (traducido) return res.status(traducido[0]).json(traducido[1]);
      next(error);
    }
  });

  rutas.post('/unidades/:id/contenidos', ...conSesion, exigirRecurso('unidad'), async (req, res, next) => {
    const { datos, campos } = validarLms('contenido', req.body);
    if (Object.keys(campos).length) return rechazar(res, campos);
    const nombres = listaDeColumnas('contenido', datos);
    try {
      const { rows } = await db.consultar(
        `INSERT INTO contenidos (institucion_id, unidad_id, ${nombres.join(', ')})
         VALUES ($1, $2, ${nombres.map((_, i) => `$${i + 3}`).join(', ')}) RETURNING ${LECTURA_CONTENIDO}`,
        [req.vinculo.institucionId, req.params.id, ...nombres.map((c) => datos[c])]);
      res.status(201).json({ contenido: rows[0] });
    } catch (error) {
      const traducido = traducirError(error);
      if (traducido) return res.status(traducido[0]).json(traducido[1]);
      next(error);
    }
  });

  rutas.put('/contenidos/:id', ...conSesion, exigirRecurso('contenido'), async (req, res, next) => {
    try {
      const { rows: [actual] } = await db.consultar(
        `SELECT ${LECTURA_CONTENIDO} FROM contenidos WHERE id = $1`, [req.params.id]);
      const { datos, campos } = validarLms('contenido', req.body, { parcial: true, actual });
      if (Object.keys(campos).length) return rechazar(res, campos);
      const nombres = listaDeColumnas('contenido', datos);
      if (!nombres.length) return rechazar(res, { _cuerpo: 'No hay nada que cambiar.' });
      const { rows } = await db.consultar(
        `UPDATE contenidos SET ${nombres.map((c, i) => `${c} = $${i + 2}`).join(', ')}
          WHERE id = $1 RETURNING ${LECTURA_CONTENIDO}`,
        [req.params.id, ...nombres.map((c) => datos[c])]);
      res.json({ contenido: rows[0] });
    } catch (error) {
      const traducido = traducirError(error);
      if (traducido) return res.status(traducido[0]).json(traducido[1]);
      next(error);
    }
  });

  rutas.post('/clases/:id/curso/tareas', ...sobreLaClase, async (req, res, next) => {
    const { datos, campos } = validarLms('tarea', req.body);
    if (Object.keys(campos).length) return rechazar(res, campos);
    try {
      const curso = await cursoDeLaClase(req.params.id);
      if (!curso) return res.status(404).json({ error: NO_ENCONTRADO.curso });
      const nombres = listaDeColumnas('tarea', datos);
      const { rows } = await db.consultar(
        `INSERT INTO tareas (institucion_id, curso_id, ${nombres.join(', ')})
         VALUES ($1, $2, ${nombres.map((_, i) => `$${i + 3}`).join(', ')}) RETURNING ${LECTURA_TAREA}`,
        [req.vinculo.institucionId, curso.id, ...nombres.map((c) => datos[c])]);
      res.status(201).json({ tarea: rows[0] });
    } catch (error) {
      const traducido = traducirError(error);
      if (traducido) return res.status(traducido[0]).json(traducido[1]);
      next(error);
    }
  });

  rutas.put('/tareas/:id', ...conSesion, exigirRecurso('tarea'), async (req, res, next) => {
    const { datos, campos } = validarLms('tarea', req.body, { parcial: true });
    if (Object.keys(campos).length) return rechazar(res, campos);
    const nombres = listaDeColumnas('tarea', datos);
    if (!nombres.length) return rechazar(res, { _cuerpo: 'No hay nada que cambiar.' });
    try {
      const { rows } = await db.consultar(
        `UPDATE tareas SET ${nombres.map((c, i) => `${c} = $${i + 2}`).join(', ')}
          WHERE id = $1 RETURNING ${LECTURA_TAREA}`,
        [req.params.id, ...nombres.map((c) => datos[c])]);
      res.json({ tarea: rows[0] });
    } catch (error) {
      const traducido = traducirError(error);
      if (traducido) return res.status(traducido[0]).json(traducido[1]);
      next(error);
    }
  });

  rutas.get('/tareas/:id/entregas', ...conSesion, exigirRecurso('tarea'), async (req, res, next) => {
    try {
      const { rows } = await db.consultar(
        `SELECT e.id, e.estudiante_id, e.estado, e.texto, e.url, e.nota,
                e.retroalimentacion, e.entregada_en, e.calificada_en,
                es.codigo_alumno, es.nombres, es.apellidos
           FROM estudiantes es
           JOIN clases c ON c.promocion_id = es.promocion_id
           LEFT JOIN entregas e ON e.estudiante_id = es.id AND e.tarea_id = $1
          WHERE c.id = $2
          ORDER BY es.apellidos, es.nombres`,
        [req.params.id, req.recurso.clase_id]);
      privado(res).json({ tareaId: req.params.id, entregas: rows });
    } catch (error) {
      next(error);
    }
  });

  rutas.get('/tareas/:id/entrega', ...conSesion, exigirRecurso('tarea', { escritura: false }), async (req, res, next) => {
    if (req.identidad.rol !== 'ESTUDIANTE') {
      return res.status(403).json({ error: 'Esta vista es la del estudiante.', codigo: 'NO_ES_SUYO' });
    }
    if (!req.recurso.publicada || !req.recurso.curso_publicado) {
      return res.status(404).json({ error: NO_ENCONTRADO.tarea });
    }
    try {
      const { rows } = await db.consultar(
        `SELECT ${LECTURA_ENTREGA} FROM entregas WHERE tarea_id = $1 AND estudiante_id = $2`,
        [req.params.id, req.vinculo.referenciaId]);
      if (!rows.length) return res.status(404).json({ error: NO_ENCONTRADO.entrega });
      privado(res).json({ entrega: rows[0] });
    } catch (error) {
      next(error);
    }
  });

  rutas.put('/tareas/:id/entrega', ...conSesion, exigirRecurso('tarea', { escritura: false }), async (req, res, next) => {
    if (req.identidad.rol !== 'ESTUDIANTE') {
      return res.status(403).json({ error: 'Solo el estudiante entrega su propia tarea.', codigo: 'NO_ES_SUYO' });
    }
    const { datos, campos } = validarLms('entrega', req.body);
    if (Object.keys(campos).length) return rechazar(res, campos);
    const { publicada, curso_publicado: cursoPublicado,
      fecha_entrega: vence, permite_atraso: atraso } = req.recurso;
    if (!publicada || !cursoPublicado) return res.status(404).json({ error: NO_ENCONTRADO.tarea });
    const entregada = datos.estado === 'ENTREGADA';
    if (entregada && !atraso && new Date() > new Date(vence)) {
      return res.status(409).json({ error: 'La fecha de entrega ya vencio.', codigo: 'FUERA_DE_PLAZO' });
    }
    try {
      const { rows } = await db.consultar(
        `INSERT INTO entregas (institucion_id, tarea_id, estudiante_id, texto, url, estado, entregada_en)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (tarea_id, estudiante_id) DO UPDATE
            SET texto = EXCLUDED.texto, url = EXCLUDED.url, estado = EXCLUDED.estado,
                entregada_en = EXCLUDED.entregada_en, nota = NULL, retroalimentacion = NULL,
                calificada_por = NULL, calificada_en = NULL, actualizada_en = CURRENT_TIMESTAMP
          WHERE entregas.estado <> 'CALIFICADA'
            AND NOT (EXCLUDED.estado = 'BORRADOR' AND entregas.estado <> 'BORRADOR')
         RETURNING ${LECTURA_ENTREGA}, (xmax = 0) AS nueva`,
        [req.vinculo.institucionId, req.params.id, req.vinculo.referenciaId,
          datos.texto ?? null, datos.url ?? null, datos.estado, entregada ? new Date().toISOString() : null]);
      if (!rows.length) {
        const { rows: [previa] } = await db.consultar(
          'SELECT estado FROM entregas WHERE tarea_id = $1 AND estudiante_id = $2',
          [req.params.id, req.vinculo.referenciaId]);
        if (previa && previa.estado === 'CALIFICADA') {
          return res.status(409).json({ error: 'La entrega ya fue calificada y no se puede cambiar.', codigo: 'YA_CALIFICADA' });
        }
        return res.status(409).json({
          error: 'Una entrega ya enviada no vuelve a borrador.', codigo: 'NO_REGRESA_A_BORRADOR' });
      }
      const { nueva, ...entrega } = rows[0];
      privado(res).status(nueva ? 201 : 200).json({ entrega });
    } catch (error) {
      const traducido = traducirError(error);
      if (traducido) return res.status(traducido[0]).json(traducido[1]);
      next(error);
    }
  });

  rutas.put('/entregas/:id/calificacion', ...conSesion, exigirRecurso('entrega'), async (req, res, next) => {
    const { datos, campos } = validarLms('calificacion', req.body);
    if (Object.keys(campos).length) return rechazar(res, campos);
    const maximo = Number(req.recurso.puntaje_maximo);
    if (typeof datos.nota === 'number' && datos.nota > maximo) {
      return rechazar(res, { nota: `No puede pasar del puntaje maximo de la tarea (${maximo}).` });
    }
    try {
      const { rows } = await db.consultar(
        `UPDATE entregas
            SET nota = $2, retroalimentacion = $3, estado = $4,
                calificada_por = $5, calificada_en = CURRENT_TIMESTAMP,
                actualizada_en = CURRENT_TIMESTAMP
          WHERE id = $1 AND estado <> 'BORRADOR'
         RETURNING ${LECTURA_ENTREGA}`,
        [req.params.id, datos.nota ?? null, datos.retroalimentacion ?? null, datos.estado,
          req.vinculo.usuarioLocalId]);
      if (!rows.length) {
        return res.status(409).json({ error: 'Esa entrega sigue en borrador: el estudiante no la ha entregado.', codigo: 'SIN_ENTREGAR' });
      }
      privado(res).json({ entrega: rows[0] });
    } catch (error) {
      next(error);
    }
  });

  rutas.get('/mis-tareas', ...conSesion, async (req, res, next) => {
    if (req.identidad.rol !== 'ESTUDIANTE') {
      return res.status(403).json({ error: 'Esta vista es la del estudiante.', codigo: 'NO_ES_SUYO' });
    }
    try {
      const { rows } = await db.consultar(
        `SELECT t.id, t.titulo, t.fecha_entrega, t.puntaje_maximo, t.permite_atraso,
                c.clase_id, cl.codigo_clase, m.nombre AS materia_nombre,
                COALESCE(e.estado, 'BORRADOR') AS estado, e.nota
           FROM estudiantes es
           JOIN clases cl ON cl.promocion_id = es.promocion_id AND cl.activa = TRUE
           JOIN cursos c ON c.clase_id = cl.id AND c.publicado = TRUE
           JOIN materias m ON m.id = cl.materia_id
           JOIN tareas t ON t.curso_id = c.id AND t.publicada = TRUE
           LEFT JOIN entregas e ON e.tarea_id = t.id AND e.estudiante_id = es.id
          WHERE es.id = $1 AND es.institucion_id = $2
          ORDER BY t.fecha_entrega`,
        [req.vinculo.referenciaId, req.vinculo.institucionId]);
      privado(res).json({ tareas: rows });
    } catch (error) {
      next(error);
    }
  });

  return rutas;
}

module.exports = { crearRutasLms };
