# BLUEPRINT — Plataforma ESOE

Plano de la plataforma educativa de la Escuela de Suboficiales del Ejército. Describe hacia dónde
va el producto, con qué se construye y en qué orden. El trabajo diario se rige por
[LOOP_DE_DESARROLLO.md](LOOP_DE_DESARROLLO.md) y se alimenta de [BACKLOG.md](BACKLOG.md).

| | |
|---|---|
| Estado | Vigente desde la vuelta 1 |
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
| 9 | Integración institucional (SSO, SIS, videoconferencia) | No existe | 5 |
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
                                                 ├─ /api/*   reglas de negocio, sesión, permisos
                                                 └─ /public  interfaz estática
```

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
| Cabeceras | `helmet` 8 | CSP, HSTS, nosniff con valores seguros por defecto |
| Límite de peticiones | `express-rate-limit` 8 | Freno a fuerza bruta y abuso |
| Interfaz | HTML, CSS y JavaScript sin framework | Es lo que hay y funciona; no se reescribe sin motivo |
| Calidad | ESLint 10, `node --test` | Cero dependencias extra para probar |
| Entrega | Docker Compose sobre un contenedor LXC | Infraestructura propia |

## 7. Modelo de datos

Fuente de verdad: [`database/schema.sql`](../database/schema.sql). Diez tablas:

`usuarios` · `periodos_lectivos` · `promociones` · `estudiantes` · `catedraticos` · `materias` ·
`clases` · `sesiones_asistencia` · `detalle_asistencia` · `calificaciones`

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

**Estado actual: no hay autenticación real.** La pantalla de acceso deja entrar con cualquier
usuario y cualquier contraseña, y un selector en la barra superior permite cambiar de rol. Es
aceptable solo mientras los datos sean de demostración y vivan en el navegador. Corregirlo es el
primer objetivo de la fase 1.

Diseño a implementar:

| Tema | Decisión |
|---|---|
| Contraseñas | Argon2id; nunca reversibles; mínimo 12 caracteres |
| Sesión | Cookie `HttpOnly`, `Secure`, `SameSite=Strict`; sesión guardada en el servidor para poder revocarla |
| Fuerza bruta | 5 intentos por cuenta y por IP cada 15 minutos, con bloqueo progresivo |
| Permisos | Comprobación por rol **y por pertenencia** en cada ruta (un catedrático solo toca sus clases) |
| Respuesta por defecto | Toda ruta de `/api` exige sesión salvo `/api/health` y el inicio de sesión |
| Formularios | Protección CSRF en toda operación que modifique datos |
| Rastro | Se registra quién cambió cada nota y cada asistencia, y cuándo |

## 9. Protección de la aplicación y de los datos

Hecho en la vuelta 1 (cada punto tiene prueba automática):

- El servidor solo publica la carpeta `public/`. Antes publicaba todo el repositorio.
- Cabeceras de seguridad con política de contenido (CSP).
- API cerrada a otros orígenes salvo los declarados en `CORS_ORIGINS`.
- Límite de peticiones en `/api` y tamaño máximo de cuerpo de 100 kB.
- Los errores no revelan detalles internos.
- En producción la aplicación se niega a arrancar con secretos ausentes o de ejemplo.
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

Existente: `GET /api/health`.

Fase 1, en este orden. Todas devuelven JSON, validan la entrada y exigen sesión.

| Recurso | Rutas |
|---|---|
| Sesión | `POST /api/sesion`, `DELETE /api/sesion`, `GET /api/sesion` |
| Estructura | `/api/periodos`, `/api/promociones`, `/api/materias` |
| Personas | `/api/estudiantes`, `/api/catedraticos` |
| Clases | `/api/clases` |
| Asistencia | `/api/clases/:id/asistencia` |
| Calificaciones | `/api/clases/:id/calificaciones`, `/api/estudiantes/:id/boletin` |

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
| 1 | Gestión escolar real: sesión, permisos, API y datos en PostgreSQL | Dos personas en dos equipos ven los mismos datos y cada rol solo accede a lo suyo |
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
