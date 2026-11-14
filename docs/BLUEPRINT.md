# BLUEPRINT — Plataforma ESOE

Plano de la plataforma educativa de la Escuela de Suboficiales del Ejército. Describe hacia dónde
va el producto, con qué se construye y en qué orden. El trabajo diario se rige por
[LOOP_DE_DESARROLLO.md](LOOP_DE_DESARROLLO.md) y se alimenta de [BACKLOG.md](BACKLOG.md).

| | |
|---|---|
| Estado | Vigente; última revisión en la vuelta 3 |
| Punto de partida | Prototipo de gestión escolar (SMS) con datos en el navegador |
| Destino | Plataforma educativa completa: gestión escolar + aula virtual (LMS) |

---

## 1. Visión

Un único entorno donde la ESOE administra su vida académica (periodos, promociones, expedientes,
clases, asistencia, calificaciones) y, sobre esa misma base, imparte formación en línea: contenidos,
evaluaciones, seguimiento y comunicación entre catedráticos y alumnos.

La vara de medir son las diez características de una plataforma educativa seria (sección 3) y una
postura de seguridad diseñada desde el plano, no añadida al final (secciones 8 a 10).

## 2. Usuarios y roles

| Rol | Qué hace | Qué no puede hacer |
|---|---|---|
| Administrativo | Estructura académica, expedientes, carga académica, reportes | — |
| Catedrático | Asistencia y calificaciones **solo de sus clases**; contenidos de sus cursos | Ver o editar clases ajenas, expedientes completos |
| Estudiante | Su boletín, su asistencia, sus cursos | Ver datos de otros alumnos, editar notas |

Regla de fondo: el rol se decide en el servidor a partir de la sesión. La interfaz nunca es la
barrera de seguridad.

## 3. Alcance por características

Estado real al cierre de la vuelta 1. "Prototipo" significa que existe en la interfaz pero guarda
los datos en el navegador de cada persona.

| # | Característica esperada | Estado | Fase |
|---|---|---|---|
| 1 | Gestión de contenidos y biblioteca de recursos | No existe | 3 |
| 2 | Evaluación, exámenes y retroalimentación | Prototipo (4 notas por clase, mínimo 70 %) | 1 → 3 |
| 3 | Seguimiento del progreso y analítica | Prototipo (panel, boletín) | 2 |
| 4 | Interacción, colaboración y comunidad | No existe | 4 |
| 5 | Personalización e itinerarios | No existe | 5 |
| 6 | Accesibilidad e inclusión (WCAG 2.1 AA) | Sin auditar | 2 |
| 7 | Estándares SCORM / xAPI / LTI | No existe | 5 |
| 8 | Gamificación y motivación | No existe | 4 |
| 9 | Integración institucional (SSO, SIS, videoconferencia) | Parcial: inicio de sesión con Clerk; conexión con Moodle e INFOP | 1 → 5 |
| 10 | Escalabilidad, seguridad y disponibilidad | Base puesta en la vuelta 1 | Continua |

## 4. Fuera de alcance por ahora

- Pagos, facturación, CRM y captación de alumnos.
- Aplicación móvil nativa (la web debe funcionar bien en el teléfono).
- Funciones con inteligencia artificial: no se construyen hasta que existan los controles de la
  sección 10.
- Andamiaje de empresa (trazabilidad RQ/DEC/TSK, ADR, modelo de amenazas formal, ASVS, DAST).
  Se activa cuando haya usuarios reales con datos personales; ver sección 16.

## 5. Arquitectura

```
Navegador ──HTTPS──▶ Proxy inverso / túnel ──▶ Aplicación Node (Express) ──▶ PostgreSQL 16
    │                                            ├─ /api/*   reglas de negocio, permisos
    │                                            └─ /public  interfaz estática
    │                                                 │
    └──▶ Clerk (inicio de sesión)                     └──▶ Moodle / INFOP (cursos del usuario)
```

Dos servicios externos, cada uno con una sola función: Clerk identifica a la persona; las
plataformas Moodle entregan los cursos que esa persona lleva fuera de la escuela.

Un solo servicio de aplicación y una base de datos. Sin microservicios: la escuela necesita algo
que una persona pueda operar y respaldar. La aplicación no guarda estado propio (todo vive en
PostgreSQL), así que se puede reiniciar o duplicar sin perder nada.

## 6. Stack

Versiones instaladas y verificadas en la vuelta 1 (`npm ls --depth=0`).

