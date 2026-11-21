'use strict';

const { clerkMiddleware, getAuth, createClerkClient } = require('@clerk/express');

const ROLES = Object.freeze(['ADMIN', 'CATEDRATICO', 'ESTUDIANTE']);
const CABECERAS_DE_DIAGNOSTICO = ['x-clerk-auth-reason', 'x-clerk-auth-message', 'x-clerk-auth-status'];
const VIGENCIA_CACHE_MS = 60 * 1000;

function rolValido(valor) {
  return ROLES.includes(valor) ? valor : null;
}

function crearAutenticacion(config) {
  if (!config.clerk.habilitado) {
    const noDisponible = (req, res) => {
      res.status(503).json({ error: 'El inicio de sesion no esta configurado en este servidor.' });
    };
    return { habilitada: false, middleware: (req, res, next) => next(), exigirSesion: noDisponible, exigirRol: () => noDisponible };
  }

  const cliente = createClerkClient({
    secretKey: config.clerk.llaveSecreta,
    publishableKey: config.clerk.llavePublica,
    telemetry: { disabled: true }
  });

  const verificar = clerkMiddleware({
    clerkClient: cliente,
    publishableKey: config.clerk.llavePublica,
    secretKey: config.clerk.llaveSecreta,
    jwtKey: config.clerk.llaveJwt || undefined,
    authorizedParties: config.clerk.origenesAutorizados.length > 0 ? config.clerk.origenesAutorizados : undefined
  });

  const cacheDeRoles = new Map();

  async function rolDesdeClerk(usuarioId) {
    const guardado = cacheDeRoles.get(usuarioId);
    if (guardado && guardado.vence > Date.now()) return guardado.rol;
    try {
      const usuario = await cliente.users.getUser(usuarioId);
      const rol = rolValido(usuario.publicMetadata && usuario.publicMetadata.rol);
      cacheDeRoles.set(usuarioId, { rol, vence: Date.now() + VIGENCIA_CACHE_MS });
      return rol;
    } catch {
      return null;
    }
  }

  async function resolverRol(sesion) {
    const reclamos = sesion.sessionClaims || {};
    const enToken = rolValido(reclamos.metadata && reclamos.metadata.rol);
    if (enToken) return enToken;
    return rolDesdeClerk(sesion.userId);
  }

  function middleware(req, res, next) {
    verificar(req, res, (error) => {
      CABECERAS_DE_DIAGNOSTICO.forEach((cabecera) => res.removeHeader(cabecera));
      next(error);
    });
  }

  async function exigirSesion(req, res, next) {
    try {
      if (!/^Bearer \S+$/.test(req.get('authorization') || '')) {
        return res.status(401).json({ error: 'Debe iniciar sesion.' });
      }
      const sesion = getAuth(req);
      if (!sesion.isAuthenticated || !sesion.userId) {
        return res.status(401).json({ error: 'Debe iniciar sesion.' });
      }
      const rol = await resolverRol(sesion);
      if (!rol) {
        return res.status(403).json({ error: 'Su cuenta aun no tiene un rol asignado. Contacte a la administracion.' });
      }
      req.identidad = Object.freeze({ usuarioId: sesion.userId, rol });
      next();
    } catch (error) {
      next(error);
    }
  }

  function exigirRol(...rolesPermitidos) {
    return function guardianDeRol(req, res, next) {
      exigirSesion(req, res, (error) => {
        if (error) return next(error);
        if (!rolesPermitidos.includes(req.identidad.rol)) {
          return res.status(403).json({ error: 'No tiene permiso para esta accion.' });
        }
        next();
      });
    };
  }

  return { habilitada: true, middleware, exigirSesion, exigirRol, cliente };
}

module.exports = { crearAutenticacion, ROLES };
