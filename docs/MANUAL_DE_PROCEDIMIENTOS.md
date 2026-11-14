# Manual de procedimientos y recursos

Cómo se instala, se prueba, se despliega y se opera la plataforma, y con qué herramientas.
Complementa al [plano](BLUEPRINT.md) (qué se construye) y al [ciclo](LOOP_DE_DESARROLLO.md) (cómo
se avanza).

## 1. Mapa del repositorio

| Ruta | Contenido |
|---|---|
| `public/` | Interfaz. **Lo único que el servidor publica.** |
| `public/js/app.js` | Vistas y lógica de la interfaz |
| `public/js/data.js` | Almacenamiento en el navegador (temporal, hasta SMS-05) |
| `src/config.js` | Lectura y validación de variables de entorno |
| `src/app.js` | Aplicación Express: seguridad, API, archivos estáticos |
| `src/server.js` | Arranque y apagado ordenado |
| `database/schema.sql` | Esquema de PostgreSQL |
| `tests/` | Pruebas: servidor, configuración y esquema |
| `scripts/verificar.sh` | Compuerta de calidad del ciclo |
| `scripts/buscar-secretos.js` | Detector de secretos en archivos versionados |
| `.github/workflows/ci.yml` | Verificación automática en cada solicitud de cambio |
| `docs/` | Plano, ciclo, backlog y este manual |
| `LECCIONES.md` | Errores, causas y reglas |

## 2. Recursos y herramientas

| Recurso | Versión | Uso |
|---|---|---|
| Node.js | 22 | Servidor, pruebas y cobertura |
| PostgreSQL | 16 | Base de datos; también para las pruebas del esquema |
| Docker + Compose | — | Empaquetado y despliegue |
| Express | 4.22 | Servidor web |
| helmet | 8.3 | Cabeceras de seguridad |
| express-rate-limit | 8.7 | Límite de peticiones |
| pg | 8.23 | Cliente de PostgreSQL |
| ESLint | 10.15 | Análisis estático |
| GitHub Actions | — | Integración continua |

Referencias externas usadas para decidir: OWASP Top 10 y OWASP Top 10 para aplicaciones con modelos
de lenguaje (seguridad), WCAG 2.1 nivel AA (accesibilidad), NIST AI RMF (riesgo de IA), y los
sitios y plataformas citados en la sección 12 del plano (diseño).

## 3. Preparar un equipo de desarrollo

```bash
git clone <url-del-repositorio> && cd plataforma-esoe
npm ci
cp .env.example .env
```

Completar `.env`. Para desarrollo basta con:

```bash
NODE_ENV=development
PORT=8080
```

Arrancar con recarga automática:

```bash
npm run dev
```

La interfaz queda en `http://localhost:8080`. También puede abrirse `public/index.html` directamente
en el navegador, sin servidor.

### Base de datos para las pruebas

Las pruebas del esquema crean una base desechable, la usan y la borran. Necesitan un usuario con
permiso para crear bases:

```bash
sudo -u postgres psql -c "CREATE ROLE esoe_pruebas LOGIN CREATEDB PASSWORD '<clave-generada>'"
```

Y en `.env`:

```bash
PRUEBAS_DATABASE_URL=postgresql://esoe_pruebas:<clave-generada>@127.0.0.1:5432/postgres
```

Sin esa variable las pruebas del esquema se omiten y `npm run verificar` lo avisa.

## 4. Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor con recarga |
| `npm start` | Servidor |
| `npm run lint` | Análisis estático |
| `npm test` | Todas las pruebas |
| `npm run test:cobertura` | Pruebas con umbral de cobertura (80 % líneas, 70 % ramas) |
| `npm run auditar` | Vulnerabilidades altas o críticas en dependencias |
| `npm run secretos` | Busca secretos en archivos versionados |
| `npm run verificar` | **Todo lo anterior más `.env` y Compose. Es la compuerta del ciclo.** |

## 5. Variables de entorno

| Variable | Obligatoria en producción | Descripción |
|---|---|---|
| `NODE_ENV` | Sí | `production` activa las validaciones estrictas |
| `PORT` | No (8080) | Puerto de escucha |
| `DB_PASSWORD` | Sí | Contraseña de PostgreSQL (la usa Compose) |
| `DATABASE_URL` | Sí | La arma Compose a partir de `DB_PASSWORD` |
| `JWT_SECRET` | Sí | Secreto de firma, 32 caracteres o más |
| `CORS_ORIGINS` | No | Orígenes externos permitidos, separados por coma. Vacío = ninguno |
| `TRUST_PROXY` | No (0) | Número de proxies delante de la aplicación |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | No | Ventana y máximo de peticiones a `/api` por IP |
| `PUERTO_PUBLICO` | No (8080) | Puerto del anfitrión en Compose |
| `PRUEBAS_DATABASE_URL` | No | Solo para pruebas |

Si `TRUST_PROXY` queda en 0 detrás de un proxy, el límite de peticiones contará a todos los usuarios
como una sola IP. Ajustarlo al número real de proxies.

## 6. Manejo de secretos

1. Los secretos viven solo en `.env`, que está en `.gitignore`.
2. Se generan, no se inventan: `openssl rand -hex 48`.
3. `.env.example` lleva los nombres de las variables, nunca valores.
4. Antes de cada entrega corre `npm run secretos` (incluido en `verificar`).
5. Si un secreto llega a un commit: **se cambia primero** en todos los sitios donde se use y
   después se limpia el historial. Borrarlo del archivo no basta.
6. Permisos del archivo: `chmod 600 .env`.

## 7. Despliegue

En un contenedor LXC (Debian 12 o Ubuntu 24.04) con Docker y Compose:

```bash
git clone <url-del-repositorio> /opt/plataforma-esoe && cd /opt/plataforma-esoe
cp .env.example .env && chmod 600 .env
```

Completar `DB_PASSWORD` y `JWT_SECRET` con valores generados. Luego:

```bash
docker compose up -d --build
```

Comprobar:

```bash
docker compose ps
```

```bash
curl -fsS http://127.0.0.1:8080/api/health
```

Compose se niega a arrancar si falta `DB_PASSWORD` o `JWT_SECRET`, y la aplicación se niega si son
cortos o de ejemplo. Es intencional.

Publicación: siempre detrás de un proxy inverso o túnel con HTTPS. La base de datos no expone
puerto fuera de la red de Compose.

**Actualizar:**

```bash
git pull && docker compose up -d --build
```

**Revertir:** volver al commit anterior y reconstruir.

```bash
git checkout <commit-anterior> && docker compose up -d --build
```

**Importante:** `database/schema.sql` solo se aplica la primera vez que se crea el volumen de datos.
Hasta que existan migraciones (SMS-01), un cambio de esquema sobre una base con datos se aplica a
mano y con respaldo previo.

### Respaldo manual

```bash
docker compose exec -T esoe-db pg_dump -U esoe_admin -Fc esoe_sms > respaldo-$(date +%F).dump
```

Restauración:

```bash
docker compose exec -T esoe-db pg_restore -U esoe_admin -d esoe_sms --clean < respaldo-AAAA-MM-DD.dump
```

El respaldo automático y cifrado es el elemento OPS-01 del backlog.

## 8. Respuesta a incidentes

Para cualquier incidente de seguridad, y en particular para los que involucren funciones con IA,
donde el fallo suele estar en el comportamiento del modelo y no en un control roto.

| Paso | Acciones |
|---|---|
| 1. Contener | Desactivar la función o la ruta afectada. Retirar al componente su acceso a datos y herramientas. **Guardar los registros antes de reiniciar nada.** Avisar al responsable |
| 2. Delimitar | Listar todo aquello a lo que el componente podía acceder: ese es el daño máximo. Tratar como expuesto todo dato alcanzable hasta que los registros demuestren lo contrario |
| 3. Revocar | Cambiar `JWT_SECRET`, `DB_PASSWORD` y toda clave de servicio externo. Invalidar las sesiones abiertas durante el incidente |
| 4. Restaurar | Reconstruir desde el repositorio, no desde el sistema en ejecución. Usar un respaldo anterior al inicio del incidente |
| 5. Validar | Repetir el ataque original contra la corrección. Volver a abrir de forma gradual, vigilando |
| 6. Documentar | Entrada en `LECCIONES.md`: cronología, qué permiso lo hizo posible y por qué existía. Añadir la prueba que lo detecta |

## 9. Auditoría de seguridad por dominios

Se recorre al cerrar cada fase y en todo cambio que toque sesión, permisos o datos personales. Los
hallazgos se ordenan por gravedad y entran al backlog con prefijo `SEC`.

| Dominio | Pregunta |
|---|---|
| Autenticación | ¿Se puede entrar sin credenciales válidas o adivinarlas por fuerza bruta? |
| Autorización | ¿Puede un rol leer o modificar lo que pertenece a otro? |
| Validación de entrada | ¿Toda entrada se valida en el servidor? |
| Inyección | ¿Hay SQL sin parametrizar o HTML sin escapar? |
| Datos sensibles | ¿Algún dato personal viaja, se guarda o se registra sin necesidad? |
| Secretos | ¿Hay alguno en el código, en el historial o con valor por defecto? |
| Sesión | ¿La cookie es `HttpOnly`, `Secure`, `SameSite`? ¿La sesión se puede revocar? |
| Configuración | ¿Cabeceras, CORS, mensajes de error, puertos expuestos? |
| Dependencias | ¿Vulnerabilidades conocidas? ¿Versiones fijadas? |
| Registro | ¿Queda rastro de las operaciones sensibles, sin datos personales? |
| Disponibilidad | ¿Límites de peticiones y tamaño? ¿Respaldo restaurable? |

### Estado tras la vuelta 1

| Gravedad | Hallazgo | Elemento |
|---|---|---|
| Crítica | No hay autenticación: cualquier credencial entra y el rol se elige en pantalla | SEC-05, SEC-06 |
| Alta | Datos del usuario insertados en HTML sin escapar | SEC-03 |
| Media | La política de contenido aún permite manejadores en línea | SEC-04 |
| Media | Fuentes cargadas desde un tercero | SEC-04 |
| Media | Sin respaldos automáticos | OPS-01 |
| Corregida | El servidor publicaba todo el repositorio | SEC-01 |
| Corregida | Secretos con valor por defecto | SEC-02 |

Los dos hallazgos más graves no ponen datos reales en riesgo **hoy** porque la aplicación todavía no
guarda nada en el servidor. Lo harán en cuanto se conecte la base de datos; por eso van primero.

## 10. Solución de problemas

| Síntoma | Causa | Solución |
|---|---|---|
| `Configuracion invalida: JWT_SECRET...` | Falta o es un valor de ejemplo | Generar uno y ponerlo en `.env` |
| Compose: `Defina DB_PASSWORD en .env` | Falta la variable | Completar `.env` |
| Las pruebas del esquema aparecen omitidas | Falta `PRUEBAS_DATABASE_URL` | Sección 3 |
| Todos los usuarios reciben 429 a la vez | `TRUST_PROXY` en 0 detrás de un proxy | Ajustarlo |
| Un recurso de la interfaz no carga y la consola menciona CSP | La política de contenido lo bloquea | Servirlo desde `public/`; no relajar la política sin registrarlo en el backlog |
| Cambié `schema.sql` y la base no cambió | Solo se aplica al crear el volumen | Sección 7 |
