# Lecciones aprendidas

Cada error real del proyecto: qué pasó, por qué y la regla que evita repetirlo. Se lee al empezar
cada vuelta del [ciclo](docs/LOOP_DE_DESARROLLO.md). Las entradas nuevas van arriba.

Formato: **Qué pasó** · **Causa raíz** · **Corrección** · **Regla**.

---

## 2026-11-16 — Comparación con Harvard, UNAH, INFOP y TecNM

### L-030 · Una escala tipográfica en píxeles no obedece al tamaño de letra que eligió la persona

- **Qué pasó:** la escala `--fs-*` estaba en `px`. Quien sube el tamaño de letra en su navegador (o
  quien necesita texto más grande, como ofrece la UNAH con sus «opciones de accesibilidad visual»)
  veía la plataforma igual que siempre.
- **Causa raíz:** el `px` es absoluto; solo el `rem` sigue al tamaño base del documento. La prueba
  de identidad fijaba `16px` como valor esperado, así que también protegía el error.
- **Corrección:** la escala pasó a `rem` (con la base del navegador da los mismos 12 a 56 px), se
  agregó el control «Tamaño del texto» (100 %, 112,5 %, 125 %) y una prueba que exige `rem`.
- **Regla:** los tamaños de letra van en `rem`. Una prueba que fija un valor fija también la unidad:
  revisarla cuando cambia el criterio.

### L-029 · La regla de regiones con nombre se comprobaba solo en la aplicación, no en el acceso

- **Qué pasó:** REA midió la pantalla de acceso con la misma vara que a los sitios de referencia y
  encontró **cero** regiones: ni `banner` ni `main`. Harvard tiene ocho, todas con nombre; el Campus
  Virtual de la UNAH, tres. Un lector de pantalla no tenía a dónde saltar.
- **Causa raíz:** la regla 19 se aplicó a la aplicación (vuelta 7) y nadie midió la otra pantalla.
  El acceso era un `<section>` con dos `<div>`.
- **Corrección:** el panel institucional es `<header>` y el formulario es `<main>` con nombre. Como
  hay dos pantallas, `mostrarPantalla()` deja un solo `<main>` sin `hidden`. Lo comprueba
  `tests/estructura.test.js`, que además ejecuta `lectura.js` de verdad.
- **Regla:** una regla de estructura se mide en **todas** las pantallas, con una herramienta, no a
  ojo. Toda pantalla tiene `banner` y un solo `main` visible.

## 2026-11-16 — Paleta de las páginas internas

### L-027 · Una prueba que lee el primer bloque que encuentra puede medir el ámbito equivocado y pasar

- **Qué pasó:** al medir el contraste de la paleta interna, la prueba buscó `.app-shell {` y encontró
  primero la regla de maquetación (`display: flex`), que no redefine ningún color. Sin una comprobación
  extra habría medido dos veces la paleta del acceso y aprobado una paleta que nunca miró.
- **Corrección:** la prueba junta las variables de todas las reglas cuya lista de selectores incluye
  `.app-shell`, y antes exige que el ámbito interno sea de verdad distinto del de `:root`. Esa exigencia
  fue lo que atrapó el error.
- **Regla:** una prueba que compara dos cosas comprueba primero que son dos cosas distintas.

### L-028 · Un par de colores que nadie anotó no lo mide ninguna prueba

- **Qué pasó:** las iniciales del usuario en el menú son texto índigo sobre el acento vivo. Con el
  naranja de marca daban 4.44:1. El par no estaba en la lista de contraste, así que la prueba pasaba.
  Lo encontró la revisión manual de dónde se usaba cada variable.
- **Corrección:** el acento vivo interno usa el naranja que llega a 4.63:1, y el par quedó en la lista.
- **Regla:** al introducir una paleta, se recorre cada uso de cada variable de color y se anota todo
  par que lleve texto. La lista de la prueba es tan buena como ese recorrido.

## 2026-11-16 — Migraciones

