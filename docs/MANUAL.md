# Manual de procedimientos y recursos — Plataforma ESOE

## 1. Variables de entorno

Todo secreto vive en `.env` (ignorado por git, permisos `600`). La plantilla sin valores es `.env.example`.

| Variable | Uso |
|---|---|
| `DB_PASSWORD` | Contraseña de PostgreSQL. Obligatoria: compose falla si falta. |
| `JWT_SECRET` | Firma de sesiones. Obligatoria. |
| `CLERK_PUBLISHABLE_KEY` | Clave pública de Clerk (frontend). |
| `CLERK_SECRET_KEY` | Clave secreta de Clerk (solo backend, nunca en el cliente). |
| `CLERK_FRONTEND_API` | URL del dominio Clerk de la instancia. |
| `CLERK_API_URL` | API de Clerk. |
| `CLERK_JWT_KEY` | Clave PEM pública para validar JWT localmente. |

Generar secretos: `openssl rand -hex 32`.

## 2. Puesta en marcha

```bash
cp .env.example .env     # completar valores
docker compose up -d --build
curl http://localhost:8080/api/health
```

Sin Docker: `npm install && npm start`.

## 3. Superficie pública

`server.js` publica únicamente `/css`, `/js`, `/api/health` e `index.html`. Ni la raíz del proyecto, ni `.env`, ni `database/` son descargables. Si se agregan carpetas de recursos, se declaran explícitamente en `server.js`.

## 4. Publicación del código

- Repositorio de trabajo: `sapplopez57-eng/plataforma-esoe-ff`. Destino final: `oacoello/plataforma-esoe` mediante Pull Request.
- La aplicación de GitHub solo puede escribir en los repos donde está instalada. Para escribir en `oacoello/plataforma-esoe` el dueño de esa cuenta debe instalarla en https://github.com/settings/installations.
- Nunca se versionan `.env`, claves, tokens ni bundles de respaldo (`*.bundle` está en `.gitignore`).

## 5. Rotación de credenciales

Las claves Clerk actuales son de entorno `test`. Antes de producción: crear la instancia de producción en Clerk, reemplazar las tres claves en `.env` y reiniciar con `docker compose up -d`.

## 6. Registro de errores

Cada error con su causa raíz y la regla que lo evita se documenta en `docs/LECCIONES.md`.