| Pieza | Elección | Motivo |
|---|---|---|
| Runtime | Node.js 22 | LTS; trae ejecutor de pruebas y cobertura integrados |
| Servidor | Express 4.22 | Ya estaba en el proyecto; suficiente para el tamaño |
| Base de datos | PostgreSQL 16 | Ya estaba; integridad referencial, columnas calculadas |
| Acceso a datos | `pg` 8 con consultas parametrizadas | Sin ORM: el esquema es pequeño y se quiere ver el SQL |
| Inicio de sesión | Clerk (`@clerk/express` 2.1 en el servidor, ClerkJS 6 en el navegador) | Contraseñas, verificación de correo, segundo factor y bloqueo por intentos resueltos por un proveedor especializado |
| Cabeceras | `helmet` 8 | CSP, HSTS, nosniff con valores seguros por defecto |
| Límite de peticiones | `express-rate-limit` 8 | Freno a fuerza bruta y abuso |
| Interfaz | HTML, CSS y JavaScript sin framework | Es lo que hay y funciona; no se reescribe sin motivo |
| Calidad | ESLint 10, `node --test` | Cero dependencias extra para probar |
| Entrega | Docker Compose sobre un contenedor LXC | Infraestructura propia |

## 7. Modelo de datos

Fuente de verdad: [`database/schema.sql`](../database/schema.sql). Doce tablas:

`usuarios` · `periodos_lectivos` · `promociones` · `estudiantes` · `catedraticos` · `materias` ·
`clases` · `sesiones_asistencia` · `detalle_asistencia` · `calificaciones` ·
`plataformas_externas` · `cuentas_externas`

Reglas de negocio que la base de datos hace cumplir por sí sola (cada una tiene su prueba en
`tests/esquema.test.js`):

- Solo cuatro modalidades de periodo: semestral, cuatrimestral, modular, anual.
- Una clase es materia + promoción + periodo y tiene **un único** catedrático titular.
- Notas entre 0 y 100; nota final = promedio de tres parciales y acumulativo; aprueba con 70.
- Una sesión de asistencia por clase y fecha; estados: presente, ausente, tardanza, excusa.
- Código de alumno y DNI únicos.

Pendiente de diseño (fase 1): migraciones versionadas en lugar de un único `schema.sql`, y tabla de
auditoría de cambios en notas y asistencia.

## 8. Autenticación y permisos

El inicio de sesión lo resuelve **Clerk**. La plataforma no guarda contraseñas.

| Tema | Cómo queda |
|---|---|
| Identidad | Clerk: contraseña, verificación de correo, segundo factor y protección contra fuerza bruta |
| Sesión | El navegador obtiene de Clerk un token de corta duración y lo envía en la cabecera `Authorization` en cada petición |
| Verificación | El servidor comprueba firma, vigencia y sitio de emisión (`ORIGEN_PUBLICO`) en cada petición |
| Rol | Vive en los metadatos públicos del usuario en Clerk (`{"rol": "ADMIN"}`), que solo el servidor puede modificar. Roles: `ADMIN`, `CATEDRATICO`, `ESTUDIANTE` |
| Sin rol | Una cuenta recién registrada no tiene rol y no accede a nada hasta que la administración se lo asigne |
| CSRF | Las cookies no autentican: sin la cabecera `Authorization` la petición se rechaza, así que un sitio ajeno no puede actuar con la sesión abierta |
| Respuesta por defecto | Toda ruta de `/api` exige sesión salvo `/api/health` y `/api/config` |
| Modo demostración | Si Clerk no está configurado (solo fuera de producción), la interfaz funciona con datos locales y la API protegida responde 503. En producción la aplicación no arranca sin Clerk |

Pendiente: los permisos **por pertenencia** (un catedrático solo sobre sus clases, un alumno solo
sobre su boletín) llegan con la API de gestión escolar, SEC-06. Los datos de gestión escolar todavía
viven en el navegador; ver sección 3.

Dato a tener presente: los nombres y correos de las cuentas se almacenan en Clerk, un servicio
externo alojado fuera del país. Los expedientes (DNI, datos médicos, notas) no salen de la base de
datos propia.

## 9. Protección de la aplicación y de los datos

Hecho en la vuelta 1 (cada punto tiene prueba automática):

- El servidor solo publica la carpeta `public/`. Antes publicaba todo el repositorio.
- Cabeceras de seguridad con política de contenido (CSP).
- API cerrada a otros orígenes salvo los declarados en `CORS_ORIGINS`.
- Límite de peticiones en `/api` y tamaño máximo de cuerpo de 100 kB.
- Los errores no revelan detalles internos.
- En producción la aplicación se niega a arrancar si falta Clerk, la clave de cifrado, el origen
  público o la base de datos, o si la contraseña es de ejemplo.
- Contenedor sin privilegios: usuario `node`, sistema de archivos de solo lectura.

Datos personales que se manejan: DNI, fecha de nacimiento, tipo de sangre, dirección, teléfono y
contacto de emergencia de los alumnos. Reglas:

