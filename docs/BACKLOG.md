# Backlog

Cola de trabajo del [ciclo de desarrollo](LOOP_DE_DESARROLLO.md). Se toma siempre el primer elemento
`Pendiente` de arriba hacia abajo. Cada elemento es una vuelta.

Prefijos: `SEC` seguridad · `CAL` calidad y herramientas · `SMS` gestión escolar · `DIS` diseño y
accesibilidad · `OPS` operación · `LMS` aula virtual · `INT` integraciones · `IA` inteligencia artificial.

## Hecho

| Id | Elemento | Vuelta |
|---|---|---|
| SEC-01 | El servidor publica solo `public/`; código, esquema y configuración dejan de ser descargables | 1 |
| SEC-02 | Sin secretos por defecto; producción no arranca con secretos ausentes o de ejemplo | 1 |
| CAL-01 | Compuerta `npm run verificar`, pruebas, cobertura, análisis de secretos y CI | 1 |
| SEC-05 | Inicio de sesión real con Clerk; el rol lo decide el servidor; el selector de rol desaparece con sesión real | 2 |
| INT-04 | Conexión con Moodle e INFOP: registro de plataformas, vinculación de cuenta personal y consulta de cursos | 3 |
| DIS-05 | La pantalla de acceso ya no se desborda en teléfonos de 360 px | 3 |
| SEC-03 | Escapar todo dato mostrado en la interfaz; guardián automático contra reintroducirlo | 4 |
| SEC-04 | Sin manejadores en línea; CSP sin `unsafe-inline` para scripts; fuentes propias | 4 |
| SEC-06 | Permisos por pertenencia: cada cuenta ligada a su expediente y cada consulta limitada a lo propio | 5 |
| DIS-01 | Identidad visual unificada: paleta del README como única fuente en `:root`; desde la vuelta 7, azul y naranja con variables por función | 6, 7 |
| DIS-03 | Escala tipográfica con base de 16 px; un solo acento de acción; jerarquía por tipografía | 6 |
| SMS-01 | Migraciones versionadas, aplicadas al arrancar; adopción de bases creadas antes | 8 |
| DIS-07 | Mejoras medidas contra Harvard, UNAH, INFOP y TecNM: regiones en el acceso, tamaño de texto ajustable, preguntas frecuentes, escala en `rem` | 11 |
| DIS-08 | Ambientación tomada de rahulsmoothy.com con la paleta de la ESOE: plano ilustrativo del campus con puntos numerados, barra de ambiente (plano, sonido sintetizado, noche, tamaño del texto), reloj, rótulos monoespaciados, DM Serif Display y DM Sans | 12 |
| DIS-09 | Presentación con el video del escudo (Remotion) y más movimiento: vehículos, barco, aves, haz de la torre, bandera, olas, título por líneas, puntos que caen, paralaje, vistas que llegan y cifras que cuentan | 13 |
| DIS-10 | Campus 3D con Three.js: isla, mar con olas, edificios con sombras, ventanas que se encienden de noche, torre con haz, bandera, vehículos, barco, aves y cámara que respira; si no hay WebGL o se pide reducir movimiento, queda el plano SVG | 14 |

## Fase 1 — Gestión escolar real

### SEC-03 · Escapar todo dato mostrado en la interfaz — Hecho
Las 89 interpolaciones de datos de personas pasan por `esc()`. Al cerrarlo quedaban cuatro huecos
que la inspección manual no vio y que la comprobación automática encontró: `value="${fecha}"`, 26
identificadores interpolados en atributos, y dos textos del menú.
- **Aceptación:** cuando se registra un estudiante llamado `<img src=x onerror=alert(1)>`, la lista
  y el expediente muestran ese texto literal y no se ejecuta nada.
- **Verificación:** `tests/escape.test.js`. Comprueba el comportamiento de `esc()` con ese dato, y
  recorre las plantillas que producen HTML fallando con archivo y línea si alguna interpola un dato
  sin escapar. Incluye el caso que demuestra que el guardián falla cuando debe.

