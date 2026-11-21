'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const FUENTE = path.join(RAIZ, 'interfaz', 'campus3d');
const plano = () => import(path.join(FUENTE, 'plano.js'));

test('campus3d: el plano es el mismo en cada visita', async () => {
  const { contorno, azar, arboles } = await plano();
  assert.deepEqual(contorno(15.5, 13.2), contorno(15.5, 13.2));
  assert.equal(contorno(15.5, 13.2).length, 72);
  const a = azar(4);
  const b = azar(4);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  assert.deepEqual(arboles(), arboles());
});

test('campus3d: ningun arbol cae sobre un edificio, la plaza, el camino o la torre', async () => {
  const { arboles, EDIFICIOS, PLAZA, TORRE, ANILLO } = await plano();
  const lista = arboles();
  assert.equal(lista.length, 72);
  for (const { x, y } of lista) {
    for (const e of Object.values(EDIFICIOS)) {
      assert.ok(!(x > e.x - 0.5 && x < e.x + e.w + 0.5 && y > e.y - 0.5 && y < e.y + e.d + 0.5), `arbol en edificio (${x}, ${y})`);
    }
    assert.ok(!(x > PLAZA.x && x < PLAZA.x + PLAZA.w && y > PLAZA.y && y < PLAZA.y + PLAZA.d), 'arbol en la plaza');
    assert.ok(Math.hypot(x - TORRE.x, y - TORRE.y) > 0.8, 'arbol en la torre');
    const d = Math.hypot(x / ANILLO.rx, y / ANILLO.ry);
    assert.ok(d <= 0.9 || d >= 1.1, 'arbol sobre el camino');
  }
});

test('campus3d: cada punto numerado de la pagina tiene su ancla en el plano', async () => {
  const { anclas } = await plano();
  const html = fs.readFileSync(path.join(RAIZ, 'public', 'index.html'), 'utf8');
  const enPagina = [...html.matchAll(/<li class="punto" data-punto="([a-z]+)"/g)].map((m) => m[1]).sort();
  assert.equal(enPagina.length, 8);
  assert.deepEqual(enPagina, Object.keys(anclas()).sort());
});

test('campus3d: todos los colores de la escena salen de variables de :root', () => {
  const css = fs.readFileSync(path.join(RAIZ, 'public', 'css', 'styles.css'), 'utf8');
  const raiz = css.slice(css.indexOf(':root'), css.indexOf('\n}', css.indexOf(':root')));
  const usadas = new Set();
  for (const archivo of ['entrada.js', 'plano.js']) {
    const fuente = fs.readFileSync(path.join(FUENTE, archivo), 'utf8');
    for (const m of fuente.matchAll(/'(--[a-z0-9-]+)'/g)) usadas.add(m[1]);
  }
  assert.ok(usadas.size >= 10);
  const faltan = [...usadas].filter((v) => !new RegExp(`${v}\\s*:`).test(raiz));
  assert.deepEqual(faltan, [], 'variables que la escena lee y :root no define');
});

test('campus3d: el archivo servido esta compilado de la fuente actual', async () => {
  const esbuild = require('esbuild');
  const resultado = await esbuild.build({
    entryPoints: [path.join(FUENTE, 'entrada.js')],
    bundle: true, format: 'esm', minify: true, target: 'es2020', legalComments: 'eof', write: false, logLevel: 'silent'
  });
  const servido = fs.readFileSync(path.join(RAIZ, 'public', 'vendor', 'campus3d.js'), 'utf8');
  assert.equal(resultado.outputFiles[0].text, servido, 'ejecute: npm run construir:campus');
  assert.match(servido, /MIT License|three\.js/i, 'conserva la licencia de Three.js');
});
