# Plataforma ESOE — Sistema de Administración Escolar (SMS)

Plataforma web integral desarrollada para la **Escuela de Suboficiales del Ejército (ESOE)**, enfocada en la gestión administrativa y académica (**SMS - School Management System**). La primera etapa del **LMS (Learning Management System)** ya está acoplada: el **aula virtual** de cada clase, con sus unidades, contenidos, tareas y entregas calificables.

---

## 1. Paleta de Colores Institucional Aplicada

Paleta azul y naranja, en este orden:

* **01 Azul profundo (`#0287A8`):** bordes estructurales, iconos, cifras y títulos grandes.
* **02 Cian (`#00BFDC`):** estados positivos: aprobado (`>= 70%`) y presente.
* **03 Cielo (`#10C5EA`):** acciones primarias, elemento activo del menú y acentos sobre fondo oscuro.
* **04 Ámbar (`#F19F05`):** advertencias: tardanza.
* **05 Naranja (`#F28805`):** alertas: reprobado (`< 70%`), inasistencia y acciones de cierre. También el galón.

Las **páginas internas** (todo lo que se ve después de entrar) usan una segunda paleta. La pantalla de
acceso conserva la primera.

* **06 Blanco (`#FFFFFF`):** fondo de las páginas y letra del menú lateral.
* **07 Naranja (`#EF5F18`):** acción principal, elemento activo del menú, reprobado e inasistencia, bordes de acento.
* **08 Índigo (`#261A66`):** menú lateral, texto y títulos, y letra sobre el naranja.

El naranja 07 da 4.44:1 con letra índigo encima, a 0.06 del mínimo. En los rellenos se usa uno un 4 %
más claro (`#F06521`, 4.63:1), que a la vista no se distingue. Como texto sobre blanco, el naranja se
oscurece a `#B8440C` (5.43:1).

Ninguno de los cinco alcanza el contraste mínimo de 4.5:1 con texto blanco encima (de 2.06 a 4.17),
pero los cuatro brillantes sí lo alcanzan con texto oscuro (de 5.9 a 7.3). Por eso se usan tal cual,
vivos, con texto `#0F2A33` encima. Los enlaces sobre fondo claro usan un azul más hondo (`#026F8A`),
y el menú lateral y el panel de acceso, un fondo oscuro (`#0A2A35`).

Todo color de la interfaz sale de las variables de `:root` en `public/css/styles.css`, nombradas por su
función (`--accion`, `--positivo`, `--negativo`...) y no por su color, para que un cambio de paleta solo
cambie valores. `tests/identidad.test.js` falla si esta paleta y la hoja dejan de coincidir.

La pantalla de acceso tiene **ambiente**: un plano ilustrativo del campus con puntos numerados que se
funde con el papel, nubes lentas, un reloj y una barra para mostrar u ocultar el plano, encender un
sonido ambiental sintetizado, pasar a modo noche y agrandar el texto. Todo con esta misma paleta, en
DM Serif Display y DM Sans, y con rótulos monoespaciados. El sonido nunca arranca solo y «reducir
movimiento» apaga toda animación. Al abrir la plataforma, una **presentación** muestra el escudo animado
(una vez por sesión, con «Saltar intro»); en el plano circulan vehículos y un barco, ondea la bandera
y gira el haz de la torre. En equipos con WebGL ese plano es un **campus en 3D** (Three.js) con sombras,
olas, ventanas que se encienden de noche y una cámara que sigue al ratón; sin WebGL queda el dibujo.

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
8. **Aula Virtual (LMS, primera etapa):**
   * Cada clase tiene **un aula virtual**, a cargo de su catedrático titular o de la administración.
   * El aula se organiza en **unidades ordenadas**, y cada unidad en **contenidos** (`TEXTO`, `ENLACE`, `VIDEO`, `DOCUMENTO`). Todo enlace es HTTPS.
   * Las **tareas** llevan instrucciones, puntaje máximo, fecha de entrega con zona horaria y si admiten atraso.
   * El estudiante guarda un **borrador** y luego **entrega**; fuera de plazo no se recibe salvo que la tarea lo permita.
   * El titular **califica** sin pasar del puntaje máximo. Una entrega calificada ya no la modifica el estudiante.
   * Unidades, contenidos y tareas se publican por separado: el estudiante solo ve lo publicado.

---

## 3. Puesta en Marcha

Requisitos: Node 22.9 o superior. Para las pruebas del esquema, PostgreSQL 16.

```bash
npm ci
cp .env.example .env
```

Complete la configuración de Clerk y PostgreSQL en `.env` o en las variables seguras del entorno.
Después aplique el esquema y arranque:

```bash
npm run migrar
npm run dev
```

La plataforma queda disponible en `http://localhost:8080`. Las variables de `.env` se describen en
el [manual de procedimientos](docs/manual.md#2-variables-de-entorno).

| Configuración | Comportamiento |
| --- | --- |
| Sin llaves de Clerk | **Acceso cerrado.** No se puede entrar ni seleccionar un rol localmente. |
| Con llaves de Clerk | Inicio de sesión real, rol asignado por el servidor, datos en PostgreSQL y conexión con Moodle e INFOP. |

Todo cambio pasa por la compuerta de calidad antes de integrarse:

```bash
npm run verificar
```

Antes de dirigir tráfico a una versión nueva, se comprueba el entorno real al que se publica
(configuración, cifrado de la conexión, rol sin privilegios y versión del esquema):

```bash
npm run comprobar:despliegue
```

Las presentaciones a clientes usan una cuenta real de Clerk con datos de una institución de
demostración. No existe un formulario alternativo para omitir la autenticación. El nombre de la
bienvenida procede de la sesión verificada y el recorrido guiado explica las herramientas del perfil.

El despliegue incluye balanceador, dos instancias web, cuotas compartidas en PostgreSQL y respaldos
programados. La aplicación usa un rol de base de datos sin privilegios de administración.
Véase [operación y recuperación](docs/operacion.md) para configurar y verificar el despliegue real.

---

## 4. Despliegue

```bash
cp .env.example .env
docker compose up -d --build
```

Al arrancar, el contenedor aplica las migraciones de `database/migraciones/` y después inicia el
servidor en el puerto `8080`. En producción se publica detrás de un proxy inverso con HTTPS.

La vista web estática se publica en GitHub Pages desde `public/`.

---

## 5. Documentación

* [Manual de procedimientos](docs/manual.md): entorno, variables, verificación, estilo del código,
  archivos derivados y despliegue.