### SMS-01 · Migraciones versionadas — Hecho
`database/migraciones/NNNN_descripcion.sql`, aplicadas en orden por `src/migraciones.js` con registro
y huella en `migraciones_aplicadas`. El contenedor migra antes de arrancar el servidor.
- **Aceptación:** cuando se ejecuta `npm run migrar` sobre una base vacía o ya migrada, queda en la
  última versión sin errores ni cambios duplicados.
- **Verificación:** `tests/migraciones.test.js` (11 casos): base vacía, repetición, migración que
  falla y se deshace entera, migración editada, base más nueva, dos instancias a la vez, adopción de
  una base creada con el antiguo `schema.sql` y esquema a medias. Todas las pruebas crean su base
  con las migraciones.

### OPS-03 · Primer usuario y recorrido de acceso completo — Pendiente · prioridad alta
Las llaves reales ya están en `.env` y la instancia responde: ClerkJS carga desde su dominio, el
formulario de acceso se monta, la política de contenido no bloquea nada y `CLERK_JWT_KEY` coincide
con la instancia. Falta el último tramo, que necesita una cuenta: la instancia tiene cero usuarios.
- **Aceptación:** una persona se registra desde la pantalla de acceso, la administración le asigna
  rol con `node scripts/asignar-rol.js <correo> ADMIN`, entra y ve el panel con su rol.
- **Verificación:** recorrido en navegador + `npm run verificar`.

### SEC-08 · Aplicación de Clerk propia para la ESOE — Pendiente · prioridad alta
La instancia configurada se llama `ares-gateway` y es compartida con otro proyecto: su formulario
dice «Sign in to ares-gateway» y su padrón de usuarios es el mismo. Quien tenga cuenta en el otro
proyecto puede iniciar sesión aquí (sin rol no accede a nada, pero aparece en el padrón).
- **Aceptación:** la plataforma usa una aplicación de Clerk propia, con su padrón separado.
- **Verificación:** el formulario de acceso nombra a la ESOE y la instancia no comparte usuarios.

### DIS-06 · Métodos de acceso aprobados — Pendiente
El formulario ya aparece en español (`esMX`, vendorizado en `public/js/clerk-es.js`). Queda lo que
depende de la instancia: hoy ofrece Google y Base (billetera cripto). Se conserva Google y se retira
la billetera. Es configuración de la aplicación de Clerk, no del código, así que se resuelve junto
con SEC-08.
- **Aceptación:** el formulario ofrece correo y Google, y ninguna billetera.

### SEC-06 · Permisos por pertenencia — Hecho
`usuarios.proveedor_id` liga la cuenta del proveedor con la fila local y `referencia_id` con su
expediente. `src/permisos.js` resuelve ese vínculo por petición y expone los guardianes de
pertenencia; `src/academico/rutas.js` monta las tres consultas de lectura que el criterio necesita.
Una cuenta sin fila en `usuarios` entra pero no es dueña de nada (`SIN_EXPEDIENTE`), y una
desactivada no consulta nada (`CUENTA_INACTIVA`).
- **Aceptación:** cuando un catedrático pide la asistencia de una clase que no imparte, recibe 403;
  cuando un estudiante pide el boletín de otro, recibe 403; sin sesión, toda ruta de `/api` salvo
  salud y configuración responde 401.
- **Verificación:** `tests/permisos.test.js`. Matriz rol × ruta con dos catedráticos y dos
  estudiantes reales en la base, más un guardián que recorre las rutas registradas y falla si alguna
  de `/api` queda sin exigir sesión, con su caso que demuestra que falla cuando debe.

### SMS-02 · API de estructura académica — Pendiente
Periodos, promociones y materias con validación de entrada.
- **Aceptación:** cuando se crea un periodo con modalidad no admitida o fechas invertidas, responde
  422 indicando el campo.
- **Verificación:** `npm test`.

### SMS-03 · API de expedientes — Pendiente
Estudiantes y catedráticos. Cada rol recibe solo los campos que necesita (un catedrático no recibe
dirección ni tipo de sangre).
- **Verificación:** `npm test`, incluida la prueba de campos por rol.

### SMS-04 · API de clases, asistencia y calificaciones — Pendiente
Con registro de quién cambió cada nota y cada asistencia.
- **Aceptación:** cuando se modifica una nota, queda una fila de auditoría con usuario, valor
  anterior, valor nuevo y fecha.
