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
| Cambié `schema.sql` y la base no cambió | Solo se aplica al crear el volumen | Sección 7 |

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

| Variable | Valor | Uso |
|---|---|---|
| `--olivo`, `--chocolate`, `--beige`, `--oxido` | los del README | marca: bordes, adornos, menú lateral |
| `--olivo-fuerte` / `--olivo-hondo` | `#4F6B41` / `#43593A` | botón primario, Aprobado, Presente, menú activo |
| `--oxido-fuerte` / `--oxido-hondo` | `#9A4D27` / `#84411F` | Reprobado, Ausente, acciones de cierre |
| `--texto`, `--titulo`, `--piedra` | chocolate, `#3E2A22`, `#6E5A4B` | texto, títulos, texto secundario |
| `--papel`, `--beige-suave`, `--linea` | `#FBF8F3`, `#F4ECE0`, `#E3D5C0` | fondo, superficies, bordes |

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
