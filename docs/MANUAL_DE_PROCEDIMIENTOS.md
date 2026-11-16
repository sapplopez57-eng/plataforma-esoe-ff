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
| `src/auth.js` | Verificación de sesiones de Clerk y control por rol |
| `src/db.js` | Conexión a PostgreSQL |
| `src/integraciones/` | Conexión con Moodle e INFOP: cliente, catálogo y rutas |
| `src/seguridad/` | Cifrado de credenciales y peticiones salientes protegidas |
| `public/js/sesion.js` | Inicio de sesión en el navegador y llamadas a la API |
| `public/js/integraciones.js` | Vista «Otras plataformas» |
| `public/js/clerk-es.js` | Traducción del formulario de acceso (generada, no se edita) |
| `scripts/asignar-rol.js` | Asigna el rol de un usuario |
| `src/server.js` | Arranque y apagado ordenado |
| `database/migraciones/` | Esquema de PostgreSQL, en pasos numerados (`0001_...sql`, `0002_...sql`) |
| `src/migraciones.js`, `scripts/migrar.js` | Aplican las migraciones pendientes (`npm run migrar`) |
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
| Clerk | `@clerk/express` 2.1 · ClerkJS 6 | Inicio de sesión y gestión de cuentas |
| helmet | 8.3 | Cabeceras de seguridad |
| express-rate-limit | 8.7 | Límite de peticiones |
| pg | 8.23 | Cliente de PostgreSQL |
| ESLint | 10.15 | Análisis estático |
| GitHub Actions | — | Integración continua |

Referencias externas usadas para decidir: OWASP Top 10 y OWASP Top 10 para aplicaciones con modelos
de lenguaje (seguridad), WCAG 2.1 nivel AA (accesibilidad), NIST AI RMF (riesgo de IA), y los
sitios y plataformas citados en la sección 12 del plano (diseño). Para las integraciones: la
documentación de Clerk para Express y JavaScript, y la de servicios web de Moodle.

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
| `npm run localizacion` | Regenera la traducción del formulario de acceso |
| `npm run verificar` | **Todo lo anterior más `.env` y Compose. Es la compuerta del ciclo.** |

## 5. Variables de entorno

| Variable | Obligatoria en producción | Descripción |
|---|---|---|
| `NODE_ENV` | Sí | `production` activa las validaciones estrictas |
| `PORT` | No (8080) | Puerto de escucha |
| `DB_PASSWORD` | Sí | Contraseña de PostgreSQL (la usa Compose) |
| `DATABASE_URL` | Sí | La arma Compose a partir de `DB_PASSWORD` |
| `CLERK_PUBLISHABLE_KEY` | Sí | Llave pública de Clerk (`pk_...`) |
| `CLERK_SECRET_KEY` | Sí | Llave secreta de Clerk (`sk_...`) |
| `CLERK_JWT_KEY` | No | Llave pública PEM de la instancia; evita consultar a Clerk para verificar |
| `ORIGEN_PUBLICO` | Sí | URL pública de la plataforma; solo se aceptan sesiones emitidas para ella |
| `CLAVE_CIFRADO` | Sí | 64 caracteres hexadecimales; cifra las llaves de plataformas externas |
| `INTEGRACIONES_RED_PRIVADA` | No (`false`) | `true` para conectar un Moodle de la red interna o por http |
| `CORS_ORIGINS` | No | Orígenes externos permitidos, separados por coma. Vacío = ninguno |
| `TRUST_PROXY` | No (0) | Número de proxies delante de la aplicación |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | No | Ventana y máximo de peticiones a `/api` por IP |
| `PUERTO_PUBLICO` | No (8080) | Puerto del anfitrión en Compose |
| `PRUEBAS_DATABASE_URL` | No | Solo para pruebas |

Si `TRUST_PROXY` queda en 0 detrás de un proxy, el límite de peticiones contará a todos los usuarios
como una sola IP. Ajustarlo al número real de proxies.

## 6. Manejo de secretos

1. Los secretos viven solo en `.env`, que está en `.gitignore`.
2. Se generan, no se inventan: `openssl rand -hex 32`. Las de Clerk se copian de su panel.
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

Completar `DB_PASSWORD` y `CLAVE_CIFRADO` con valores generados, las dos llaves de Clerk y
`ORIGEN_PUBLICO` (sección 11). Luego:

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