### L-025 · Un esquema que solo se aplica al crear el volumen nunca llega a una base existente

- **Qué pasó:** `docker-compose.yml` montaba `schema.sql` en `docker-entrypoint-initdb.d`. PostgreSQL
  solo ejecuta esa carpeta cuando el volumen está vacío. Las tablas `plataformas_externas` y
  `cuentas_externas` (vuelta 3) nunca habrían llegado a una base creada antes: el manual ya lo
  advertía, pero nada lo impedía.
- **Causa raíz:** el esquema se trataba como un archivo que se carga una vez, no como una historia
  de cambios con registro de qué tiene cada base.
- **Corrección:** migraciones numeradas con registro y huella, aplicadas al arrancar el contenedor. Las
  bases viejas se adoptan sin reaplicar.
- **Regla:** todo cambio de esquema es una migración nueva. Una migración aplicada no se edita.

### L-026 · Una transacción por el pool de conexiones puede quedar partida sin que nada falle

- **Qué pasó:** al diseñar el migrador, lo natural era reutilizar la conexión de la aplicación
  (`db.consultar`), que es un pool.
- **Causa raíz:** con un pool, cada consulta puede salir por una conexión distinta: `BEGIN` por una,
  el cambio por otra y `COMMIT` por una tercera. La "transacción" no protege nada y no avisa.
- **Corrección:** el migrador exige un cliente de una sola conexión. La prueba de concurrencia se
  verificó quitando el candado: sin él, falla.
- **Regla:** lo que tenga que ser atómico usa un cliente dedicado, nunca el pool.

## 2026-11-16 — Paleta azul y naranja

### L-023 · Cambiar la etiqueta de un elemento lo expone a las reglas escritas para la etiqueta nueva

- **Qué pasó:** para corregir el orden de títulos, el rótulo «PLATAFORMA ESOE» pasó de `<h1>` a `<p>`.
  Desapareció de la pantalla: una regla antigua, `.brand-title-group p { display: none }`, estaba
  escrita para ocultar un subtítulo y ahora alcanzaba también al rótulo.
- **Causa raíz:** se revisaron las reglas que apuntaban a la etiqueta vieja (`h1`), no las que
  apuntaban a la nueva (`p`) en el mismo contenedor.
- **Corrección:** la regla oculta solo `p:not(.marca-nombre)`. Lo detectó la captura de pantalla, no
  una prueba: ningún dato faltaba, solo algo visible.
- **Regla:** al cambiar la etiqueta de un elemento se buscan las reglas que apuntan a la etiqueta
  **nueva** dentro de su contenedor. Y todo cambio de interfaz se mira en una captura, además de
  pasar las pruebas.

### L-024 · Nombrar las variables por color obliga a renombrarlas cuando cambia la paleta

- **Qué pasó:** la paleta cambió de olivo a azul y naranja un día después de aplicarse. Con nombres
  como `--olivo-fuerte`, cada cambio de paleta es un renombrado por todo el repositorio, que es
  justo lo que produjo L-021.
- **Corrección:** las variables ahora se nombran por función (`--accion`, `--positivo`,
  `--negativo`...). La paleta del README vive en `--marca-1` … `--marca-5`, numeradas como en la
  muestra. Un próximo cambio solo toca valores.
- **Regla:** se nombra por lo que algo hace, no por cómo se ve hoy.

## 2026-11-16 — Identidad visual

### L-021 · Renombrar una variable de CSS no avisa: el estilo desaparece en silencio

- **Qué pasó:** al pasar la paleta de azul a la del README se renombraron las variables (`--ink` →
  `--texto`, `--sand-soft` → `--beige-suave`...). La hoja quedó bien, pero `app.js` tenía unos 30
  estilos en línea con los nombres viejos. Una variable inexistente no produce ningún error: el color
  cae en herencia y los fondos y bordes desaparecen. Las capturas parecían correctas.
