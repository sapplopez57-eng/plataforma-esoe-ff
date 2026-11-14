'use strict';

const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { crearClienteMoodle, ErrorDeMoodle, ErrorDeRed } = require('./moodle');
const { PLATAFORMAS_CONOCIDAS, TIPOS_ADMITIDOS } = require('./catalogo');
const { normalizarUrlBase } = require('../seguridad/red');
const { crearCifrador } = require('../seguridad/cifrado');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function texto(valor, maximo) {
  if (typeof valor !== 'string') return '';
  const limpio = valor.trim();
  return limpio.length <= maximo ? limpio : '';
}

function crearRutasDeIntegraciones({ config, auth, db }) {
  const rutas = express.Router();
  const cifrador = crearCifrador(config.integraciones.claveCifrado);
  const moodle = crearClienteMoodle(config.integraciones);

  if (!db || !cifrador) {
    rutas.use((req, res) => {
      res.status(503).json({ error: 'Las conexiones con otras plataformas no estan configuradas en este servidor.' });
    });
    return rutas;
  }

  // Vincular una cuenta implica probar credenciales contra un tercero:
  // limite estricto para no servir de intermediario en ataques de fuerza bruta.
  const limiteDeVinculacion = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => req.identidad.usuarioId,
    message: { error: 'Demasiados intentos. Intente de nuevo mas tarde.' }
  });

  function responderError(res, error, siguiente) {
    if (error instanceof ErrorDeRed) return res.status(502).json({ error: error.message, codigo: error.codigo });
    if (error instanceof ErrorDeMoodle) {
      const estado = error.codigo === 'CREDENCIAL_RECHAZADA' ? 422 : 502;
      return res.status(estado).json({ error: error.message, codigo: error.codigo });
    }
    siguiente(error);
  }

  function validarId(req, res, next) {
    if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'Plataforma no encontrada.' });
    next();
  }

  async function buscarPlataforma(id) {
    const { rows } = await db.consultar(
      'SELECT id, nombre, tipo, url_base FROM plataformas_externas WHERE id = $1 AND activa', [id]);
    return rows[0] || null;
  }

  rutas.get('/catalogo', auth.exigirRol('ADMIN'), (req, res) => {
    res.json({ plataformas: PLATAFORMAS_CONOCIDAS });
  });

  rutas.get('/plataformas', auth.exigirSesion, async (req, res, next) => {
    try {
      const { rows } = await db.consultar(
        `SELECT p.id, p.nombre, p.tipo, p.url_base, c.nombre_remoto, c.vinculada_en
           FROM plataformas_externas p
           LEFT JOIN cuentas_externas c ON c.plataforma_id = p.id AND c.usuario_id = $1
          WHERE p.activa
          ORDER BY p.nombre`, [req.identidad.usuarioId]);
      res.json({
        plataformas: rows.map((f) => ({
          id: f.id,
          nombre: f.nombre,
          tipo: f.tipo,
          urlBase: f.url_base,
          vinculada: Boolean(f.vinculada_en),
          cuenta: f.nombre_remoto || null
        }))
      });
    } catch (error) {
      next(error);
    }
  });

  rutas.post('/plataformas', auth.exigirRol('ADMIN'), async (req, res, next) => {
    try {
      const cuerpo = req.body || {};
      const nombre = texto(cuerpo.nombre, 120);
      const tipo = texto(cuerpo.tipo, 20).toUpperCase();
      if (!nombre) return res.status(422).json({ error: 'Indique un nombre de hasta 120 caracteres.', campo: 'nombre' });
      if (!TIPOS_ADMITIDOS.includes(tipo)) return res.status(422).json({ error: 'Tipo de plataforma no admitido.', campo: 'tipo' });

      let urlBase;
      try {
        urlBase = normalizarUrlBase(cuerpo.urlBase, config.integraciones);
      } catch (error) {
        return res.status(422).json({ error: error.message, campo: 'urlBase' });
      }

      const sitio = await moodle.configuracionPublica(urlBase);
      if (!sitio.serviciosWeb || !sitio.servicioMovil) {
        return res.status(422).json({
          error: 'La plataforma existe pero no tiene habilitados los servicios web.', campo: 'urlBase'
        });
      }

      const { rows } = await db.consultar(
        `INSERT INTO plataformas_externas (nombre, tipo, url_base, creada_por)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (url_base) DO NOTHING
         RETURNING id, nombre, tipo, url_base`, [nombre, tipo, urlBase, req.identidad.usuarioId]);
      if (rows.length === 0) return res.status(409).json({ error: 'Esa plataforma ya esta registrada.' });

      const f = rows[0];
      res.status(201).json({
        plataforma: { id: f.id, nombre: f.nombre, tipo: f.tipo, urlBase: f.url_base, vinculada: false, cuenta: null },
        sitio: { nombre: sitio.nombre, enMantenimiento: sitio.enMantenimiento }
      });
    } catch (error) {
      responderError(res, error, next);
    }
  });

  rutas.post('/plataformas/:id/probar', auth.exigirRol('ADMIN'), validarId, async (req, res, next) => {
    try {
      const plataforma = await buscarPlataforma(req.params.id);
      if (!plataforma) return res.status(404).json({ error: 'Plataforma no encontrada.' });
      const sitio = await moodle.configuracionPublica(plataforma.url_base);
      res.json({
        disponible: sitio.serviciosWeb && sitio.servicioMovil && !sitio.enMantenimiento,
        sitio: { nombre: sitio.nombre, serviciosWeb: sitio.serviciosWeb, enMantenimiento: sitio.enMantenimiento }
      });
    } catch (error) {
      responderError(res, error, next);
    }
  });

  // Elimina la plataforma y, en cascada, todas las cuentas vinculadas a ella.
  rutas.delete('/plataformas/:id', auth.exigirRol('ADMIN'), validarId, async (req, res, next) => {
    try {
      const { rowCount } = await db.consultar('DELETE FROM plataformas_externas WHERE id = $1', [req.params.id]);
      if (rowCount === 0) return res.status(404).json({ error: 'Plataforma no encontrada.' });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  rutas.post('/plataformas/:id/cuenta', auth.exigirSesion, limiteDeVinculacion, validarId, async (req, res, next) => {
    try {
      const cuerpo = req.body || {};
      const usuario = texto(cuerpo.usuario, 150);
      const clave = typeof cuerpo.clave === 'string' && cuerpo.clave.length <= 300 ? cuerpo.clave : '';
      if (!usuario || !clave) return res.status(422).json({ error: 'Indique usuario y contrasena de esa plataforma.' });

      const plataforma = await buscarPlataforma(req.params.id);
      if (!plataforma) return res.status(404).json({ error: 'Plataforma no encontrada.' });

      const token = await moodle.obtenerToken(plataforma.url_base, usuario, clave);
      const info = await moodle.infoDelSitio(plataforma.url_base, token);

      await db.consultar(
        `INSERT INTO cuentas_externas (plataforma_id, usuario_id, token_cifrado, usuario_remoto_id, nombre_remoto)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (plataforma_id, usuario_id) DO UPDATE
           SET token_cifrado = EXCLUDED.token_cifrado,
               usuario_remoto_id = EXCLUDED.usuario_remoto_id,
               nombre_remoto = EXCLUDED.nombre_remoto,
               vinculada_en = CURRENT_TIMESTAMP`,
        [plataforma.id, req.identidad.usuarioId, cifrador.cifrar(token), info.usuarioId, info.nombreCompleto.slice(0, 150)]);

      res.status(201).json({ vinculada: true, cuenta: info.nombreCompleto });
    } catch (error) {
      responderError(res, error, next);
    }
  });

  rutas.delete('/plataformas/:id/cuenta', auth.exigirSesion, validarId, async (req, res, next) => {
    try {
      await db.consultar(
        'DELETE FROM cuentas_externas WHERE plataforma_id = $1 AND usuario_id = $2',
        [req.params.id, req.identidad.usuarioId]);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  // Cursos del usuario en todas sus plataformas vinculadas. Una plataforma caida
  // no impide ver las demas: se informa su estado y se sigue.
  rutas.get('/mis-cursos', auth.exigirSesion, async (req, res, next) => {
    try {
      const { rows } = await db.consultar(
        `SELECT p.id, p.nombre, p.url_base, c.token_cifrado, c.usuario_remoto_id
           FROM cuentas_externas c
           JOIN plataformas_externas p ON p.id = c.plataforma_id AND p.activa
          WHERE c.usuario_id = $1
          ORDER BY p.nombre`, [req.identidad.usuarioId]);

      const plataformas = await Promise.all(rows.map(async (f) => {
        const base = { id: f.id, nombre: f.nombre };
        try {
          const token = cifrador.descifrar(f.token_cifrado);
          const cursos = await moodle.cursosDelUsuario(f.url_base, token, f.usuario_remoto_id);
          return { ...base, estado: 'OK', cursos };
        } catch (error) {
          const vencida = error instanceof ErrorDeMoodle && error.codigo === 'CREDENCIAL_RECHAZADA';
          return { ...base, estado: vencida ? 'REVINCULAR' : 'NO_DISPONIBLE', cursos: [] };
        }
      }));
      res.set('Cache-Control', 'no-store');
      res.json({ plataformas });
    } catch (error) {
      next(error);
    }
  });

  return rutas;
}

module.exports = { crearRutasDeIntegraciones };