Compose se niega a arrancar si falta cualquiera de esas variables, y la aplicación se niega si
están mal formadas o son de ejemplo. Es intencional.

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

**Esquema:** el contenedor aplica las migraciones pendientes antes de arrancar el servidor; si una
falla, el servidor no arranca sobre una base a medio actualizar. Antes de desplegar una versión con
migraciones nuevas, haga el respaldo de abajo: una migración se puede deshacer restaurándolo, no
volviendo a una versión anterior del código.

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
| 3. Revocar | Cambiar `CLERK_SECRET_KEY` (panel de Clerk), `DB_PASSWORD` y `CLAVE_CIFRADO`. Cerrar las sesiones desde el panel de Clerk. Cambiar `CLAVE_CIFRADO` inutiliza las llaves guardadas: cada usuario vuelve a vincular sus cuentas externas |
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

### Estado tras la vuelta 3

| Gravedad | Hallazgo | Elemento |
|---|---|---|
| Alta | Clerk no se ha probado con las llaves reales de la instancia | OPS-03 |
| Alta | Los datos de gestión escolar siguen en el navegador y sin permisos por pertenencia | SEC-06, SMS-05 |
| Corregida | No había autenticación: cualquier credencial entraba y el rol se elegía en pantalla | SEC-05 |
| Alta | Datos del usuario insertados en HTML sin escapar | SEC-03 |
| Media | La política de contenido aún permite manejadores en línea | SEC-04 |
| Media | Fuentes cargadas desde un tercero | SEC-04 |
| Media | Sin respaldos automáticos | OPS-01 |
| Corregida | El servidor publicaba todo el repositorio | SEC-01 |
| Corregida | Secretos con valor por defecto | SEC-02 |

La auditoría de las vueltas 2 y 3 recorrió los once dominios sobre el código nuevo. Lo único que
el servidor guarda hoy son las plataformas registradas y las llaves cifradas de las cuentas
vinculadas; expedientes, notas y asistencia todavía no salen del navegador.

## 10. Solución de problemas

| Síntoma | Causa | Solución |
|---|---|---|
| `Configuracion invalida: ...` | Falta una variable o está mal formada | El mensaje dice cuál; completar `.env` |
| Compose: `Defina ... en .env` | Falta la variable | Completar `.env` |
| «Su cuenta todavía no tiene un rol asignado» | Cuenta nueva sin rol | Sección 11 |
| Todas las sesiones dan 401 | `ORIGEN_PUBLICO` no coincide con la URL real | Corregirlo; sin barra final |
| `fetch failed` al hablar con Clerk desde un entorno de desarrollo remoto | La red del contenedor filtra los hosts salientes | Permitir `api.clerk.com` y el dominio de la instancia, y arrancar Node con `NODE_USE_ENV_PROXY=1`. En un servidor propio no aplica: la salida es directa |
| El acceso no carga y la consola menciona CSP | Clerk usa un dominio no previsto | Anotar el dominio bloqueado y agregarlo en `src/app.js`; registrar el cambio |
| «La plataforma apunta a una red interna» | Moodle en la LAN | `INTEGRACIONES_RED_PRIVADA=true` |
| Estado «Volver a vincular» en una plataforma | La llave fue revocada o cambió la contraseña | El usuario vincula de nuevo |
| Las pruebas del esquema aparecen omitidas | Falta `PRUEBAS_DATABASE_URL` | Sección 3 |
| Todos los usuarios reciben 429 a la vez | `TRUST_PROXY` en 0 detrás de un proxy | Ajustarlo |
| Un recurso de la interfaz no carga y la consola menciona CSP | La política de contenido lo bloquea | Servirlo desde `public/`; no relajar la política sin registrarlo en el backlog |
| `npm run migrar` dice `MIGRACION_ALTERADA` | Se editó una migración ya aplicada | Deshacer la edición y escribir una migración nueva |
| `npm run migrar` dice `ESQUEMA_PARCIAL` | La base tiene parte del esquema inicial | Revisarla a mano; no se adopta sola |
| `npm run migrar` dice `BASE_MAS_NUEVA` | La base viene de un código más reciente | Actualizar el código antes de migrar |

## 11. Inicio de sesión con Clerk

