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
