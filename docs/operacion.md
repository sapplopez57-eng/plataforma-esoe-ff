# Operación y recuperación

El objetivo inicial son más de 300 cuentas con uso repartido. La capacidad efectiva depende del
servidor, el historial y el tráfico; no se aprovisionan cuentas ficticias para justificarla.

## Incorporación al clúster existente

Antes de desplegar, identificar en modo lectura el contenedor actual, sus volúmenes, versión de
PostgreSQL, proxy HTTPS, configuración de Clerk, migraciones y trabajos de respaldo. Confirmar
el acceso autorizado y las huellas SSH. El inventario histórico no demuestra el estado actual.
No ejecutar Compose sobre servicios existentes sin adaptar rutas, nombres y credenciales y sin
una copia restaurable. No sustituir volúmenes ni usar `docker compose down -v`.

`docker-compose.yml` es una propuesta para un despliegue aislado. No incorpora automáticamente
los servicios que ya viven en el clúster. El puerto de entrada escucha en `127.0.0.1:8080`;
el proxy HTTPS existente debe poder alcanzarlo desde su propia ubicación. Un proxy alojado en
otro contenedor necesita una ruta privada explícita, revisada antes de publicar.

## Réplicas y base de datos

La propuesta incluye dos procesos web detrás de HAProxy, sin puertos públicos individuales.
El proxy comprueba `/api/ready` y retira las instancias que dejan de estar disponibles.
`/api/live` comprueba el proceso sin depender de PostgreSQL. La preparación comprueba que la
base acepta escrituras y dispone de la tabla de cuotas. El cierre permite drenar peticiones.

Las cuotas se comparten en PostgreSQL con actualizaciones atómicas: añadir procesos no multiplica
el límite del mismo usuario. En producción se exige `RATE_LIMIT_STORE=postgres`; un fallo del
almacén devuelve un error temporal y no abre el acceso. Clerk sigue verificando la identidad y
los permisos mantienen el alcance de la institución, docente y estudiante.

El trabajo de preparación ejecuta migraciones y configura `esoe_app` con permisos limitados.
El proceso web no recibe la contraseña administrativa ni permisos para modificar el esquema,
el registro de migraciones o borrar auditoría. `APP_DB_PASSWORD` debe ser distinta de la clave
administrativa, tener de 24 a 128 caracteres y usar letras, números, guion o guion bajo.
No cambiar la contraseña del rol compartido con instancias activas sin coordinar su transición.

La suma de `DB_POOL_MAX` de todas las instancias debe dejar conexiones disponibles para
administración, migraciones, respaldo y otros servicios. El valor inicial es diez por proceso;
en Vercel es dos. Hay plazos finitos para adquirir conexiones y ejecutar consultas. El proxy
admite hasta ocho destinos; ampliar más requiere revisar su configuración. Compose no ofrece
por sí solo escalado automático por carga ni alta disponibilidad de PostgreSQL o del servidor.

Configurar `ORIGEN_PUBLICO` como origen HTTPS y `TRUST_PROXY` según la cadena real de proxies.
No confiar indiscriminadamente en cabeceras externas. Mantener las claves en el gestor de secretos,
reutilizar la instancia Clerk existente y comprobar sus dominios autorizados antes de publicar.

## Base de datos administrada y cifrado en tránsito

La base puede vivir en el mismo clúster o en un servicio administrado. El cliente de PostgreSQL
elige el cifrado con `DB_SSL`. Sin definirla, una base local o de red interna sigue sin cifrado,
igual que antes, y una base remota o administrada se conecta con el certificado verificado.
`DB_SSL=requerido` cifra sin comprobar el certificado y no se admite para una base remota en
producción. Una autoridad certificadora propia se entrega en `DB_CA_CERT`, en formato PEM.