### Configurar la instancia (una vez)

> **No ejecutar `npx clerk init` en este proyecto.** La integración con Clerk ya está hecha
> (`@clerk/express` en el servidor, ClerkJS en el navegador). `init` está pensado para proyectos
> sin Clerk y puede crear otra aplicación y sobrescribir las llaves. La guía del panel asume
> Next.js; aquí el servidor es Express y la interfaz es propia, así que esa plantilla no aplica.
>
> El CLI de Clerk tampoco puede iniciar sesión desde un entorno de desarrollo remoto: espera que el
> navegador responda a `127.0.0.1` en la misma máquina. Las llaves se copian a mano.

1. En el panel de Clerk, abrir la aplicación y, en **API keys**, copiar a `.env`:
   `CLERK_PUBLISHABLE_KEY` (empieza con `pk_`) y `CLERK_SECRET_KEY` (empieza con `sk_`).
   La llave secreta no se comparte ni se versiona: vive solo en `.env`.
2. Definir `ORIGEN_PUBLICO` con la URL pública de la plataforma.
3. En **Sessions → Customize session token**, agregar:
   ```json
   { "metadata": "{{user.public_metadata}}" }
   ```
   Con esto el rol viaja dentro de la sesión. Sin este paso todo funciona igual, pero el servidor
   consulta a Clerk el rol de cada usuario (con un minuto de memoria).
4. Recomendado: en **User & authentication**, desactivar el registro abierto o limitarlo al dominio
   de correo de la institución, y exigir segundo factor al personal administrativo.

### Dar acceso a una persona

1. La persona se registra en la pantalla de acceso. Queda sin rol y no puede entrar a nada.
2. La administración le asigna el rol:
   ```bash
   node scripts/asignar-rol.js persona@ejemplo.hn ESTUDIANTE
   ```
   Roles: `ADMIN`, `CATEDRATICO`, `ESTUDIANTE`. También puede hacerse en el panel de Clerk, en los
   metadatos públicos del usuario: `{"rol": "ESTUDIANTE"}`.
3. El cambio aplica cuando la persona renueva su sesión (como mucho un minuto, o al volver a entrar).

Para **quitar** el acceso: borrar el rol o bloquear al usuario en el panel de Clerk.

El primer administrador se crea igual: registrarse y ejecutar el comando con `ADMIN`.

### Qué se guarda dónde

| Dato | Lugar |
|---|---|
| Correo, nombre, contraseña, segundo factor | Clerk |
| Rol | Clerk (metadatos públicos) |
| Expedientes, notas, asistencia | Base de datos propia (hoy, aún en el navegador) |
| Llaves de plataformas externas | Base de datos propia, cifradas |

### Cuenta root

La cuenta de mayor rango (rol ADMIN, marcada `root`) se crea o actualiza con:

```bash
npm run crear-root
```

Lee de `.env`, que no se versiona: `ESOE_ROOT_USUARIO`, `ESOE_ROOT_NOMBRE`, `ESOE_ROOT_CORREO` y
`ESOE_ROOT_CLAVE`. La contraseña nunca va en la línea de comandos, el código ni los mensajes; el
script tampoco la imprime. Si la cuenta ya existe, renueva su contraseña y su rol. La instancia de
Clerk exige correo en cada cuenta; en la instancia de desarrollo sirve una dirección de prueba
`+clerk_test`. Detrás de un proxy, Node necesita `NODE_USE_ENV_PROXY=1` para salir a Clerk.

Se recomienda cambiar la contraseña root por una larga y única antes de pasar a producción, y
activar la verificación en dos pasos en Clerk para esa cuenta.

## 12. Conexión con otras plataformas (Moodle, INFOP)

### Registrar una plataforma (administración)

Menú **Otras plataformas**. Las de INFOP aparecen como sugeridas y se agregan con un clic. Para
cualquier otro Moodle: **Agregar plataforma**, nombre y dirección `https://`. El sistema comprueba
que es un Moodle con servicios web antes de guardarla.

Un Moodle propio en la red interna requiere `INTEGRACIONES_RED_PRIVADA=true`. Esa opción desactiva
la protección que impide al servidor conectarse a direcciones internas, así que solo debe activarse
si hace falta.

### Vincular una cuenta (cualquier usuario)