- Viajan solo por HTTPS y nunca aparecen en registros ni en mensajes de error.
- Cada rol recibe únicamente los campos que necesita.
- Respaldo diario cifrado de PostgreSQL, con restauración ensayada (pendiente, fase 2).
- Los secretos viven en `.env`, fuera del repositorio; `npm run secretos` lo vigila.

## 10. Seguridad de las funciones con inteligencia artificial

Todavía no hay ninguna. Cuando se incorporen (recomendador de contenidos, apoyo a la creación de
cursos), cumplirán esto antes de llegar a producción. La referencia es el OWASP Top 10 para
aplicaciones con modelos de lenguaje.

| Riesgo | Control obligatorio |
|---|---|
| Inyección de instrucciones | El texto de alumnos y documentos se trata como dato, nunca como orden; filtros de entrada |
| Salida insegura | La respuesta del modelo se valida y se escapa antes de mostrarla o ejecutarla |
| Fuga de datos | El modelo no recibe DNI, datos médicos ni notas de terceros; solo lo mínimo para la tarea |
| Permisos excesivos | El modelo no escribe notas ni asistencia; toda acción con efecto pasa por una persona |
| Cadena de suministro | Inventario de modelos, proveedores y versiones; nada se actualiza sin probar |
| Alucinaciones | El contenido generado se marca como borrador y lo aprueba un catedrático |
| Sin rastro | Se registran entradas y salidas para auditoría, sin datos personales |
| Abuso de costo | Límite de uso por usuario y por día |

