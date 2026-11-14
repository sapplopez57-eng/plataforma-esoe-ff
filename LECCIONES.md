# Lecciones aprendidas

Cada error real del proyecto: qué pasó, por qué y la regla que evita repetirlo. Se lee al empezar
cada vuelta del [ciclo](docs/LOOP_DE_DESARROLLO.md). Las entradas nuevas van arriba.

Formato: **Qué pasó** · **Causa raíz** · **Corrección** · **Regla**.

---

## 2026-11-14 — Vuelta 1

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