- **Causa raíz:** se buscaron los usos solo en el archivo que se estaba cambiando. Las variables de CSS
  se consumen también desde JavaScript y HTML, y ninguna herramienta lo verifica por su cuenta.
- **Corrección:** estilos en línea migrados a los nombres nuevos y a la escala. `tests/identidad.test.js`
  comprueba que toda variable usada en la hoja, en `index.html` y en `public/js/` exista en `:root`;
  se verificó restaurando el `app.js` viejo, y falló nombrando `--ink` y `--stone`.
- **Regla:** al renombrar algo, se busca en todo el repositorio, no en el archivo abierto. Y una
  captura de pantalla no demuestra que un estilo esté aplicado: un fondo ausente sobre papel claro no
  se ve.

### L-022 · El nombre decía una cosa y el valor otra

- **Qué pasó:** `.badge-olive` (Aprobado) se pintaba azul, y `.badge-rust` (Reprobado) era texto negro
  tachado. `.btn-rust`, la acción de cierre, también era azul. Los nombres eran los de la paleta del
  README; los valores se habían cambiado por otros sin tocar los nombres.
- **Causa raíz:** la paleta vivía en dos sitios —el README y la hoja— y nada los comparaba.
- **Corrección:** una sola fuente, `:root`, y una prueba que compara la paleta de marca con la que
  declara el README.
- **Regla:** cuando un documento declara un valor que el código también usa, una prueba los compara.

## 2026-11-15 — Permisos por pertenencia

### L-019 · Un atrapatodo montado en el prefijo compartido se traga las rutas de los demás

- **Qué pasó:** las consultas académicas se montan en `/api` y, copiando el patrón de las
  integraciones, cuando faltaba la base de datos registraban `rutas.use(...)` para responder 503. Eso
  hizo que **cualquier** ruta desconocida de `/api` devolviera 503 en vez de 404, y rompió una prueba
  del servidor que ya existía.
- **Causa raíz:** el router de integraciones se monta en su propio prefijo (`/api/integraciones`), así
  que su atrapatodo solo alcanza lo suyo. El patrón se copió sin ver que la diferencia estaba en
  dónde se monta, no en el código copiado.
- **Corrección:** sin base de datos no se registra nada y responde el 404 general. Una prueba
  comprueba que `/api/lo-que-sea` sigue dando 404 en ese estado.
- **Regla:** un manejador de respaldo pertenece solo a un router montado en su propio prefijo. En el
  prefijo compartido se declaran rutas exactas. Al copiar un patrón se comprueba dónde se monta el
  original, no solo qué hace.

### L-020 · Un guardián anónimo se lee como un guardián ausente

- **Qué pasó:** la prueba que recorre las rutas registradas señaló cuatro rutas de integraciones como
  desprotegidas. Sí estaban protegidas, con `exigirRol`, pero esa función devolvía una flecha anónima
  y la comprobación solo ve el nombre de cada manejador.
- **Causa raíz:** el permiso estaba bien; lo que faltaba era poder comprobarlo desde fuera.
- **Corrección:** los middlewares que devuelven `exigirRol`, `exigirClasePropia` y
  `exigirEstudiantePropio` llevan nombre (`guardianDeRol`, `guardianDe...`), que además aparece en las
  trazas de error. La comprobación exige ese nombre.
- **Regla:** lo que tiene que ser verificable desde fuera lleva nombre. Se prefiere aflojar el código
  a aflojar la comprobación: bajar el listón de la prueba habría dejado pasar también a las rutas
  realmente desprotegidas.

## 2026-11-15 — Cierre de SEC-03

### L-018 · Un elemento se cierra con una comprobación, no con una lectura

- **Qué pasó:** SEC-03 (escapar los datos mostrados) se dio por resuelto tras recorrer el código y
  envolver 89 interpolaciones en `esc()`. Al revisarlo con una comprobación automática quedaban: una
  interpolación en atributo sin escapar (`value="${fecha}"`), 26 identificadores interpolados en
  atributos sin escapar, y dos textos del menú. Además el backlog seguía diciendo `Pendiente`.