**Vincular mi cuenta** en la plataforma deseada, con el usuario y la contraseña que la persona usa
allí. La contraseña se usa una vez para pedir una llave de acceso y se descarta. Desde ese momento
la persona ve sus cursos, su avance y su calificación. **Desvincular** borra la llave.

No funciona con plataformas que solo permiten entrar con una cuenta externa (Google, Microsoft):
ese caso se informa como credenciales rechazadas.

### Operación

| Situación | Qué hacer |
|---|---|
| INFOP en mantenimiento | Nada: la vista muestra «no responde» y se recupera sola |
| Se cambió `CLAVE_CIFRADO` | Las llaves guardadas ya no sirven; los usuarios vinculan de nuevo |
| Se elimina una plataforma | Se borran también las cuentas vinculadas a ella |
| Sospecha de fuga de la base de datos | Las llaves están cifradas; aun así, cambiar `CLAVE_CIFRADO` y pedir a los usuarios que cambien su contraseña en la plataforma externa |

## 13. Permisos: rol y pertenencia

El rol dice **qué clase de cosas** puede hacer una cuenta. La pertenencia dice **sobre cuáles**. Las
dos se comprueban en el servidor; la interfaz no decide ninguna.

### Cómo se liga una cuenta con su expediente

| Dónde vive | Qué guarda |
|---|---|
| Clerk (proveedor) | la identidad y el rol, en `publicMetadata.rol` |
| `usuarios.proveedor_id` | liga la cuenta del proveedor con la fila local |
| `usuarios.referencia_id` | el expediente: `estudiantes.id` o `catedraticos.id` |
| `usuarios.activo` | si está en `false`, la cuenta entra pero no consulta nada |

Una cuenta sin fila en `usuarios` puede iniciar sesión y no es dueña de nada: toda consulta con
pertenencia responde 403 con código `SIN_EXPEDIENTE`. Es el estado de una cuenta recién creada,
antes de que la administración la ligue a un expediente.

Para ligar una cuenta nueva:

```sql
INSERT INTO usuarios (username, proveedor_id, rol, nombre_completo, referencia_id)
VALUES ('apellido.nombre', '<id de Clerk>', 'ESTUDIANTE', 'Nombre Completo', '<id del expediente>');
```

El `id` de Clerk se ve en su panel, o en la respuesta de `GET /api/sesion` de esa persona.

### Quién alcanza qué

| Consulta | ADMIN | CATEDRATICO | ESTUDIANTE |
|---|---|---|---|
| `GET /api/clases` | todas | las que imparte | las de su promoción |
| `GET /api/clases/:id/asistencia` | sí | solo si la imparte | no |
| `GET /api/estudiantes/:id/boletin` | sí | solo si le da clase | solo el propio |

Un 403 por pertenencia devuelve siempre el mismo cuerpo (`codigo: NO_ES_SUYO`) exista o no el
recurso: de otro modo la respuesta diría qué clases o expedientes existen a quien no debería saberlo.

### Al agregar una ruta

1. Se monta con `auth.exigirSesion` (o `auth.exigirRol`) y, si toca un recurso de alguien,
   con el guardián de pertenencia de `src/permisos.js`.
2. Todo guardián lleva nombre y empieza por `exigirSesion` o `guardianDe`. Una prueba recorre las
   rutas registradas y falla si alguna queda sin uno, así que un guardián anónimo se lee como
   ausente.
3. Si la ruta debe ser pública, se agrega a `PUBLICAS` en `tests/permisos.test.js`. Es una decisión
   consciente que queda escrita.

## 14. Identidad visual

Todo color y todo tamaño de letra salen de las variables de `:root` en `public/css/styles.css`. Fuera
de ahí no se escribe ninguno: ni en la hoja, ni en estilos en línea de `index.html` o de `public/js/`.
`tests/identidad.test.js` lo comprueba y falla nombrando el archivo.

Las variables se nombran por **función**, no por color: si la paleta cambia, cambian los valores y
ningún otro archivo (así se hizo el paso de olivo a azul y naranja sin tocar `app.js`).