Un despliegue sin estado, como Vercel, abre y cierra conexiones con cada invocación. En ese caso
se usa el agrupador de conexiones del servicio administrado, no la conexión directa: la
configuración rechaza el puerto `5432` de un servidor administrado cuando `VERCEL` está activo y
exige el `6543` del agrupador. `DB_POOL_MAX` baja a dos por proceso en ese entorno.

Las migraciones no se aplican desde el proceso web sin estado. Se ejecuta `npm run migrar` con la
conexión directa y un rol autorizado para cambiar el esquema, antes de publicar la versión que las
necesita. El proceso web conserva su rol sin privilegios de administración.

## Registro y correlación de peticiones

Cada evento del servidor sale por la salida estándar como **una línea JSON**, pensada para que un
recolector (journald, Loki, CloudWatch) la ingiera sin parseo frágil:

```json
{"t":"2026-11-25T00:17:16.712Z","nivel":"info","servicio":"ESOE-SMS","entorno":"production","peticion":"5f1c...","mensaje":"peticion atendida","metodo":"GET","ruta":"/api/clases/:id","estado":200,"ms":12.4,"origen":"10.0.0.7"}
```

Toda respuesta que atiende la aplicación lleva la cabecera `x-peticion-id`. Si la petición entra con
una propia y es válida (`[A-Za-z0-9_-]`, de 8 a 64 caracteres), se conserva para poder seguir una
traza que empieza en la pasarela; si no lo es, se descarta y se genera un UUID.

**Excepción, medida:** las respuestas que emite Node sin pasar por la aplicación **no llevan la
cabecera**. Es el caso del `408` por cabeceras incompletas de la sección siguiente: Node cierra esa
conexión antes de que la petición llegue a Express, así que el registro no deja línea de acceso ni
identificador para ella. Un recuento de peticiones basado solo en este registro no las ve; para
contarlas hace falta el registro de la pasarela o del balanceador. Ese identificador aparece en la línea
de acceso y en el error de la misma petición, de modo que un `500` se ata a quién lo provocó.

`LOG_NIVEL` acepta `depuracion`, `info`, `aviso`, `error` y `silencio` (por defecto `info`, y
`silencio` cuando `NODE_ENV=test`). Las claves sensibles —credenciales, cookies, tokens, DNI,
correo— se sustituyen por `[REDACTADO]` antes de serializar, a cualquier profundidad, así que el
registro no se convierte en una fuga de datos personales.

## Límites de tiempo del servidor HTTP

Para que una conexión a medias no ocupe un hueco del servidor indefinidamente (*slowloris*):

| Variable | Por defecto | Qué corta |
|---|---|---|
| `HTTP_KEEPALIVE_TIMEOUT_MS` | 5000 | conexión ociosa ya atendida |
| `HTTP_HEADERS_TIMEOUT_MS` | 10000 | cabeceras que no terminan de llegar |
| `HTTP_REQUEST_TIMEOUT_MS` | 30000 | petición completa |

El orden `keepAlive < cabeceras < peticion` es obligatorio y la configuración se niega a arrancar si
no se cumple. El intervalo con que Node revisa las conexiones a medias se deriva de esos valores
(la mitad del menor, con un piso de 250 ms): sin eso Node solo revisaría cada 30 s y el límite de
cabeceras no se aplicaría de verdad.

**Alcance, medido:** estos tres límites solo rigen donde el proceso es dueño de su servidor HTTP, es
decir el contenedor y el arranque con `npm start`. **En el despliegue sin estado de Vercel no
aplican**: ahí el punto de entrada (`api/index.js`) entrega la aplicación a la plataforma, que es la
que acepta las conexiones, y Express no puede imponer un plazo de cabeceras. En ese despliegue la
protección contra conexiones a medias es la que ofrezca la plataforma, no esta. Las cuatro variables
`HTTP_*` quedan sin efecto y no hay por qué fijarlas.

## Reintentos ante fallos transitorios