- **Causa raíz:** el criterio de aceptación pedía una prueba de navegador y se sustituyó por una
  inspección manual. Una inspección cubre lo que el ojo alcanza en una pasada y no deja nada que
  falle después: el escape se puede deshacer sin que nadie se entere.
- **Corrección:** `tests/escape.test.js` con dos niveles. Uno comprueba que `esc()` neutraliza el
  dato del criterio (`<img src=x onerror=alert(1)>`) y los cinco caracteres de escape. El otro
  recorre las plantillas de la interfaz, se queda solo con las que producen HTML, y falla nombrando
  archivo y línea si alguna interpola un dato sin escapar. Un tercer caso comprueba que el guardián
  **falla cuando debe**, para que no quede una comprobación que siempre pasa.
- **Regla:** mientras no exista la comprobación que falla, el elemento sigue `Pendiente`, por mucho
  que el código ya esté escrito. Es la misma causa de L-016 vista desde el otro lado, así que pasa a
  ser regla permanente.

## 2026-11-15 — Publicación del código

### L-015 · La interfaz interpolaba datos de personas en `innerHTML` sin escapar

- **Qué pasó:** una auditoría de seguridad encontró que `public/js/app.js` insertaba nombres, DNI, correos y
  códigos directamente en las plantillas HTML. El ayudante `esc()` existía en `sesion.js`, pero `app.js` no lo usaba.
- **Causa raíz:** el escape se aplicó solo a los módulos nuevos (`integraciones.js`); la interfaz original quedó sin migrar.
  Con datos importados de Moodle o INFOP, un nombre con HTML se habría ejecutado en el navegador de otros usuarios.
- **Corrección:** 89 interpolaciones de datos de usuario pasan por `esc()`. Se omiten los ids generados por la
  aplicación, los filtros y los avisos que usan `textContent` (escaparlos duplicaría las entidades).
  Verificado en un DOM real con un nombre malicioso: antes 14 elementos inyectados, después 0.
- **Regla:** al agregar un ayudante de seguridad, se busca todo el código que debía usarlo antes de cerrar la vuelta.
- **Cierre de SEC-04 (misma vuelta):** los manejadores en línea pasaron a `data-on-*` con un despachador de gramática
  cerrada y la CSP quedó con `script-src-attr 'none'`. Una prueba que recorre todos los `data-on-*` detectó 6
  manejadores compuestos que un listado recortado con `head` había ocultado: las comprobaciones deben cubrir el
  conjunto completo, no una muestra.

### L-016 · Una regla escrita en prosa no protege nada

- **Qué pasó:** el manual decía desde la primera vuelta que un respaldo del repositorio (`*.bundle`)
  nunca se versiona, y que la configuración de herramientas locales se queda fuera. El `.gitignore`
  no cubría ninguno de los dos. Durante tres vueltas nadie lo notó porque nunca hizo falta.
- **Causa raíz:** la regla vivía en un documento que se lee, no en una comprobación que falla. Se
  habría cumplido solo mientras nadie dejara un `.bundle` en la carpeta del proyecto.
- **Corrección:** `*.bundle` y las carpetas de herramientas locales, fuera del repositorio, y la comprobación incorporada al
  preflight que corre antes de cada commit, donde falla sola.
- **Regla:** toda regla que se pueda comprobar con un comando se convierte en ese comando. Si solo
  existe como prosa, se cumple por suerte.

### L-017 · Dos ramas de trabajo en paralelo se pisan en el número de la lección

- **Qué pasó:** dos ramas de trabajo añadieron a la vez una lección numerada `L-015`. Al unirlas, el
  conflicto no fue de contenido sino de identificador.
- **Causa raíz:** el número se elige leyendo el último del archivo, y dos ramas que salen del mismo
  punto leen el mismo último.