| Variable | Valor | Uso |
|---|---|---|
| `--marca-1` … `--marca-5` | los cinco del README | la paleta tal cual; la prueba los compara |
| `--accion` / `--accion-hondo` | cielo / cian | botón primario, menú activo |
| `--positivo` | cian | Aprobado, Presente |
| `--negativo` / `--negativo-hondo` | naranja / ámbar | Reprobado, Ausente, acciones de cierre |
| `--advertencia` | ámbar | Tardanza |
| `--sobre-accion` | `#0F2A33` | texto encima de cualquier relleno de color: ninguno aguanta blanco |
| `--enlace` | `#026F8A` | enlaces, botones de contorno y foco sobre fondo claro |
| `--decoracion`, `--decoracion-viva` | azul profundo, cielo | bordes, cifras, iconos, adornos |
| `--estructura`, `--sobre-estructura` | `#0A2A35`, `#E6F6FA` | menú lateral, panel de acceso |
| `--texto`, `--titulo`, `--piedra` | `#0F2A33`, `#0A2029`, `#41606B` | texto, títulos, texto secundario |
| `--papel`, `--superficie`, `--linea` | `#F6FAFB`, `#E6F3F6`, `#CFE4EA` | fondo, superficies, bordes |

Escala de letra: `--fs-meta` 12 · `--fs-sm` 14 · `--fs-base` **16** · `--fs-md` 18 · `--fs-lg` 24 ·
`--fs-xl` 28 · `--fs-2xl` 40 · `--fs-display` 56. Los 12 px se reservan a rótulos en mayúsculas con
espaciado. Los campos de formulario van en 16 px también porque un teléfono amplía la página al
escribir en uno más pequeño.

### Al cambiar un color

1. Se cambia la variable en `:root`, nunca el valor en el sitio donde se usa.
2. Si el color lleva texto encima, se agrega el par a la lista de contraste de
   `tests/identidad.test.js`. La prueba exige 4.5:1.
3. Si se **renombra** una variable, se buscan sus usos también en `public/js/` y en `index.html`:
   una variable que no existe no da ningún error, el estilo simplemente desaparece. La prueba lo
   detecta, pero conviene no depender de ella.

### Íconos

Los íconos de `public/js/icons.js` dibujan con `currentColor` y marcan su relleno de acento con
`class="acento"`. El color del acento lo decide la hoja (`.acento`), y sobre fondos de color pasa a
beige para no perderse.

### Accesibilidad mínima de la estructura

Comparada con Harvard y Canvas (medición con REA y el navegador, 2026-11-16), la interfaz debe
conservar: `<main>`, idioma declarado, **toda navegación con nombre** (`aria-label`), un enlace
**"Saltar al contenido"** como primer elemento enfocable de la aplicación, y un solo `h1` visible por
pantalla, con los títulos en orden. Desde la vuelta 11 eso vale también para la pantalla de acceso:
`<header>` institucional y `<main>` con nombre; `mostrarPantalla()` (en `public/js/lectura.js`) deja
visible un solo `<main>` al pasar del acceso a la aplicación y de vuelta.

### Tamaño del texto

La escala `--fs-*` está en `rem`: sigue el tamaño de letra del navegador de cada persona. El control
«Tamaño del texto» (en el acceso y en la barra superior) pone `data-texto="grande"` (112,5 %) o
`"muy-grande"` (125 %) en `<html>` y lo recuerda en ese navegador. Si el navegador no deja guardar,
el control funciona igual, solo que no se recuerda. Un tamaño nuevo necesita su regla
`html[data-texto="..."]`; `tests/estructura.test.js` falla si falta.

### Ambiente (vuelta 12)

Tomado de rahulsmoothy.com (medido con REA y Craft): **la ambientación, no los colores**. Todo sale de
la paleta de la ESOE.