Las **lecturas** contra una plataforma externa (configuración pública de Moodle y las llamadas de
consulta del servicio web) se reintentan hasta 3 veces con espera exponencial y *jitter*
(100-200 ms, 200-400 ms), solo ante `TIEMPO_AGOTADO`, `SIN_CONEXION` o los estados 429, 502, 503 y
504. El **envío de credenciales no se reintenta nunca**: insistir con una contraseña equivocada
bloquea la cuenta del usuario en el sitio remoto.

**De dónde sale esta clasificación.** No es una suposición: se comprobó contra el código de Moodle.
En `lib/setup.php` (rama `MOODLE_405_STABLE`, líneas 354-375), el modo mantenimiento por CLI responde

```php
header($_SERVER['SERVER_PROTOCOL'] . ' 503 Moodle under maintenance');
header('Retry-After: 300');
```

Ese bloque está en el arranque, antes de cualquier distinción de punto de entrada —su único
condicional es `!CLI_SCRIPT`—, así que `/webservice/rest/server.php` y `/lib/ajax/service-nologin.php`
reciben el mismo `503`, con cuerpo HTML y no JSON. La documentación de desarrollador de Moodle lo
confirma: «During maintenance mode Moodle will serve a 503 Service Unavailable»
(`docs.moodle.org/dev/Error_pages`), y en esa misma página el `502` queda descrito como fallo de un
proxy o CDN por delante de Moodle, que es justamente lo que vale la pena reintentar.

**Por eso se honra `Retry-After`.** Moodle pide 300 segundos y el presupuesto de reintentos son unos
pocos segundos: insistir es tiempo perdido y además el usuario acabaría viendo «no respondió a
tiempo» en lugar de «en mantenimiento». Cuando la respuesta trae un `Retry-After` por encima del
presupuesto, no se reintenta: el fallo se traduce de inmediato a `EN_MANTENIMIENTO`. Un `503` sin
`Retry-After`, como el de un proxy sobrecargado, sí se reintenta.

El `500` se deja fuera a propósito: en Moodle los errores de la propia aplicación no viajan como
estado HTTP, sino como `200` con una excepción en el cuerpo JSON, que `traducirError` ya traduce por
`errorcode` (`sitemaintenance`, `upgraderunning`, `invalidtoken`...). Un `500` de verdad apunta a un
fallo del servidor remoto, no a una indisponibilidad pasajera.

`tests/ayuda.js` reproduce los dos casos tal como se midieron: el mantenimiento por CLI con su
`503`, su `Retry-After: 300` y su cuerpo HTML, y el `503` de proxy sin `Retry-After`. Las pruebas
fallan si se quita el reintento, comprobado por mutación.

El migrador espera a que la base acepte conexiones hasta 6 intentos (500 ms a 8 s) ante
`ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`, `ETIMEDOUT`, `ECONNRESET`, `57P03` y `53300`. Un error de
credenciales (`28P01`) falla de inmediato. Así el contenedor no muere cuando la base todavía arranca.

## El Moodle de la ESOE: versión y servidor web

### Versión objetivo, y por qué

`deploy/moodle/version-objetivo.json` fija la versión a la que el Moodle institucional debe estar
alineado, con el commit comprobado. Lo esencial:

| | Objetivo | Rechazado |
|---|---|---|
| Rama | `MOODLE_503_STABLE` | `main` |
| `release` | `5.3.1+ (Build: 20261124)` | `6.0dev (Build: 20261124)` |
| `maturity` | **`MATURITY_STABLE`** | **`MATURITY_ALPHA`** |
| Commit comprobado | `5fdb0b5b1abfd8d1d084c616fd35d141db8ab27a` | — |

Una rama de desarrollo de Moodle libera cada semana: el número de versión cambia con ella, no hay
garantía de ruta de actualización del esquema entre dos instantáneas, y los parches de seguridad no
siguen la disciplina de *backport* de una rama estable. Con expedientes de personal militar eso no es
defendible. Como referencia externa, el `azuredeploy.json` de `Azure/Moodle` —mantenido al día— admite
una sola versión en su `allowedValues`: `MOODLE_503_STABLE`.