La respuesta ante un incidente está en el
[manual de procedimientos](MANUAL_DE_PROCEDIMIENTOS.md#8-respuesta-a-incidentes).

## 11. API

Todas devuelven JSON y validan la entrada.

| Ruta | Quién | Qué hace |
|---|---|---|
| `GET /api/health` | Público | Estado del servicio |
| `GET /api/config` | Público | Datos no secretos que la interfaz necesita para iniciar sesión |
| `GET /api/sesion` | Con sesión | Identidad y rol de quien llama |
| `GET /api/integraciones/catalogo` | Administración | Plataformas conocidas (INFOP) |
| `GET /api/integraciones/plataformas` | Con sesión | Plataformas registradas y si el usuario las tiene vinculadas |
| `POST /api/integraciones/plataformas` | Administración | Registra una plataforma tras comprobar que es un Moodle con servicios web |
| `POST /api/integraciones/plataformas/:id/probar` | Administración | Comprueba que la plataforma responde |
| `DELETE /api/integraciones/plataformas/:id` | Administración | Elimina la plataforma y las cuentas vinculadas a ella |
| `POST /api/integraciones/plataformas/:id/cuenta` | Con sesión | Vincula la cuenta propia del usuario |
| `DELETE /api/integraciones/plataformas/:id/cuenta` | Con sesión | Desvincula la cuenta propia |
| `GET /api/integraciones/mis-cursos` | Con sesión | Cursos, avance y calificación del usuario en sus plataformas vinculadas |

Pendiente (fase 1): estructura académica, expedientes, clases, asistencia y calificaciones.

### Conexión con otras plataformas

Investigado el 14-11-2026: las dos plataformas de INFOP —E-Learning
(`plataformavirtual.infop.hn`) y Academias (`academias.infop.hn`)— son sitios **Moodle** con los
servicios web y el servicio móvil habilitados. Por eso un único conector cubre Moodle e INFOP.

Cómo funciona:

1. La administración registra la plataforma. El servidor verifica que la dirección es un Moodle con
   servicios web antes de guardarla.
2. Cada persona vincula **su propia cuenta**: escribe su usuario y contraseña de esa plataforma, el
   servidor los cambia por una llave de acceso personal (el mismo mecanismo de la aplicación móvil
   oficial de Moodle) y descarta la contraseña.
3. La llave se guarda cifrada (AES-256-GCM). Con ella se consultan los cursos, el avance y la
   calificación de esa persona, y nada más.

No hace falta ningún acuerdo ni permiso de administrador en INFOP: cada quien accede solo a lo suyo.
Lo que **no** se puede hacer sin un acuerdo con INFOP es inscribir alumnos, crear cursos o leer
datos de terceros.

Controles específicos:

| Riesgo | Control |
|---|---|
| Que el servidor sea usado para alcanzar la red interna (SSRF) | Solo `https`; se rechazan direcciones IP y nombres que resuelvan a redes internas; la comprobación se hace en la misma resolución que usa la conexión; no se siguen redirecciones |
| Fuga de credenciales | La contraseña no se guarda ni se registra; las llaves van cifradas en la base y nunca se devuelven por la API; viajan en el cuerpo de la petición, no en la URL |
| Usar la escuela como intermediario para adivinar contraseñas de INFOP | Diez intentos de vinculación por usuario cada 15 minutos |
| Contenido malicioso desde la plataforma externa | Todo texto recibido se muestra escapado |
| Plataforma caída o llave revocada | La consulta no falla: informa el estado y pide volver a vincular |
| Respuestas enormes o lentas | Límite de 2 MB y de 10 segundos |

Otros tipos de plataforma se agregan como un cliente más junto a `src/integraciones/moodle.js`.

## 12. Interfaz y diseño

Se toman como referencia los sitios universitarios de primer nivel. De la portada de Harvard,
medida el 14-11-2026: un solo color de acento sobre fondo blanco, una única familia tipográfica,
texto base de 18 px, botones de esquinas rectas y sin sombra, retícula de 4 px. No se copia su
identidad; se adoptan los principios:

1. **Un acento, no cinco.** El color institucional señala la acción principal y nada más.
2. **La tipografía hace la jerarquía.** Tamaño y peso antes que cajas, bordes y sombras.
3. **Texto legible.** Base de 16 px como mínimo (hoy es 14 px), líneas de 60 a 75 caracteres.
4. **Navegación por tarea y por audiencia.** Cada rol ve primero lo que viene a hacer.
5. **Accesible por construcción.** WCAG 2.1 AA: contraste 4.5:1, todo operable con teclado, foco
   visible, formularios con etiqueta, tablas con encabezados.
6. **Primero el teléfono.** Los alumnos consultan desde el móvil.
7. **Rápida.** Sin dependencias externas en la carga inicial; hoy las fuentes vienen de un tercero.

De las plataformas educativas líderes (Canvas, Moodle) se adopta: panel con "qué tengo pendiente",
libro de calificaciones editable en línea con guardado visible, y progreso por curso siempre a la
vista.

Deuda conocida de la interfaz: ver SEC-03, SEC-04, DIS-01 y DIS-02 en el backlog.

## 13. Calidad y pruebas

| Capa | Herramienta | Umbral |
|---|---|---|
| Estilo y errores | ESLint | 0 errores |
| Unidad e integración | `node --test` | 80 % de líneas, 70 % de ramas en `src/` |
| Esquema | PostgreSQL real, base desechable | Todas las reglas de negocio |
| Dependencias | `npm audit` | 0 vulnerabilidades altas o críticas |
| Secretos | `scripts/buscar-secretos.js` | 0 hallazgos |
| Imagen | Construcción y arranque en CI | Responde y corre sin privilegios |

Todo se ejecuta con un solo comando: `npm run verificar`. El mismo comando corre en cada
solicitud de cambio.

## 14. Despliegue y operación

- Contenedor LXC con Docker Compose; la aplicación detrás de un proxy inverso con HTTPS.
- La base de datos no se publica fuera de la red interna de Compose.
- Vigilancia: `GET /api/health` desde un monitor externo.
- Procedimientos paso a paso: [MANUAL_DE_PROCEDIMIENTOS.md](MANUAL_DE_PROCEDIMIENTOS.md).

## 15. Orden de construcción

Cada paso es una vuelta del ciclo y cabe en una sesión de trabajo. El detalle, con criterio de
aceptación y comando de verificación, está en [BACKLOG.md](BACKLOG.md).

| Fase | Objetivo | Listo cuando |
|---|---|---|
| 0 | Base del ciclo: estructura, pruebas, CI, seguridad mínima | **Hecho (vuelta 1)** |
| 1 | Gestión escolar real: API y datos en PostgreSQL. **Hecho:** inicio de sesión y roles (vuelta 2), conexión con Moodle e INFOP (vuelta 3) | Dos personas en dos equipos ven los mismos datos y cada rol solo accede a lo suyo |
| 2 | Calidad de uso: accesibilidad AA, rediseño tipográfico, reportes, respaldos | Auditoría de accesibilidad sin fallos graves; restauración ensayada |
| 3 | Aula virtual: cursos, contenidos, tareas, exámenes con banco de preguntas | Un catedrático publica un curso y un alumno lo completa y recibe nota |
| 4 | Comunidad y motivación: anuncios, foros, insignias | — |
| 5 | Interoperabilidad: SSO institucional, SCORM, itinerarios | — |

## 16. Restricciones y criterios para escalar

- Infraestructura propia; sin servicios de pago obligatorios.
- Idioma de la interfaz y de la documentación: español.
- No se reescribe lo que funciona: la interfaz actual se migra pieza a pieza.
- Ningún secreto en el repositorio, nunca.

El proyecto pasa a régimen formal (trazabilidad de requisitos, decisiones de arquitectura
documentadas, modelo de amenazas, OWASP ASVS, análisis estático y dinámico de seguridad, cumplimiento de
protección de datos) cuando se cumpla **cualquiera** de estas condiciones: datos reales de alumnos
en producción, más de una persona desarrollando, o un requisito legal o contractual.
