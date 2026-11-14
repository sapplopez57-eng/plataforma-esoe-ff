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

## Fase 1 — Gestión escolar real

### SEC-03 · Escapar todo dato mostrado en la interfaz — Pendiente · prioridad alta
La interfaz arma HTML con plantillas e inserta nombres, observaciones y temas tal como se
escribieron (12 asignaciones a `innerHTML`, ninguna función de escape). Hoy el daño se limita al
propio navegador; en cuanto los datos se compartan desde el servidor, un nombre con código
ejecutaría ese código en la sesión de un administrativo.
- **Aceptación:** cuando se registra un estudiante llamado `<img src=x onerror=alert(1)>`, la lista
  y el expediente muestran ese texto literal y no se ejecuta nada.
- **Verificación:** prueba de navegador que crea el registro y falla si aparece un diálogo.

### SMS-01 · Migraciones versionadas — Pendiente
Sustituir el `schema.sql` único por migraciones numeradas con registro de cuáles se aplicaron.
- **Aceptación:** cuando se ejecuta `npm run migrar` sobre una base vacía o ya migrada, queda en la
  última versión sin errores ni cambios duplicados.
- **Verificación:** `npm test` (la prueba del esquema usa las migraciones).

### SEC-05 · Inicio de sesión real — Pendiente · prioridad alta
Hoy cualquier usuario y contraseña entran. Implementar el diseño de la sección 8 del plano:
Argon2id, sesión en servidor con cookie `HttpOnly`, límite de intentos, alta del primer
administrativo por línea de comandos.
- **Aceptación:** cuando las credenciales son incorrectas el sistema responde 401 con un mensaje
  genérico; al sexto intento en 15 minutos responde 429; con credenciales válidas entrega una cookie
  `HttpOnly; Secure; SameSite=Strict`.
- **Verificación:** `npm test` con casos de éxito, fallo, bloqueo y cierre de sesión.

### SEC-06 · Permisos por rol y por pertenencia — Pendiente · prioridad alta
Eliminar el selector de rol de la barra superior. El rol sale de la sesión.
- **Aceptación:** cuando un catedrático pide la asistencia de una clase que no imparte, recibe 403;
  cuando un estudiante pide el boletín de otro, recibe 403; sin sesión, toda ruta de `/api` salvo
  salud e inicio de sesión responde 401.
- **Verificación:** matriz de pruebas rol × ruta en `npm test`.

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

### SEC-04 · Retirar los manejadores en línea y cerrar la política de contenido — Pendiente
La interfaz tiene más de 50 atributos `onclick`/`onsubmit`, lo que obliga a permitir
`script-src-attr 'unsafe-inline'`. Pasar a delegación de eventos y servir las fuentes desde el
propio servidor.
- **Aceptación:** la cabecera CSP no contiene `unsafe-inline` para scripts y la aplicación funciona
  sin errores en consola.
- **Verificación:** prueba de cabeceras en `npm test` + recorrido en navegador.

### SEC-07 · Protección CSRF y auditoría de seguridad de la fase — Pendiente
Cierre de fase: revisión completa por dominios y corrección de lo que aparezca.

## Fase 2 — Calidad de uso

| Id | Elemento | Aceptación resumida |
|---|---|---|
| DIS-01 | Unificar la identidad visual | El README describe una paleta oliva/marrón y la hoja de estilos usa azul. Decisión del dueño; después, una sola fuente de verdad en variables CSS |
| DIS-02 | Accesibilidad WCAG 2.1 AA | Análisis automático sin fallos graves; todo operable con teclado; foco visible; contraste 4.5:1 |
| DIS-03 | Rediseño tipográfico | Texto base de 16 px, un solo color de acento, jerarquía por tipografía |
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
| INT-01 | Inicio de sesión único con el directorio institucional (OIDC) |
| INT-02 | Importar paquetes SCORM 1.2 y 2004 |
| INT-03 | Enlace a videoconferencia por sesión de clase |
| LMS-10 | Itinerarios por promoción y recomendación del siguiente paso |
| IA-01 | Controles de la sección 10 del plano, **antes** de cualquier función con IA |
| IA-02 | Asistente para catedráticos: borradores de preguntas, siempre con aprobación humana |