Comprobado: `public/version.php` existe también en 5.3 estable, así que el endurecimiento del servidor
web de más abajo aplica igual, y el bloque de mantenimiento de `public/lib/setup.php` es idéntico
(`503` + `Retry-After: 300`), de modo que los reintentos de la integración siguen siendo correctos
después del cambio de rama.

### Llevar el fork a la rama estable

Esto se ejecuta en el repositorio del Moodle institucional, no aquí:

```bash
git remote add upstream https://github.com/moodle/moodle
git fetch upstream MOODLE_503_STABLE
git switch -c esoe/estable upstream/MOODLE_503_STABLE
```

Luego, en cada actualización, `git fetch upstream` y `git merge upstream/MOODLE_503_STABLE`. Lo que
sea propio de la ESOE vive en `public/local/` y en un tema propio, nunca editando el núcleo: así una
actualización de seguridad entra sin conflictos.

**Lo que esto no arregla.** Cambiar de rama no convierte en estable una base de datos que ya se migró
con el esquema de 6.0dev. Si el sitio ya corrió con 6.0dev, el esquema está por delante de 5.3 y
Moodle **no baja de versión**: hay que partir de una base limpia o de un respaldo anterior a esa
migración.

### Comprobar la base antes de cambiar de rama

`npm run comprobar:moodle-base` responde eso, y es lo primero que hay que correr: **antes** de apuntar
el sitio a `esoe/estable`. No se puede dejar en manos de `comprobar:moodle`, que pregunta por la API
del sitio y por tanto **llega tarde**: si el esquema está por delante, Moodle no arranca y no hay API a
la que preguntar.

Lee `MOODLE_DB_URL` en solo lectura y compara el `version` de la tabla de configuración contra el
`version` que fija `deploy/moodle/version-objetivo.json`:

| En la base | Qué significa | Resultado |
|---|---|---|
| no existe `mdl_config` | base limpia, sin instalar | **pasa**, con aviso |
| `version` por detrás del objetivo | Moodle actualizará hacia adelante | **pasa**, con aviso de respaldar |
| `version` igual al objetivo | ya alineada | **pasa** |
| `version` por delante del objetivo | esquema de una rama de desarrollo | **falla**: base limpia o respaldo anterior |
| la tabla existe sin fila `version` | instalación a medias | **pasa**, con aviso |
| el rol no puede leer la tabla | no se puede afirmar nada | **falla** |

La comparación es **por partes, no por coma flotante**: `2026100501.2` es posterior a `2026100501.02`,
y leerlas como número decimal las ordenaría al revés. El prefijo se toma de `MOODLE_DB_PREFIX` (por
omisión `mdl_`) y se valida contra el identificador que admite Moodle antes de tocar la base, porque un
nombre de tabla no se puede parametrizar: un prefijo con comillas o punto y coma se rechaza sin
conectar. El `release` instalado se registra junto al informe, de modo que en el registro queda escrito
`6.0dev` y no solo un número.

La política TLS es la misma de la plataforma, no una aparte: `MOODLE_DB_SSL` y `MOODLE_DB_CA_CERT`
pasan por el mismo código que `DB_SSL` y `DB_CA_CERT`, así que la URL tampoco decide aquí. Esa base
guarda expedientes, así que le aplica el mismo piso.

`tests/moodle-base.test.js` monta los seis casos contra PostgreSQL real, con una base desechable por
caso y un rol sin permiso de lectura para el último. Comprobado por mutación: desactivando el candado
de «por delante del objetivo», la prueba del esquema de desarrollo falla.

### Servidor web endurecido

`deploy/moodle/nginx.conf` y `deploy/moodle/apache.conf` son equivalentes y aplican dos capas:

1. **El docroot va a `public/`.** Desde la reestructura de Moodle 5.1 es ahí donde vive el código
   servible. Apuntar a la raíz publica el árbol interno.
