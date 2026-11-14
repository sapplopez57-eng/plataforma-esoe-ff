# Plataforma ESOE — Sistema de Administración Escolar (SMS)

Plataforma web integral desarrollada para la **Escuela de Suboficiales del Ejército (ESOE)**, enfocada en la gestión administrativa y académica (**SMS - School Management System**), con una base modular preparada para acoplar un **LMS (Learning Management System)** en etapas posteriores.

---

## 1. Paleta de Colores Institucional Aplicada

El sistema visual sigue estrictamente la paleta cromática definida:

* **Olive (`#6B8E5A`):** Acciones primarias, estados activos, aprobaciones (`>= 70%`) y confirmaciones.
* **Choco (`#5B3A2E`):** Navegación lateral, cabeceras estructurales, tipografía principal y jerarquía visual.
* **Beige (`#EADCC8`):** Superficies secundarias, encabezados de tabla, bordes y fondos cálidos de lectura.
* **Rust (`#B85E2E`):** Acentos secundarios, alertas de reprobación (`< 70%`), inasistencias y acciones de cierre.

---

## 2. Reglas de Negocio Implementadas

1. **Modalidades de Periodos Lectivos (4 Opciones Habilitadas):**
   * Semestral (`SEMESTRAL`)
   * Cuatrimestral (`CUATRIMESTRAL`)
   * Modular (`MODULAR`)
   * Año Lectivo Completo (`ANUAL`)
2. **Organización de Estudiantes:**
   * Los estudiantes se agrupan únicamente por **Promoción**.
3. **Asignación de Clases y Catedráticos:**
   * Cada clase (materia + promoción) tiene **1 único catedrático titular**; un catedrático puede impartir varias clases.
4. **Expediente del Estudiante:**
   * Incluye **Código del Alumno** (código numérico manejado a nivel de FFAA), **DNI**, **Condición (Militar / Civil)**, **Grado Militar** (en caso de ser militar), datos personales, tipo de sangre, procedencia y contacto de emergencia.
5. **Expediente del Catedrático:**
   * Incluye **Nombre completo**, **DNI**, **Título académico** y **Grado** (en caso de ser militar).
6. **Control de Asistencia:**
   * Registro de asistencia **por clase y sesión impartida** (`PRESENTE`, `AUSENTE`, `TARDANZA`, `EXCUSA`).
7. **Sistema de Calificaciones:**
   * Escala oficial de **0% a 100%**, con nota mínima aprobatoria de **70%**.

---

## 3. Puesta en Marcha

```bash
npm ci
cp .env.example .env
npm run dev
```

La interfaz queda en `http://localhost:8080`. También puede abrirse `public/index.html` directamente
en un navegador moderno, sin servidor.

En esta etapa los datos se guardan en el almacenamiento local de cada navegador y la pantalla de
acceso no valida credenciales: es una demostración, no un sistema listo para datos reales. El camino
hasta ahí está en [`docs/BACKLOG.md`](docs/BACKLOG.md).

Antes de entregar cualquier cambio:

```bash
npm run verificar
```

---

## 4. Despliegue

```bash
cp .env.example .env    # completar DB_PASSWORD y JWT_SECRET con: openssl rand -hex 48
docker compose up -d --build
```

La plataforma queda en el puerto `8080` con PostgreSQL inicializado desde `database/schema.sql`.
Debe publicarse siempre detrás de un proxy con HTTPS. Procedimiento completo, respaldos y reversión
en el [manual](docs/MANUAL_DE_PROCEDIMIENTOS.md).

---

## 5. Documentación

| Documento | Contenido |
|---|---|
| [`docs/BLUEPRINT.md`](docs/BLUEPRINT.md) | Visión, arquitectura, seguridad, diseño y orden de construcción |
| [`docs/LOOP_DE_DESARROLLO.md`](docs/LOOP_DE_DESARROLLO.md) | Ciclo de trabajo, definición de terminado y registro de vueltas |
| [`docs/BACKLOG.md`](docs/BACKLOG.md) | Cola priorizada con criterios de aceptación |
| [`docs/MANUAL_DE_PROCEDIMIENTOS.md`](docs/MANUAL_DE_PROCEDIMIENTOS.md) | Instalación, operación, secretos, incidentes y auditoría |
| [`LECCIONES.md`](LECCIONES.md) | Errores encontrados, causa raíz y regla que los evita |