- **Corrección:** se conservan las dos lecciones y se renumera la que llega después.
- **Regla:** al rebasar, antes de resolver un conflicto de este registro se comprueba que no haya dos
  entradas con el mismo número; el identificador se asigna al unir, no al escribir.

### L-013 · El repositorio de destino no acepta escrituras; el fork sí

- **Qué pasó:** `git push` a `oacoello/plataforma-esoe` devolvía 403 en cada intento, con la rama y
  los commits correctos.
- **Causa raíz:** el permiso de escritura no depende del colaborador sino de dónde está instalada la
  aplicación de GitHub que firma la conexión. Estaba instalada en `sapplopez57-eng`, no en
  `oacoello`, así que ninguna llave personal cambiaba el resultado.
- **Corrección:** se trabaja contra el fork `sapplopez57-eng/plataforma-esoe-ff`, donde la escritura
  sí está concedida, y el trabajo llega al repositorio de destino por solicitud de cambio.
- **Regla:** antes de dar un 403 por falta de permisos del usuario, comprobar en qué cuenta está
  instalada la aplicación; se escribe en el repositorio que la tiene y se integra por solicitud de
  cambio.

### L-014 · Dos ramas con el mismo objetivo dejan documentación duplicada

- **Qué pasó:** la rama de la solicitud de cambio traía `docs/LECCIONES.md` y `docs/MANUAL.md`, que
  describían una superficie pública (`server.js`, `/css`, `/js`) que esta rama ya había reemplazado
  por `src/` y `public/`.
- **Causa raíz:** el mismo objetivo se resolvió dos veces por separado; al unir las dos historias,
  los archivos que no chocaban línea a línea sobrevivieron los dos.
- **Corrección:** se conserva un solo registro (`LECCIONES.md`) y un solo manual
  (`docs/MANUAL_DE_PROCEDIMIENTOS.md`); las lecciones útiles del duplicado se trasladaron aquí.
- **Regla:** al unir ramas con el mismo objetivo, revisar los archivos añadidos por ambas, no solo
  los conflictos: un documento obsoleto que nadie contradice es peor que un conflicto.

---

## 2026-11-14 — Configuración de Clerk

### L-012 · `clerk init` no se ejecuta sobre un proyecto que ya integra Clerk
- **Qué pasó:** la guía oficial empieza por `npx clerk init`. Aquí habría sido un error: la
  integración ya existe y `init` puede crear otra aplicación y sobrescribir las llaves del
  proyecto. La propia guía lo advierte para proyectos que ya usan Clerk.
- **Regla:** con Clerk ya integrado, solo se completan las llaves; nunca se ejecuta `init`.
  Además, la guía del panel asume Next.js: este proyecto es Express con interfaz propia, así que
  manda el proyecto, no la plantilla.

### L-011 · El inicio de sesión del CLI de Clerk no puede completarse desde el contenedor
- **Qué pasó:** `clerk auth login` quedó esperando indefinidamente.
- **Causa raíz:** el CLI abre un servidor en `127.0.0.1` **dentro del contenedor** y espera que el
  navegador lo llame de vuelta. El navegador del usuario está en otra máquina, así que esa llamada
  nunca llega. Sin sesión del CLI tampoco funcionan `link`, `env pull` ni `doctor` completo.
- **Corrección:** las llaves se copian del panel de Clerk y se escriben en `.env`.
- **Regla:** una herramienta que se autentica por navegador contra `localhost` solo funciona en la
  máquina del usuario. Desde el contenedor se configura por llaves, no por sesión interactiva.

---

## 2026-11-14 — Vueltas 2 y 3

### L-010 · La pantalla de acceso se desbordaba en teléfonos
- **Qué pasó:** a 360 px de ancho la página medía 401 px y aparecía desplazamiento horizontal. El
  defecto venía del prototipo; lo destapó la primera comprobación a ancho de teléfono.