2. **Reglas de denegación, por si alguien mueve el docroot.** Niegan 16 archivos y 5 directorios que
   se comprobó que **no existen** dentro de `public/` (`composer.json`, `composer.lock`, `UPGRADING.md`,
   `Gruntfile.js`, `phpunit.xml.dist`, `rector.php`, `vendor/`, `node_modules/`, `bin/`, `scripts/`...),
   más los archivos ocultos y el estado de php-fpm. Si el docroot se mueve por error, esto lo tapa
   mientras se corrige. La configuración de Azure no tiene esta segunda capa: confía solo en el docroot.

Las rutas que **sí** se sirven desde `public/` —`admin`, `lib`, `local`, `theme`, `course`, `user`,
`webservice`— no se niegan, y `tests/moodle-despliegue.test.js` falla si alguna llegara a negarse. Esa
prueba verifica además el docroot, el enrutado por `r.php` de Moodle 5.1+, HSTS, `nosniff`, el mínimo
de TLS, la redirección a HTTPS y que la versión fijada siga siendo estable.

## Comprobación de la plataforma Moodle

`npm run comprobar:moodle` interroga al Moodle configurado en `MOODLE_URL` y falla el despliegue si la
integración no puede funcionar. No supone nada: todo lo que afirma lo pregunta.

| Comprueba | Cómo | Si falla |
|---|---|---|
| `MOODLE_URL` canónica y HTTPS | `normalizarUrlBase` | fallo, sin salir a la red |
| Es un Moodle, con servicios web y servicio móvil | `tool_mobile_get_public_config` | fallo |
| El `DocumentRoot` apunta a `public/` | GET a `composer.json`, `composer.lock`, `UPGRADING.md`, `Gruntfile.js`, `phpunit.xml.dist` | fallo si alguno responde `200` |
| El token puede llamar a las funciones que la integración usa | `core_webservice_get_site_info` → `functions` | fallo en las exigidas, aviso en las de notas |
| La versión no es una rama de desarrollo | `release` de `site_info` | fallo en producción, aviso fuera |

**Por qué el `DocumentRoot`.** Desde la reestructura de Moodle 5.1 el código servible vive en
`public/`, y los cinco archivos de la tabla existen **solo** por encima de esa carpeta, nunca dentro.
Si el servidor web responde `200` a alguno, el `DocumentRoot` apunta a la raíz del código y está
publicando el árbol interno: `composer.json`, `composer.lock`, `admin/`, `lib/`, `scripts/`. El sitio
parece funcionar igual, así que es un fallo silencioso. Las plantillas de despliegue de Azure para
Moodle lo resuelven del mismo modo (`scripts/setup_webserver.sh`: `htmlRootDir="${htmlRootDir}/public"`).

**Por qué la versión.** Una `release` que contenga `dev`, `alpha`, `beta` o `rc` es una rama de
desarrollo con liberaciones semanales y madurez alfa, no una estable. En producción con expedientes
reales eso es un fallo, no un aviso. Para referencia, las plantillas de Azure para Moodle solo admiten
una versión en su `azuredeploy.json`: `MOODLE_503_STABLE`.

## TLS con la base de datos: por qué la URL no decide

`node-postgres` da prioridad a los parámetros de la cadena de conexión sobre el objeto `ssl` que le
pasa la aplicación. Comprobado contra PostgreSQL real: con `?sslmode=disable` en la URL y
`ssl: { rejectUnauthorized: true }` en el objeto, **la conexión se establece sin cifrado** y
`pg_stat_ssl.ssl` queda en `false`. Es decir, la política podía declarar `verificado` y el tráfico
viajar en claro, con los expedientes dentro.

Por eso la plataforma ya no acepta que la URL lleve la política:

| En `DATABASE_URL` | Qué pasa |
|---|---|
| `sslmode` **más débil** que `DB_SSL` | **no arranca**, y el error dice cuál pide cada uno |
| `sslmode` **más fuerte** que `DB_SSL` | arranca con el más fuerte de los dos |
| `sslmode=prefer` o `allow` | **no arranca**: dejan la decisión al servidor |
| `sslmode` sin `DB_SSL` | se adopta como política (`disable`→`desactivado`, `require`→**`verificado`**, `verify-*`→`verificado`) |

