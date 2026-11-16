# Plataforma ESOE — Sistema de Administración Escolar (SMS)

Plataforma web integral desarrollada para la **Escuela de Suboficiales del Ejército (ESOE)**, enfocada en la gestión administrativa y académica (**SMS - School Management System**), con una base modular preparada para acoplar un **LMS (Learning Management System)** en etapas posteriores.

---

## 1. Paleta de Colores Institucional Aplicada

Paleta azul y naranja, en este orden:

* **01 Azul profundo (`#0287A8`):** bordes estructurales, iconos, cifras y títulos grandes.
* **02 Cian (`#00BFDC`):** estados positivos: aprobado (`>= 70%`) y presente.
* **03 Cielo (`#10C5EA`):** acciones primarias, elemento activo del menú y acentos sobre fondo oscuro.
* **04 Ámbar (`#F19F05`):** advertencias: tardanza.
* **05 Naranja (`#F28805`):** alertas: reprobado (`< 70%`), inasistencia y acciones de cierre. También el galón.

Ninguno de los cinco alcanza el contraste mínimo de 4.5:1 con texto blanco encima (de 2.06 a 4.17),
pero los cuatro brillantes sí lo alcanzan con texto oscuro (de 5.9 a 7.3). Por eso se usan tal cual,
vivos, con texto `#0F2A33` encima. Los enlaces sobre fondo claro usan un azul más hondo (`#026F8A`),
y el menú lateral y el panel de acceso, un fondo oscuro (`#0A2A35`).

Todo color de la interfaz sale de las variables de `:root` en `public/css/styles.css`, nombradas por su
función (`--accion`, `--positivo`, `--negativo`...) y no por su color, para que un cambio de paleta solo
cambie valores. `tests/identidad.test.js` falla si esta paleta y la hoja dejan de coincidir.

El único adorno es el **galón**, la insignia de rango del suboficial, en el panel de acceso.

El **escudo de la ESOE** (`public/img/escudo-esoe.svg`) aparece en el acceso, en el menú y como ícono
de la pestaña. Es un redibujo vectorial del escudo institucional y conserva sus colores oficiales: la
paleta de la interfaz no lo recolorea. Si se dispone del archivo original, basta reemplazar ese SVG.

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

Sin llaves de Clerk la interfaz arranca en **modo demostración**: datos en el navegador y acceso
sin validar. Con las llaves en `.env`, el inicio de sesión es real, el rol lo decide el servidor y
se habilita la conexión con otras plataformas (Moodle, INFOP). Los datos de gestión escolar
todavía se guardan en el navegador; el camino restante está en [`docs/BACKLOG.md`](docs/BACKLOG.md).

Antes de entregar cualquier cambio:

```bash
npm run verificar
```

---

## 4. Despliegue

```bash
cp .env.example .env    # completar según las instrucciones del propio archivo
docker compose up -d --build
```

La plataforma queda en el puerto `8080`. Al arrancar, el contenedor lleva la base a la última versión
del esquema con las migraciones de `database/migraciones/` (`npm run migrar` hace lo mismo a mano).
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
