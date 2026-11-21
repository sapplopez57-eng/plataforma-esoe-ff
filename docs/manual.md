# Manual de procedimientos

Guía de trabajo diario de la Plataforma ESOE: preparar el entorno, configurar las variables,
verificar un cambio, mantener el estilo del código y desplegar.

---

## 1. Preparar el entorno

```bash
npm ci
cp .env.example .env
npm run dev
```

Requisitos: Node 22 o superior y, para las pruebas del esquema, un PostgreSQL 16 desechable.

---

## 2. Variables de entorno

El archivo `.env` nunca se versiona (`.gitignore` lo excluye y `npm run verificar` falla si aparece
en el repositorio). `.env.example` lista las variables sin valores.

| Variable | Uso |
| --- | --- |
| `NODE_ENV`, `PORT` | Modo y puerto del servidor (por defecto `production` y `8080`). |
| `DB_PASSWORD` | Contraseña del usuario `esoe_admin` de PostgreSQL. Generar con `openssl rand -hex 24`. |
| `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Panel de Clerk > API keys. |
| `CLERK_JWT_KEY` | Opcional. Llave pública PEM de la instancia (API keys > JWKS Public Key) en una sola línea con `\n`. Permite verificar sesiones sin consultar a Clerk en cada arranque. |
| `ORIGEN_PUBLICO` | URL pública de la plataforma, sin barra final. Solo se aceptan sesiones emitidas para ella. |
| `CLAVE_CIFRADO` | Clave con la que se cifran las llaves de Moodle e INFOP. Generar con `openssl rand -hex 32`. Si se pierde o cambia, los usuarios deben volver a vincular sus cuentas. |
| `INTEGRACIONES_RED_PRIVADA` | `true` solo si se conecta un Moodle de la red interna o por http. |
| `CORS_ORIGINS` | Orígenes externos autorizados a consumir la API, separados por coma. Vacío: ninguno. |
| `TRUST_PROXY` | Número de proxies inversos delante de la aplicación (`0`: ninguno). |
| `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX` | Ventana y máximo de peticiones por cliente. |
| `PRUEBAS_DATABASE_URL` | Solo para pruebas: PostgreSQL desechable con permiso `CREATEDB`. |

---

## 3. Verificar un cambio

Antes de entregar cualquier cambio:

```bash
npm run verificar
```

La compuerta revisa, en orden: base de pruebas disponible, `eslint`, pruebas con cobertura mínima
(80 % de líneas y 70 % de ramas en `src/`), dependencias sin vulnerabilidades altas, ausencia de
secretos versionados, estilo del código, `.env` fuera de git y `docker-compose.yml` válido. Si una
falla, el cambio no se entrega.

---

## 4. Estilo del código

El repositorio no lleva comentarios en el código ni términos ajenos al proyecto. La explicación de
cada parte vive en este manual y en el `README.md`, no dentro de los archivos.

| Comando | Qué hace |
| --- | --- |
| `npm run estilo` | Revisa los archivos versionados. Sale con 1 si encuentra comentarios o términos no permitidos. |
| `npm run estilo:corregir` | Retira los comentarios de JS, CSS, SQL, HTML/SVG, YAML, shell, Dockerfile, archivos de configuración y bloques de código de los `.md`, y vuelve a revisar. |

El revisor (`scripts/estilo.js`) lee cada lenguaje con su propio analizador: en JavaScript usa
`acorn`, de modo que una cadena, una plantilla o una expresión regular que contenga `//` o `/*` no se
toca. Los términos no permitidos se guardan como huellas SHA-256, no como texto, y en los reportes
aparecen enmascarados. Quedan fuera de la revisión de comentarios los archivos generados de
`public/vendor/` (conservan los avisos de licencia de terceros) y las licencias de `public/fonts/`.

### Revisor automático en GitHub

El flujo `.github/workflows/estilo.yml` corre en cada push a cualquier rama, en cada pull request,
cada lunes y a demanda desde la pestaña Actions:

1. Retira los comentarios que encuentre. Si cambió algo, corre `eslint` y las pruebas, y sube la
   corrección como `github-actions[bot]` con el mensaje «Retira comentarios del codigo».
2. Revisa archivos, mensajes y autores de los commits nuevos, y el nombre de la rama. Si encuentra un
   término no permitido, la ejecución falla y señala
   dónde está.

En pull requests que vienen de otro repositorio solo revisa: no tiene permiso para subir cambios.

Los términos de un commit ya publicado no se corrigen solos: hay que reescribir ese commit.

---

## 5. Regenerar archivos derivados

| Comando | Resultado |
| --- | --- |
| `npm run localizacion` | Regenera `public/js/clerk-es.js` desde `@clerk/localizations`. |
| `npm run construir:campus` | Empaqueta `interfaz/campus3d/` en `public/vendor/campus3d.js`. |
| `npm run migrar` | Lleva la base de `DATABASE_URL` a la última versión del esquema. |
| `npm run crear-root` | Crea o actualiza la cuenta root con los datos `ESOE_ROOT_*` de `.env`. |

---

## 6. Desplegar

```bash
docker compose up -d --build
```

Al arrancar, el contenedor aplica las migraciones de `database/migraciones/` y luego inicia el
servidor; si la migración falla, el servidor no arranca. Publicar siempre detrás de un proxy con
HTTPS. La vista web estática se publica en GitHub Pages con `.github/workflows/pages.yml`.