`require` se honra como **`verificado`**, no como «cifra y no compruebes». En libpq, `require` cifra
sin validar el certificado, y eso deja pasar a un intermediario que suplante la base de datos. La
plataforma no ofrece eso por omisión: para TLS sin verificar hay que pedirlo a propósito con
`DB_SSL=requerido`, y con una base remota en producción sigue sin arrancar. La regla es por fuerza,
nunca por igualdad: lo que pida más gana, lo que pida menos se rechaza.
| `ssl`, `sslrootcert`, `sslcert`, `sslkey`, `sslnegotiation` | **no arranca**: use `DB_SSL` y `DB_CA_CERT` |

En todos los casos la URL que la aplicación usa para conectar sale **sin** esos parámetros, así que el
objeto `ssl` es siempre el que manda. Los demás parámetros (`application_name` y compañía) se
conservan. Esto aplica a la aplicación, al migrador, a `preparar-base`, a `crear-root` y al
comprobador de despliegue: todos pasan por la misma limpieza.

### Dos agujeros más de la misma familia

**`DB_SSL=requerido` con base remota en producción ya no arranca.** `requerido` cifra pero no
comprueba el certificado (`rejectUnauthorized: false`), así que un intermediario puede suplantar la
base de datos. Con una base remota en producción hay que usar `verificado`.

**Los hosts se clasifican por lo que son, no por cómo empiezan.** Antes, cualquier nombre que
empezara por un prefijo de red privada se tomaba por privado, así que un dominio público como
`10.database.example` se consideraba local y la exigencia de TLS no se aplicaba. Y cualquier host sin
punto se tomaba por local, lo que incluía una dirección IPv6 pública como `2606:4700::1111`. Ahora se
analiza con `net.isIP` y, cuando es una IP de verdad, se comprueba contra la misma lista de redes
internas que usa la defensa contra SSRF. Un nombre de una sola etiqueta sigue siendo local, porque no
puede ser un dominio público: eso mantiene funcionando el `esoe-db` de `docker-compose`, y hay una
prueba que falla si deja de ser así.

## Calificación y puntaje máximo: por qué hace falta un candado

Dos disparadores se vigilaban mutuamente y ninguno bloqueaba la fila de la tarea: el de la
calificación leía el puntaje máximo vigente y el del puntaje máximo miraba las notas ya puestas. Con
las dos operaciones a la vez, **las dos comprobaciones pasaban con el estado anterior y las dos
confirmaban**. Reproducido contra PostgreSQL real: un administrador baja el máximo de 100 a 50
mientras el catedrático califica con 90, y queda en la base una nota de 90 con un tope de 50.

La migración `0012_calificacion_serializada.sql` reemplaza `exigir_nota_dentro_del_puntaje` para que
lea la tarea con `FOR UPDATE`. Eso serializa las dos operaciones en cualquier orden:

* si la bajada del máximo va primero, la calificación espera, relee `50` y se rechaza;
* si la calificación va primero, la bajada espera, ve la nota de `90` y se rechaza.

`tests/calificacion-concurrente.test.js` monta la carrera de verdad, con dos conexiones y dos
transacciones, y comprueba las dos caras: **sin** la migración el invariante se rompe, **con** ella
aguanta. También comprueba que la función viva en el esquema real toma el candado.

La migración 0011 no se edita: una migración ya aplicada no se toca, y el migrador lo rechaza por
huella. El cambio entra como migración nueva.

## El rol de la aplicación y la versión del esquema

`preparar-base` retira al rol de la aplicación todo permiso sobre `migraciones_aplicadas` y luego le
concede **solo `SELECT`**. Sin esa lectura, `npm run comprobar:despliegue` fallaba siempre aunque todo
estuviera bien: la consulta de la versión moría con `42501` (permiso denegado), que el manejador no
distinguía de `42P01` (sin esquema), y tampoco servía ejecutarlo como administrador porque el propio
comprobador rechaza roles con privilegios de administración.

