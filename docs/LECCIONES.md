# Lecciones

## 2026-11-15 — Push 403 a oacoello/plataforma-esoe
- Error: `git push` devolvía 403 sobre `oacoello/plataforma-esoe`.
- Causa raíz: la aplicación de GitHub está instalada en `sapplopez57-eng` y `ARES-CORE`, no en la cuenta `oacoello`; solo el dueño de esa cuenta puede instalarla.
- Regla: escribir en el fork donde la app está instalada y abrir Pull Request hacia el repo destino.

## 2026-11-15 — Archivos del proyecto expuestos por el servidor estático
- Error: `express.static(__dirname)` publicaba `server.js`, `database/schema.sql` y cualquier `.env` futuro.
- Causa raíz: se servía la raíz del proyecto completa.
- Regla: servir solo directorios de cliente explícitos (`/css`, `/js`) y verificar con `curl` que `/.env` no devuelve el archivo.

## 2026-11-15 — Contraseñas por defecto en docker-compose
- Error: `${DB_PASSWORD:-esoe_secure_2026}` dejaba credenciales conocidas como valor de respaldo.
- Regla: variables obligatorias con `${VAR:?mensaje}`; sin valor por defecto.
