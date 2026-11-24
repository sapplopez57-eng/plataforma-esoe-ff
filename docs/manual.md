# Manual de procedimientos

Guía de trabajo diario de la Plataforma ESOE: preparar el entorno, configurar las variables,
verificar un cambio, mantener el estilo del código y desplegar.

---

## 1. Preparar el entorno

```bash
npm ci
cp .env.example .env
```

Configure Clerk, PostgreSQL y el origen autorizado antes de continuar. Las órdenes de npm cargan
`.env` mediante Node, respetando las variables que ya estén presentes en el entorno.

```bash
npm run migrar
npm run dev
```

Requisitos: Node 22.9 o superior y, para las pruebas del esquema, un PostgreSQL 16 desechable.

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
| `DB_POOL_MAX` | Conexiones máximas a PostgreSQL por proceso (10 por defecto). No es el número de usuarios. |
| `DB_CONNECTION_TIMEOUT_MS` | Espera máxima para obtener conexión (3000 ms). |
| `DB_IDLE_TIMEOUT_MS` | Cierre de conexiones inactivas (30000 ms). |
| `DB_STATEMENT_TIMEOUT_MS` | Tiempo máximo de una sentencia en PostgreSQL (10000 ms). |
| `DB_SSL` | Cifrado hacia PostgreSQL: `desactivado`, `requerido` o `verificado`. Si no se define, se deduce: `verificado` con una base remota, administrada o con `sslmode=require`; `desactivado` con una base local o de red interna. |
| `DB_CA_CERT` | Autoridad certificadora propia en PEM, solo con `DB_SSL=verificado`. Admite saltos de línea escapados. |
| `RATE_LIMIT_PUBLIC_MAX` | Peticiones anónimas y del servicio de voz por IP y ventana (1200 por defecto). |

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
   corrección como `github-actions[bot]` con el mensaje «Retira comentarios del codigo». Después
   lanza `Verificacion` sobre esa corrección, porque un commit hecho con el token de Actions no la
   dispara por sí solo.
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

Si el entorno usa un proxy HTTPS con una autoridad de certificación propia, la construcción admite
el secreto opcional de BuildKit `proxy_ca`. El certificado se monta solo durante la instalación y
no queda en la imagen. Defina `CA_PROXY` con la ruta del certificado confiable del entorno:

```bash
docker build --secret id=proxy_ca,src="$CA_PROXY" -t esoe-sms:local .
```

La verificación TLS permanece activa. Sin proxy ni certificado adicional, la construcción habitual
no necesita este secreto.

## 7. Capacidad y crecimiento

El objetivo inicial es superar 300 cuentas con uso repartido. El pool comparte conexiones entre las
peticiones; no se abre una conexión por usuario. Los tiempos de adquisición y ejecución son finitos
y configurables. La carga inicial de la interfaz limita sus peticiones a cuatro simultáneas y conserva
el orden de los resultados y los errores de cada recurso.

La migración `0007` añade índices para las clases por docente o promoción, las calificaciones y
asistencias por estudiante y las cuentas externas por usuario. No cambia datos ni permisos.

Las cuentas verificadas por Clerk tienen cuotas independientes aunque compartan la IP de la escuela.
Los JWT inválidos, las peticiones anónimas y el servicio de voz conservan una cuota por IP. No se
aceptan identificadores de usuario enviados en cabeceras sin verificar. El proxy de publicación debe
proteger también contra tráfico volumétrico; configure `TRUST_PROXY` solo para los proxies reales.

Las cuotas de producción se comparten en PostgreSQL entre las réplicas. La suma de los pools debe
reservar conexiones para administración, migraciones y respaldo. El despliegue incluye preparación
separada de la base, un rol web limitado y comprobaciones de disponibilidad para el proxy.

Consulte [operación y recuperación](operacion.md) antes de adaptar el despliegue al clúster existente.
Las pruebas automatizadas utilizan bases desechables y no crean cuentas de clientes en Clerk.

## 8. Cuenta real para presentaciones

Las presentaciones usan Clerk y una institución con datos adecuados para mostrar a clientes. No hay
acceso local ni selector de rol. Las contraseñas se envían únicamente al proveedor para su creación o
validación; no se almacenan ni se hashean en el navegador ni en las tablas de la plataforma. No se
omiten las comprobaciones de contraseña de Clerk.

Configure de forma segura `CLERK_SECRET_KEY`, `DATABASE_URL`, `ESOE_ROOT_USUARIO`, `ESOE_ROOT_CLAVE` y
`ESOE_ROOT_INSTITUCION`; después ejecute `npm run crear-root`. La clave requiere al menos ocho caracteres
y debe cumplir la política del proveedor. El correo de esa cuenta es opcional si la instancia permite
usuario y contraseña sin correo. No se crea una dirección ficticia. Los demás usuarios siguen las
reglas de registro de Clerk.

El comando comprueba primero la institución en PostgreSQL, aprovisiona la cuenta en Clerk y registra
el vínculo local ADMIN. Se puede repetir para completar un aprovisionamiento interrumpido; hacerlo
renueva la contraseña de una cuenta existente. El rol ADMIN tiene acceso a su institución; estudiante
y catedrático conservan el alcance de sus expedientes y clases. La autoridad del rol procede de Clerk;
cambiar solo `usuarios.rol` no sustituye la asignación ni la renovación de la sesión del proveedor.

GitHub Pages solo publica archivos estáticos. El acceso institucional y los datos privados requieren
el servidor API con Clerk y PostgreSQL configurados. Sin él, la pantalla queda cerrada y explica que
el acceso no está disponible; no cambia a un modo de demostración local.

Al arrancar, el contenedor aplica las migraciones de `database/migraciones/` y luego inicia el
servidor; si la migración falla, el servidor no arranca. Publicar siempre detrás de un proxy con
HTTPS. La vista web estática se publica en GitHub Pages con `.github/workflows/pages.yml`.