La versión del esquema no es un dato sensible y la herramienta de despliegue la necesita. Escribirla
sigue prohibido: `tests/permisos-base.test.js` comprueba que el rol lee la versión y que el `INSERT`,
el `UPDATE` y el `DELETE` sobre esa tabla siguen devolviendo `42501`. El comprobador, además, ya
distingue los dos códigos y dice qué ejecutar.

## Comprobación previa al despliegue

`npm run comprobar:despliegue` valida contra la base real, sin modificarla, y termina con código
distinto de cero si algo falta:

- La configuración completa del entorno, con las exigencias de producción.
- Que la conexión viaja cifrada cuando la base es remota.
- Que el rol de la aplicación no es superusuario.
- Que la base acepta escrituras y no está en recuperación.
- Que la versión del esquema aplicado coincide con la que espera el código.

Ejecutarlo después de migrar y antes de dirigir tráfico a la versión nueva. No sustituye a
`npm run verificar`, que cubre el código; comprueba el entorno al que se publica.

## Respaldo y restauración

El servicio de respaldo genera un archivo PostgreSQL personalizado al arrancar y cada 24 horas,
verifica su catálogo y guarda una suma SHA-256. Conserva catorce días por defecto y solo elimina
copias antiguas tras producir una nueva válida. Los archivos tienen permisos privados. La salud
del servicio detecta copias atrasadas; debe conectarse al monitoreo operativo del clúster.

El volumen local no protege ante pérdida del nodo: requiere almacenamiento cifrado, una copia
fuera del servidor y una política de retención adecuada. Los archivos no se cifran por el propio
script. No considerar completa la recuperación hasta verificar una copia externa restaurable.

Para ensayar una restauración, crear una base nueva y aislada con un rol autorizado. Verificar la
suma del archivo con `sha256sum -c`, restaurar con `pg_restore --exit-on-error --no-owner --no-acl`
apuntando únicamente a esa base y comprobar esquema, auditoría y registros conocidos. No restaurar
encima de producción ni ejecutar migraciones contra la copia original. Registrar fecha, duración,
resultado y pérdida de datos máxima aceptable antes de acordar objetivos de recuperación.

## Validación antes de publicar

Ejecutar `npm run verificar` con `PRUEBAS_DATABASE_URL` desechable. Las pruebas de base crean y
eliminan bases aisladas; esa variable nunca debe señalar un servidor sin autorización para ello.
Comprobar dos instancias, cuotas compartidas, retirada de una instancia, recuperación del servicio
y restauración de una copia. Después validar con la configuración real de Clerk los tres roles,
HTTPS, monitoreo y acceso desde la red prevista. Las pruebas locales no prueban la capacidad ni
la recuperación del clúster de producción.

## Evidencia local del 23 de noviembre de 2026

La compuerta completa terminó sin fallos ni avisos usando PostgreSQL y Chromium locales.
También se ejecutaron las imágenes construidas en una red Docker aislada, sin cuentas de clientes:

- Dos servidores detrás de HAProxy recibieron peticiones y compartieron el contador PostgreSQL.
- Con una cuota de dos, las respuestas consecutivas fueron 200, 200 y 429 entre ambos destinos.
- Tras detener un servidor, el otro respondió a ocho comprobaciones de vida y conservó el 429.
- El servicio de respaldo creó una copia con permisos 600 en un directorio 700; su SHA-256 coincidió.
- La copia se restauró en otra base y recuperó el registro de control esperado.

Los contenedores, redes, volúmenes y bases de esas comprobaciones se eliminaron al terminar.
Esto verifica mecanismos locales de continuidad y recuperación. No mide carga de usuarios reales,
no verifica el acceso productivo a Clerk y no acredita un despliegue en el clúster.
