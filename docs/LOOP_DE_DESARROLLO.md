# Ciclo de desarrollo

Cómo avanza este proyecto. Una regla lo resume: **un objetivo por vuelta, y ninguna vuelta se
cierra sin `npm run verificar` en verde.**

```
   ┌──────────────────────────────────────────────────────────────────────┐
   │                                                                      │
   ▼                                                                      │
1 Contexto ─▶ 2 Elegir ─▶ 3 Plan ─▶ 4 Construir ─▶ 5 Verificar ─▶ 6 Revisar ─▶ 7 Cerrar
                                        ▲               │
                                        └── falla ──────┘
```

## Los siete pasos

### 1. Cargar contexto
Antes de tocar nada, leer en este orden:

1. `LECCIONES.md` — lo que ya salió mal y la regla que lo evita.
2. `docs/BACKLOG.md` — qué sigue.
3. La sección del `docs/BLUEPRINT.md` que afecta al objetivo.
4. `git log --oneline -15` y `npm run verificar`: el punto de partida debe estar en verde. Si no lo
   está, arreglarlo **es** el objetivo de la vuelta.

### 2. Elegir un objetivo
El primer elemento del backlog en estado `Pendiente`, respetando el orden: los de seguridad (`SEC`)
de prioridad alta van siempre antes que cualquier función nueva. Un solo elemento. Si no cabe en una
sesión, se parte en el backlog antes de empezar.

### 3. Planear
Escribir, en la descripción de la solicitud de cambio o en el propio elemento del backlog:

- El criterio de aceptación en la forma *cuando [disparador], el sistema [respuesta observable]*.
- El comando que lo demuestra.
- Cómo se revierte si sale mal.

### 4. Construir
- Rama por objetivo, salida de `main`.
- Primero la prueba que falla, luego el código que la hace pasar.
- Cambios pequeños. Si aparece un problema ajeno al objetivo, se anota en el backlog y se sigue.
- Si aparece un **error**, se investiga la causa y se corrige en la misma vuelta. No se arrastra.

### 5. Verificar
```bash
npm run verificar
```
Comprueba, en orden: estilo, pruebas con cobertura mínima, vulnerabilidades en dependencias,
secretos versionados, `.env` fuera de git y validez de `docker-compose.yml`. Además, si el cambio
toca la interfaz, se abre en un navegador y se recorre el flujo afectado sin errores en consola.

Una prueba no se desactiva ni se omite para obtener el verde.

### 6. Revisar
Lectura completa del diff antes de entregar, con estas preguntas:

- ¿Hay alguna ruta nueva sin comprobación de sesión y de permisos?
- ¿Algún dato del usuario llega a HTML o a SQL sin escapar o sin parametrizar?
- ¿Se registra o se devuelve algún dato personal que no hace falta?
- ¿Queda código muerto, comentarios obsoletos o algo que solo "funciona en mi equipo"?

En los cambios de seguridad se hace además la auditoría por dominios descrita en el manual.

### 7. Documentar y cerrar
- `docs/BACKLOG.md`: marcar el elemento como `Hecho` con la fecha.
- `LECCIONES.md`: una entrada por cada error encontrado (qué pasó, causa raíz, regla).
- `docs/MANUAL_DE_PROCEDIMIENTOS.md`: si cambió la forma de instalar, operar o desplegar.
- Añadir la fila de la vuelta al registro de abajo.
- Solicitud de cambio hacia `main`; se fusiona con el CI en verde.

## Definición de terminado

Un elemento está terminado cuando se cumplen las ocho:

1. El criterio de aceptación se demuestra con su comando.
2. Tiene pruebas automáticas, incluido al menos un caso de error o de acceso denegado.
3. `npm run verificar` pasa en local y en CI.
4. Cobertura de `src/` igual o superior al umbral.
5. Sin secretos, sin datos personales en registros, sin vulnerabilidades altas.
6. La interfaz afectada se recorrió en navegador, también a ancho de teléfono.
7. Documentación y backlog actualizados.
8. Los errores hallados están en `LECCIONES.md`.

## Ramas y commits

- `main` siempre desplegable. Nadie escribe directo en `main`.
- Ramas: `tipo/descripcion-corta`, por ejemplo `sec/escapar-salida-html`.
- Commits en imperativo y en español, explicando el porqué: `Limita la interfaz publicada a public/`.

## Cuándo se detiene el ciclo

Solo ante una decisión que pertenece al dueño del proyecto: identidad visual, reglas de negocio
ambiguas, borrado de datos, gasto de dinero, o cualquier acción irreversible sobre producción.
Todo lo demás se investiga y se resuelve dentro de la vuelta.

## Cómo se mide

Se anotan en el registro; importa la tendencia, no el número aislado.

| Medida | Para qué sirve |
|---|---|
| Elementos cerrados por vuelta | Ritmo real |
| Errores que reaparecen (misma causa raíz) | Si las lecciones se están aplicando |
| Cobertura de `src/` | Si las pruebas acompañan al código |
| Hallazgos de seguridad abiertos por prioridad | Deuda de riesgo |

## Registro de vueltas

| Vuelta | Fecha | Objetivo | Resultado | Verificación |
|---|---|---|---|---|
| 1 | 2026-11-14 | Fase 0: base del ciclo y seguridad mínima (SEC-01, SEC-02, CAL-01) | Hecho | 24 pruebas, 99 % líneas, 0 vulnerabilidades, 0 secretos |
| 2 | 2026-11-14 | Inicio de sesión con Clerk y rol decidido por el servidor (SEC-05) | Hecho; falta validar con llaves reales (OPS-03) | 43 pruebas; 10 formas de sesión inválida rechazadas |
| 3 | 2026-11-14 | Conexión con Moodle e INFOP (INT-04) | Hecho | 57 pruebas, 97 % líneas; recorrido en navegador con 14 comprobaciones |
| 4 | 2026-11-15 | Escapar la salida y cerrar la política de contenido (SEC-03, SEC-04) | Hecho | 67 pruebas, 97.61 % líneas; guardián de escape que falla con archivo y línea |
| 5 | 2026-11-15 | Permisos por pertenencia (SEC-06) | Hecho | 77 pruebas, 96.88 % líneas; matriz rol × ruta y guardián de rutas sin sesión |