- **Verificación:** `npm test`.

### SMS-05 · La interfaz consume la API — Pendiente
Sustituir el almacenamiento en el navegador, vista por vista.
- **Aceptación:** cuando dos personas entran desde equipos distintos, ven los mismos datos.
- **Verificación:** prueba de navegador con dos sesiones.

### SEC-04 · Retirar los manejadores en línea y cerrar la política de contenido — Hecho
Los 71 atributos `onclick`/`onchange`/`oninput`/`onsubmit` pasaron a `data-on-*` con un despachador
sin `eval` (`public/js/eventos.js`), y las fuentes (DM Sans y DM Serif Display, licencia OFL) se sirven desde `public/fonts/`.
La CSP queda con `script-src-attr 'none'` y `font-src 'self'`.
- **Aceptación:** la cabecera CSP no contiene `unsafe-inline` para scripts y la aplicación funciona
  sin errores en consola.
- **Verificación:** prueba de cabeceras en `npm test` + recorrido en navegador.

### SEC-07 · Protección CSRF y auditoría de seguridad de la fase — Pendiente
Cierre de fase: revisión completa por dominios y corrección de lo que aparezca.

## Fase 2 — Calidad de uso

| Id | Elemento | Aceptación resumida |
|---|---|---|
| DIS-02 | Accesibilidad WCAG 2.1 AA | Hecho en la vuelta 7: navegación con nombre, enlace para saltar al contenido y orden de títulos. Vuelta 11: regiones en el acceso y texto ajustable (WCAG 1.4.4). Falta: análisis automático completo y recorrido solo con teclado de cada vista |
| CAL-02 | Pruebas de navegador dentro de la compuerta | El recorrido de acceso y de otras plataformas corre en `npm run verificar` y en CI |
| DIS-04 | Vista de teléfono para el alumno | Boletín y asistencia legibles a 360 px sin desplazamiento horizontal |
| SMS-06 | Reportes y exportación | Boletín y actas en PDF y CSV; solo para quien tiene permiso |
| SMS-07 | Panel de analítica | Aprobación, asistencia y alumnos en riesgo por clase y promoción |
| OPS-01 | Respaldos | Copia diaria cifrada y restauración ensayada y documentada |
| OPS-02 | Registros estructurados | Sin datos personales; quién hizo qué en operaciones sensibles |

## Fase 3 — Aula virtual

| Id | Elemento |
|---|---|
| LMS-01 | Cursos ligados a clases: unidades, lecciones, recursos (texto, PDF, video enlazado) |
| LMS-02 | Biblioteca de recursos con control de quién sube y quién descarga; análisis de archivos subidos |
| LMS-03 | Tareas con entrega, fecha límite, rúbrica y retroalimentación |
| LMS-04 | Exámenes: banco de preguntas, intentos, tiempo, corrección automática |
| LMS-05 | Las notas del aula alimentan el libro de calificaciones |
| LMS-06 | Progreso por curso y certificado al superar el mínimo |

## Fase 4 — Comunidad y motivación

| Id | Elemento |
|---|---|
| LMS-07 | Anuncios por clase y avisos al alumno |
| LMS-08 | Foro por curso con moderación del catedrático |
| LMS-09 | Insignias y reconocimientos por asistencia y rendimiento |

## Fase 5 — Interoperabilidad y personalización

| Id | Elemento |
|---|---|
| INT-01 | Inicio de sesión con la cuenta institucional (Google o Microsoft) a través de Clerk |
| INT-05 | Registrar en el expediente los cursos completados en plataformas externas, con validación de la administración |
| INT-06 | Acceso a los cursos del Moodle propio sin volver a iniciar sesión (LTI 1.3) |
| INT-02 | Importar paquetes SCORM 1.2 y 2004 |
| INT-03 | Enlace a videoconferencia por sesión de clase |
| LMS-10 | Itinerarios por promoción y recomendación del siguiente paso |
| IA-01 | Controles de la sección 10 del plano, **antes** de cualquier función con IA |
| IA-02 | Asistente para catedráticos: borradores de preguntas, siempre con aprobación humana |