| Pieza | Dónde | Cómo se cambia |
|---|---|---|
| Plano ilustrativo del campus | `public/img/campus-esoe.svg` | Es un dibujo isométrico generado; se reemplaza el SVG. Los puntos numerados están en `index.html` (`.escena-puntos`), en porcentaje del plano |
| Niebla | máscara de `.escena` en `styles.css` | Funde la escena con `--papel`; en modo noche funde con el papel oscuro sin tocar nada |
| Nubes y puntos que flotan | `@keyframes deriva` y `flotar` | Se apagan con «reducir movimiento» |
| Barra de ambiente | `.barra-ambiente` en el acceso; botones `.ambiente-btn` en la barra superior | Plano (muestra u oculta los puntos), Sonido, Noche y tamaño del texto |
| Sonido | `public/js/ambiente.js` | Sintetizado con Web Audio: acorde lento y rumor de mar. No descarga nada y **no suena solo**; si el navegador no tiene Web Audio, el botón se oculta |
| Modo noche | `html[data-noche]` y `html[data-noche] .app-shell` | Solo redefine variables (`--noche-*` en `:root`); se recuerda en el navegador |
| Reloj | `[data-reloj]` | Hora local, cada 15 s |
| Presentación | `#intro` en `index.html`; `public/video/escudo-esoe.{webm,mp4,jpg}` | El video del escudo hecho con Remotion (composición `EscudoESOE`), recodificado a 720 px y 30 fps sin audio (92 KB en WebM, 220 KB en MP4). Se ve una vez por sesión, se salta con el botón o Escape, «▶ Ver presentación» la repite y no aparece con «reducir movimiento» |
| Vida del plano | `<style>` dentro de `campus-esoe.svg` | Vehículos por el anillo y barco (`offset-path`), bandera, haz de la torre, olas, aves y destellos. Solo con `prefers-reduced-motion: no-preference` |
| Llegada del acceso | `.titulo-grande .linea`, `@keyframes caer`, `acercar` | El título sube por líneas, los puntos caen uno a uno y el plano se acerca. Esperan a que termine la presentación (`.esperando-intro`) |
| Paralaje | `prepararParalaje()` en `ambiente.js` | La escena se desplaza unos píxeles con el ratón (no con el tacto) |
| Vistas internas | `prepararVistas()` y `.vista-nueva` | Al cambiar de vista, su contenido llega escalonado y las cifras cuentan desde cero; volver a dibujar la misma vista no anima nada |
| Rótulos | clase `.rotulo` y `--font-mono` | Mayúsculas espaciadas, 12 px como mínimo |
| Tipografía | `--font-display` DM Serif Display, `--font-sans` DM Sans | Servidas desde `public/fonts/` (OFL) |

`tests/identidad.test.js` mide el contraste en cuatro ámbitos: acceso e internas, de día y de noche.
`tests/estructura.test.js` comprueba que la escena es decorativa (`aria-hidden`), que la barra tiene
nombre y que noche y sonido funcionan, también sin almacenamiento y sin Web Audio.

### Campus 3D (vuelta 14)

Con WebGL, el plano del acceso es una escena Three.js; sin WebGL, o con «reducir movimiento», queda el
dibujo SVG. Nada más cambia: los puntos numerados, la barra de ambiente y el modo noche son los mismos.

| Pieza | Dónde |
|---|---|
| Fuente | `interfaz/campus3d/entrada.js` (escena) y `plano.js` (isla, edificios, camino, árboles y anclas; puro, se prueba en Node) |
| Archivo servido | `public/vendor/campus3d.js`, compilado con `npm run construir:campus` (esbuild, solo las piezas de Three.js que se usan, con su licencia MIT al final) |
| Colores | variables `--campus-*` y `--marca-*` de `:root`; la escena las lee al iniciar |
| Carga | `prepararCampus3D()` en `ambiente.js`: comprueba WebGL y movimiento, y descarga el archivo solo en el acceso |
| Noche | la escena observa `data-noche` en `<html>` y cambia la luz poco a poco: ventanas encendidas, haz de la torre, mar más oscuro |

**Después de cambiar algo en `interfaz/campus3d/`** hay que ejecutar `npm run construir:campus`;
`tests/campus3d.test.js` compila en memoria y falla si el archivo servido quedó viejo.

Para las pruebas visuales locales, la escena expone `window.scene` y `window.__renderer__` **solo en
`localhost`**. El arnés de capturas (Deno y Playwright) vive en la máquina de desarrollo y no se
versiona: está listado en `.git/info/exclude`.

### Bienvenida del panel (vuelta 15)

Tomada del Campus Virtual de la UNAH: el panel abre con un saludo, accesos directos según el rol y
las clases del periodo como tarjetas con banda de color (`--banda-0` a `--banda-3`, letra
`--sobre-banda`; la prueba de identidad mide cada color de cada banda). En el campus 3D se sumaron
cadetes que marchan en la plaza, espuma en la orilla, luz cinematográfica (ACES) y etiquetas que,
si chocan en pantalla, se quedan solo con su número.