- **Causa raíz:** una columna de rejilla `1fr` no puede encogerse por debajo de su contenido, y el
  titular de 38 px contenía una palabra más ancha que la pantalla.
- **Corrección:** `minmax(0, 1fr)` y titular más pequeño con corte de palabra.
- **Regla:** toda vuelta que toque la interfaz se comprueba a 360 px, como pide la definición de
  terminado. En rejillas de una columna, `minmax(0, 1fr)`.

### L-009 · Un título de ventana salía con entidades HTML visibles
- **Qué pasó:** se escapó un nombre antes de pasarlo a una función que ya lo inserta como texto.
- **Causa raíz:** escapar sin mirar cómo se inserta el valor en el destino.
- **Regla:** se escapa una sola vez y en el punto donde el dato se convierte en HTML.

### L-008 · PostgreSQL local detenido a mitad de la sesión
- **Qué pasó:** ocho pruebas fallaron con `ECONNREFUSED 127.0.0.1:5432`.
- **Causa raíz:** el servicio de base de datos del entorno de trabajo se había detenido; el código
  no tenía ningún defecto.
- **Regla:** ante un fallo masivo y repentino de pruebas, comprobar primero que los servicios de
  los que dependen están arriba (`pg_lsclusters`).

### L-007 · Clerk rechazaba sesiones bien firmadas en las pruebas
- **Qué pasó:** el SDK respondía `token-type-mismatch` a un token con firma y fechas correctas.
- **Causa raíz:** el SDK distingue los tokens de sesión por un campo `cat` en la cabecera del token,
  que no aparece en la guía de inicio. Se halló leyendo el código del SDK instalado.
- **Corrección:** las sesiones de prueba llevan esa categoría.
- **Regla:** cuando una biblioteca se comporta distinto de lo documentado, se lee su código
  instalado antes de suponer; no se rodea la verificación con un sustituto hecho a mano.

---

## 2026-11-14 — Vuelta 1

### L-006 · `git add -A` incluyó archivos generados por una herramienta local
- **Qué pasó:** un commit arrastró una carpeta `vault/` creada por un gancho local de pre-commit,
  ajena al proyecto. Se detectó al leer el resumen del commit, antes de subirlo.
- **Causa raíz:** preparar el commit con `git add -A` sin revisar qué había de nuevo en la carpeta.
- **Corrección:** se retiró del commit y la carpeta quedó en `.gitignore`.
- **Regla:** preparar los commits por ruta explícita y leer `git status` antes de confirmar.

### L-005 · Una ruta comodín convertía los errores en respuestas 200
- **Qué pasó:** la prueba que exige 404 para archivos internos falló con `/Dockerfile` y `/.env`:
  respondían 200.
- **Causa raíz:** un `app.get('*')` devolvía la página principal para cualquier ruta sin extensión.
  No filtraba contenido, pero ocultaba los 404 reales y la interfaz ni siquiera usa rutas propias.
- **Corrección:** se eliminó el comodín; lo que no existe responde 404.
- **Regla:** no añadir rutas comodín "por si acaso". Un 404 debe ser un 404.

### L-004 · `node --test tests/` no ejecuta la carpeta
- **Qué pasó:** en Node 22 el comando falló con `Cannot find module '.../tests'`.
- **Causa raíz:** el ejecutor trata el argumento como un archivo, no como un directorio.
- **Corrección:** `node --test "tests/*.test.js"`.
- **Regla:** pasar siempre un patrón entre comillas al ejecutor de pruebas.

### L-003 · `npm pkg set` con varios pares y `--json`
- **Qué pasó:** `Unexpected token 'e', "eslint ." is not valid JSON`, y el `package.json` quedó a
  medio escribir.
- **Causa raíz:** con `--json` cada valor debe ser JSON válido; las cadenas sin comillas no lo son.
- **Corrección:** se reescribió el archivo completo con un script.
- **Regla:** tras modificar `package.json` con una herramienta, releerlo antes de continuar.

