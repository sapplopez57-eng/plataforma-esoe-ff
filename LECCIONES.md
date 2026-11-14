# Lecciones aprendidas

Cada error real del proyecto: qué pasó, por qué y la regla que evita repetirlo. Se lee al empezar
cada vuelta del [ciclo](docs/LOOP_DE_DESARROLLO.md). Las entradas nuevas van arriba.

Formato: **Qué pasó** · **Causa raíz** · **Corrección** · **Regla**.

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
