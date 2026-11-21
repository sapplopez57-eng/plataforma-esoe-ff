'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { tipoDe, quitarComentarios, buscarComentarios, buscarTerminos, buscarRutas, revisarRama, huella } = require('../scripts/estilo');

test('estilo: reconoce el tipo de cada archivo', () => {
  assert.equal(tipoDe('src/app.js'), 'js');
  assert.equal(tipoDe('public/css/styles.css'), 'css');
  assert.equal(tipoDe('database/migraciones/0001.sql'), 'sql');
  assert.equal(tipoDe('public/index.html'), 'marcado');
  assert.equal(tipoDe('public/img/escudo.svg'), 'marcado');
  assert.equal(tipoDe('.github/workflows/ci.yml'), 'numeral');
  assert.equal(tipoDe('Dockerfile'), 'numeral');
  assert.equal(tipoDe('.env.example'), 'numeral');
  assert.equal(tipoDe('README.md'), 'markdown');
  assert.equal(tipoDe('LICENSE.txt'), null);
});

test('estilo: JS conserva cadenas, plantillas y expresiones regulares', () => {
  const fuente = [
    "'use strict';",
    '',
    '// encabezado',
    '// de dos lineas',
    '',
    'const a = "// no es comentario";',
    "const b = '/* tampoco */';",
    'const c = `/* ni ${a} esto */`;',
    'const r = /\\/\\/x/g;',
    'try { f(); } catch { /* nada */ }',
    'g(); // al final',
    'h(/* en medio */1);',
    ''
  ].join('\n');
  const esperado = [
    "'use strict';",
    '',
    'const a = "// no es comentario";',
    "const b = '/* tampoco */';",
    'const c = `/* ni ${a} esto */`;',
    'const r = /\\/\\/x/g;',
    'try { f(); } catch {}',
    'g();',
    'h(1);',
    ''
  ].join('\n');
  assert.equal(quitarComentarios(fuente, 'js'), esperado);
  assert.deepEqual(buscarComentarios(esperado, 'js'), []);
});

test('estilo: JS conserva el shebang y separa tokens que quedarian pegados', () => {
  assert.equal(quitarComentarios('#!/usr/bin/env node\nconst a = typeof/**/b;\n', 'js'), '#!/usr/bin/env node\nconst a = typeof b;\n');
});

test('estilo: CSS respeta las cadenas', () => {
  const fuente = '/* titulo */\n.a { content: "/* x */"; color: red; } /* fin */\n';
  assert.equal(quitarComentarios(fuente, 'css'), '.a { content: "/* x */"; color: red; }\n');
});

test('estilo: SQL respeta cadenas, identificadores y bloques con dolar', () => {
  const fuente = [
    '-- tabla',
    "CREATE TABLE t (a TEXT DEFAULT '--no', \"b--c\" INT); -- fin",
    'CREATE FUNCTION f() RETURNS void AS $$ BEGIN -- dentro\nEND $$ LANGUAGE plpgsql;',
    '/* bloque /* anidado */ sigue */',
    'SELECT 1;',
    ''
  ].join('\n');
  const limpio = quitarComentarios(fuente, 'sql');
  assert.match(limpio, /DEFAULT '--no', "b--c" INT\);\n/);
  assert.match(limpio, /BEGIN -- dentro\nEND \$\$/);
  assert.doesNotMatch(limpio, /tabla|fin|bloque|sigue/);
  assert.deepEqual(buscarComentarios(limpio, 'sql'), []);
});

test('estilo: marcado y archivos con numeral', () => {
  assert.equal(quitarComentarios('<div>\n  <!-- nota -->\n  <p>x</p>\n</div>\n', 'marcado'), '<div>\n  <p>x</p>\n</div>\n');
  assert.equal(quitarComentarios('#!/usr/bin/env bash\n# nota\nset -e\n  # otra\necho "#1"\n', 'numeral'), '#!/usr/bin/env bash\nset -e\necho "#1"\n');
});

test('estilo: no deja lineas en blanco dobles donde habia comentarios', () => {
  assert.equal(quitarComentarios('a();\n\n// uno\n\nb();\n', 'js'), 'a();\n\nb();\n');
  assert.equal(quitarComentarios('// uno\n\na();\n', 'js'), 'a();\n');
});

test('estilo: detecta terminos por su huella, sin escribirlos en el codigo', () => {
  const terminos = new Set([huella('palabraprohibida'), huella('dos palabras')]);
  const hallazgos = buscarTerminos('linea limpia\nesta tiene PalabraProhibida\nY aqui dos-palabras juntas', terminos);
  assert.deepEqual(hallazgos.map((h) => h.linea), [2, 3]);
  assert.deepEqual(buscarTerminos('nada que ver', terminos), []);
});

test('estilo: detecta rutas no permitidas', () => {
  const rutas = new Set([huella('.oculta')]);
  assert.deepEqual(buscarRutas('src/.oculta/x.js', rutas), ['.oculta']);
  assert.deepEqual(buscarRutas('src/visible/x.js', rutas), []);
});

test('estilo: rechaza ramas con nombre generado automaticamente', () => {
  assert.equal(revisarRama('equipo/sweet-babbage-chgwxt').length, 1);
  assert.deepEqual(revisarRama('configuracion-inicial'), []);
  assert.deepEqual(revisarRama('main'), []);
});

test('estilo: bloques de codigo en Markdown', () => {
  const fuente = [
    '# Titulo',
    '',
    '```bash',
    'cp a b    # nota',
    'echo "#no" \'#tampoco\'',
    '```',
    '',
    '```js',
    'f(); // nota',
    '```',
    ''
  ].join('\n');
  const limpio = quitarComentarios(fuente, 'markdown');
  assert.equal(limpio, ['# Titulo', '', '```bash', 'cp a b', 'echo "#no" \'#tampoco\'', '```', '', '```js', 'f();', '```', ''].join('\n'));
  assert.deepEqual(buscarComentarios(limpio, 'markdown'), []);
});
