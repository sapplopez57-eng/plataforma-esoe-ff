'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { antesDeConfirmar, revisarMensaje, antesDePublicar, esPrivado } = require('../scripts/guardia');

const HERRAMIENTA = ['Cla', 'ude'].join('');
const LLAVE = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('');
const CERO = '0'.repeat(40);

function repositorio(t) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'guardia-'));
  t.after(() => fs.rmSync(raiz, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: raiz, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Prueba');
  git('config', 'user.email', 'prueba@example.org');
  git('config', 'core.hooksPath', path.join(raiz, 'sin-ganchos'));
  const escribir = (ruta, texto) => {
    fs.writeFileSync(path.join(raiz, ruta), texto);
    git('add', '-f', '--', ruta);
  };
  return { raiz, git, escribir };
}

test('guardia: reconoce archivos privados sin afectar el ejemplo de entorno', () => {
  for (const ruta of ['.env', 'a/.env.local', 'llave.pem', 'sesion.jsonl', 'docs/transcripcion.md']) assert.equal(esPrivado(ruta), true, ruta);
  for (const ruta of ['.env.example', 'src/app.js', 'docs/manual.md']) assert.equal(esPrivado(ruta), false, ruta);
});

test('guardia: retira archivos privados y comentarios antes de confirmar', (t) => {
  const { raiz, git, escribir } = repositorio(t);
  escribir('.env', 'A=1\n');
  escribir('a.js', "'use strict';\n// nota\nmodule.exports = 1;\n");
  const { correcciones, problemas } = antesDeConfirmar(raiz);
  assert.deepEqual(problemas, []);
  assert.equal(correcciones.length, 2);
  assert.equal(git('diff', '--cached', '--name-only').trim(), 'a.js');
  assert.equal(git('show', ':a.js').includes('nota'), false);
  assert.equal(fs.existsSync(path.join(raiz, '.env')), true);
});

test('guardia: no reescribe un archivo preparado a medias', (t) => {
  const { raiz, escribir } = repositorio(t);
  escribir('a.js', '// nota\nmodule.exports = 1;\n');
  fs.appendFileSync(path.join(raiz, 'a.js'), 'module.exports = 2;\n');
  const { problemas } = antesDeConfirmar(raiz);
  assert.equal(problemas.length, 1);
  assert.match(fs.readFileSync(path.join(raiz, 'a.js'), 'utf8'), /nota/);
});

test('guardia: bloquea llaves y nombres de herramientas', (t) => {
  const { raiz, escribir } = repositorio(t);
  escribir('a.js', `module.exports = ['${LLAVE}', '${HERRAMIENTA}'];\n`);
  const { problemas } = antesDeConfirmar(raiz);
  assert.equal(problemas.length, 2);
  assert.equal(problemas.join('\n').includes(LLAVE), false);
});

test('guardia: limpia firmas del mensaje y bloquea menciones en el cuerpo', (t) => {
  const { raiz } = repositorio(t);
  const archivo = path.join(raiz, 'MENSAJE');
  fs.writeFileSync(archivo, `Corrige limites\n\nCo-Authored-By: ${HERRAMIENTA} <a@example.org>\n${HERRAMIENTA}-Session: x\n`);
  const limpio = revisarMensaje(raiz, archivo);
  assert.deepEqual(limpio.problemas, []);
  assert.equal(fs.readFileSync(archivo, 'utf8'), 'Corrige limites\n');
  fs.writeFileSync(archivo, `Ajustes hechos con ${HERRAMIENTA}\n`);
  assert.equal(revisarMensaje(raiz, archivo).problemas.length, 1);
});

test('guardia: detecta una llave que quedo en el historial aunque despues se borre', (t) => {
  const { raiz, git, escribir } = repositorio(t);
  escribir('a.txt', `${LLAVE}\n`);
  git('commit', '-qm', 'Agrega');
  escribir('a.txt', 'limpio\n');
  git('commit', '-qm', 'Limpia');
  const punta = git('rev-parse', 'HEAD').trim();
  const { problemas } = antesDePublicar(raiz, `refs/heads/main ${punta} refs/heads/main ${CERO}\n`);
  assert.equal(problemas.length, 1);
  assert.match(problemas[0], /AWS/);
});

test('guardia: los ganchos se ejecutan desde git', (t) => {
  const { raiz, git, escribir } = repositorio(t);
  for (const carpeta of ['scripts', '.githooks']) fs.cpSync(path.join(__dirname, '..', carpeta), path.join(raiz, carpeta), { recursive: true });
  fs.symlinkSync(path.join(__dirname, '..', 'node_modules'), path.join(raiz, 'node_modules'), 'junction');
  git('config', 'core.hooksPath', '.githooks');
  escribir('a.txt', `${LLAVE}\n`);
  assert.throws(() => execFileSync('git', ['commit', '-qm', 'Agrega'], { cwd: raiz, stdio: 'pipe' }));
  escribir('a.txt', 'limpio\n');
  git('commit', '-qm', `Agrega\n\nCo-Authored-By: ${HERRAMIENTA} <a@example.org>`);
  assert.equal(git('log', '-1', '--format=%B').trim(), 'Agrega');
});
