# Reporte de seguridad — plataforma-esoe — 2026-11-16

Auditoría de solo lectura sobre la rama `configuracion-inicial` (77 archivos versionados, 27
commits). Stack: Node 22, Express 4, PostgreSQL 16, Clerk; interfaz estática con Three.js empaquetado.

## Resumen

- Critical: 0 · High: 2 · Medium: 1 · Low: 1
- **Secretos:** ningún valor de `.env` (llaves de Clerk, contraseña de la base, llave de cifrado,
  contraseña de la cuenta root) aparece en los archivos ni en ninguna versión del historial.
  `.env` está ignorado.

## Critical

Sin hallazgos.

## High

### [Contenedores] La imagen no se puede construir: `.dockerignore` excluye `scripts`

- Archivo/línea: `.dockerignore:8` (`scripts`) frente a `Dockerfile:12` (`COPY scripts/migrar.js`).
- Impacto: lo que `.dockerignore` excluye no llega al contexto de construcción; el `COPY` falla y no
  hay imagen que desplegar. El migrador, que corre antes del servidor, tampoco estaría.
- Recomendación: mantener la exclusión y reincluir solo el migrador con `!scripts/migrar.js`.

### [Historial] Referencias a herramientas de desarrollo en archivos y en versiones anteriores

- Archivo/línea: `.gitignore:22`, `docs/MANUAL_DE_PROCEDIMIENTOS.md:535`, `LECCIONES.md:311` y
  `LECCIONES.md:316`. En el historial, versiones anteriores de `styles.css`, `index.html`,
  `docs/BACKLOG.md`, `docs/MANUAL_DE_PROCEDIMIENTOS.md` y `LECCIONES.md` contienen nombres de
  herramientas de asistencia que la política del proyecto prohíbe.
- Impacto: incumple la política del proyecto de no dejar indicios de las herramientas usadas para
  construirlo; cualquiera con acceso al repositorio puede leerlos en el historial.
- Recomendación: reescribir esas líneas en los archivos actuales; mover la exclusión local de
  herramientas a `.git/info/exclude`, que no se versiona; y limpiar el historial reemplazando esas
  cadenas en todos los commits, con publicación forzada de la rama.

## Medium

### [Autenticación] Cuenta root con contraseña corta y sin segundo factor

- Archivo/línea: cuenta `ares` (rol ADMIN) en la instancia de desarrollo de Clerk; creada por
  `scripts/crear-root.js` con la validación de contraseñas de Clerk desactivada para aceptarla.
- Impacto: es la cuenta de mayor rango; una contraseña corta es más fácil de adivinar o de probar
  contra listas filtradas.
- Recomendación: antes de producción, cambiar `ESOE_ROOT_CLAVE` por una de 16 caracteres o más,
  ejecutar `npm run crear-root` y activar la verificación en dos pasos para esa cuenta en Clerk.

## Low

### [Supply chain] Biblioteca de terceros servida desde el propio repositorio

- Archivo/línea: `public/vendor/campus3d.js` (Three.js 0.187.0 empaquetado).
- Impacto: un archivo compilado es difícil de revisar a mano.
- Recomendación: ya mitigado. La versión está fijada exacta en `package.json` y
  `tests/campus3d.test.js` recompila la fuente y falla si el archivo servido difiere. Mantener la
  prueba en la compuerta.

## Dominios sin hallazgos

| Dominio | Qué se comprobó |
|---|---|
| Código (SAST) | consultas parametrizadas; ninguna ruta de archivo tomada del usuario |
| Autenticación y permisos | rol desde el servidor; permisos por pertenencia con guardián de rutas probado |
| Criptografía | credenciales de terceros con AES-256-GCM; contraseñas de terceros no se guardan |
| Secretos | ningún valor de `.env` en archivos ni historial; `.env` ignorado; análisis en la compuerta |
| Dependencias | `npm audit`: 0 vulnerabilidades (producción y desarrollo) |
| Web (OWASP) | helmet con CSP sin `unsafe-inline` para scripts, CORS acotado, límite de peticiones en `/api`, `x-powered-by` desactivado, escape de toda salida con guardián |
| CI/CD | permisos explícitos en `.github/workflows/ci.yml` |
| Contenedores | imagen base fijada por digest, proceso como usuario `node`, HEALTHCHECK, `.env` fuera del contexto |
| Manejo de errores | sin trazas expuestas al cliente ni `catch` vacíos en `src/` |
| Logging | ningún secreto ni contraseña en los mensajes; el script de la cuenta root no imprime la contraseña |