### L-002 · Secretos con valor por defecto en `docker-compose.yml`
- **Qué pasó:** el archivo daba a `DB_PASSWORD` y a `JWT_SECRET` un valor de reserva escrito en
  el propio archivo (sintaxis `:-` de Compose). Quien desplegara sin `.env` quedaba en producción con credenciales públicas.
- **Causa raíz:** comodidad para el primer arranque; un valor por defecto en un secreto es una
  credencial publicada.
- **Corrección:** `${VAR:?mensaje}` (falla si falta), validación al arrancar que rechaza valores
  ausentes, cortos o de ejemplo, y un analizador que detecta el patrón.
- **Regla:** un secreto nunca tiene valor por defecto. Si falta, el sistema no arranca.
- **Pendiente operativo:** los dos valores antiguos siguen en el historial de git. Si alguna
  instalación los usó, hay que cambiarlos allí.

### L-001 · El servidor publicaba todo el repositorio
- **Qué pasó:** `express.static(__dirname)` servía la raíz del proyecto: `server.js`,
  `package.json`, `docker-compose.yml` y `database/schema.sql` se podían descargar. Un `.env` en esa
  carpeta también habría quedado expuesto.
- **Causa raíz:** interfaz y servidor compartían carpeta.
- **Corrección:** la interfaz vive en `public/` y es lo único que se publica. Una prueba pide 15
  rutas internas y exige 404 en todas.
- **Regla:** lo público vive en una carpeta propia. Todo control de seguridad lleva una prueba que
  falla si se rompe.

---

## Reglas permanentes

1. Ningún secreto en el repositorio ni con valor por defecto. `.env` local, fuera de git.
2. Lo público vive en `public/`; nada más se sirve.
3. La interfaz no es una barrera de seguridad: permisos y validación van en el servidor.
4. Todo control de seguridad tiene su prueba automática.
5. Ninguna vuelta se cierra sin `npm run verificar` en verde, y no se desactiva una prueba para lograrlo.
6. Un error se investiga hasta la causa raíz y se corrige en la misma vuelta.
7. Las versiones de dependencias se comprueban contra el registro, no de memoria.
8. Los commits se preparan por ruta explícita, nunca con `git add -A` a ciegas.
9. Todo dato externo —del usuario o de otra plataforma— se escapa una vez, al convertirse en HTML.
10. El servidor nunca conecta con una dirección dada por un usuario sin validarla contra redes internas.
11. Las credenciales de terceros se guardan cifradas y las contraseñas de terceros no se guardan.
12. Toda regla que se pueda comprobar con un comando se convierte en ese comando. Un elemento se
    cierra cuando existe la comprobación que falla si se rompe, no cuando el código está escrito.
13. Toda comprobación nueva trae su propio caso que demuestra que falla cuando debe.
14. El rol dice qué clase de cosas puede hacer una cuenta; la pertenencia, sobre cuáles. Ninguna de
    las dos llega desde la interfaz, y un 403 por pertenencia no revela si el recurso existe.
15. Lo que tiene que ser verificable desde fuera lleva nombre. Antes de aflojar una comprobación se
    cambia el código para que pueda comprobarse.
16. Todo color y tamaño de letra sale de `:root`. Lo que lleva texto encima cumple 4.5:1, medido, no
    estimado a ojo.
17. Al renombrar algo se busca en todo el repositorio. Una captura no prueba que un estilo esté
    aplicado.
18. Las variables se nombran por función, no por color.
19. Toda navegación tiene nombre, la aplicación tiene enlace para saltar al contenido, y hay un solo
    `h1` visible por pantalla.
20. El esquema cambia solo con migraciones nuevas; una aplicada no se edita.
21. Lo que tenga que ser atómico usa un cliente de una conexión, nunca el pool.
22. Toda pantalla tiene `banner` y un solo `main` visible, medido con una herramienta.
23. Los tamaños de letra van en `rem`, para que sigan la preferencia de la persona.