### Comparación con sitios de referencia (vuelta 11, 2026-11-16)

Medida con REA (estructura) y Craft Anything (diseño), la misma vara
para todos:

| Sitio | Regiones | Navegaciones sin nombre | Títulos | Texto base | Lo que se adoptó |
|---|---|---|---|---|---|
| Harvard | 8 (banner, main, contentinfo, 5 nav) | 0 | 37 | 18 px | Regiones con nombre en cada pantalla |
| Campus Virtual UNAH | 3 | 1 | 13 | 18 px | Preguntas frecuentes sobre el acceso, con `<details>` |
| Portal UNAH | 3 | 1 | 27 | 14 px | Opciones de tamaño de texto |
| INFOP E-Learning | 6 | 0 | 6 | 18 px | — (Moodle; ya conectado en INT-04) |
| INFOP Academias | 6 | 0 | 4 (dos vacíos) | 12 px | Ejemplo a evitar: títulos vacíos |
| TecNM | 3 | 3 | 0 | 11 px | Ejemplo a evitar: sin títulos ni nombres |
| **ESOE antes** | **0** | 0 | 2 | 14 px en el aviso | — |
| **ESOE después** | **2** (banner, main «Iniciar sesión») | 0 | 3 | 16 px, ajustable a 20 px | — |

Las capturas y medidas completas quedan en `~/herramientas/salidas/` (no se versionan).

### Herramientas de referencia

Instaladas fuera del proyecto, en `/home/user/herramientas/` (no se versionan):

- **REA** (`rea-agents` 6.9.0, npm). Inspecciona un sitio ya cargado en un navegador con depuración
  remota: estructura, regiones, títulos, scripts y recursos.
  ```bash
  chrome --headless=new --remote-debugging-port=9333 --proxy-server="$HTTPS_PROXY" https://www.harvard.edu/
  /home/user/herramientas/rea/node_modules/.bin/rea list-browser-targets http://127.0.0.1:9333
  /home/user/herramientas/rea/node_modules/.bin/rea inspect-web-page http://127.0.0.1:9333 <id> --format json
  ```
- **Craft Anything** (`craft-anything-cli`). Se compila desde su código con
  `cargo build --release -p craft-anything-cli --locked` (Rust 1.97). Estudia un sitio como lo ve
  un visitante (modo *clean room*: capturas, medidas, colores, tipografía) y puede reconstruirlo.
  No tiene integración con REA: son dos herramientas independientes que se usan juntas.

Los sitios de referencia que el entorno puede alcanzar están en su lista de hosts permitidos: Harvard,
Moodle, Canvas (Instructure), TalentLMS, isEazy, las dos plataformas del INFOP, el portal y el
Campus Virtual de la UNAH y el TecNM.

## 15. Cambiar el esquema de la base de datos

El esquema cambia **solo** con migraciones nuevas. Nunca se edita una que ya se aplicó.

1. Crear el siguiente archivo en `database/migraciones/`, con el número que sigue y una descripción en
   minúsculas: `0002_auditoria_de_notas.sql`. Los números van seguidos, sin saltos.
2. Escribir el cambio en SQL. Toda la migración corre dentro de una transacción: si una línea falla,
   no queda nada a medias.
3. `npm run migrar` contra la base local, dos veces. La segunda debe decir "nada que aplicar".
4. `npm run verificar`. Las pruebas crean cada base con las migraciones, igual que producción.

Qué hace `npm run migrar` y por qué:

| Comportamiento | Motivo |
|---|---|
| Registra cada migración con la huella de su contenido | Si alguien edita una ya aplicada, se detiene (`MIGRACION_ALTERADA`): esa edición nunca llegaría a las bases que ya la tienen |
| Toma un candado de PostgreSQL antes de empezar | Dos contenedores que arrancan a la vez no aplican lo mismo dos veces |
| Usa una conexión propia, no la de la aplicación | Una transacción tiene que ir entera por la misma conexión |
| Adopta una base creada con el antiguo `schema.sql` | Tiene las tablas pero no el registro: se registra la 0001 sin volver a ejecutarla |
| Se niega a migrar una base de un código más nuevo | Aplicar encima la dejaría en un estado imposible |
