'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { tipoDe, quitarComentarios, buscarComentarios, buscarTerminos, buscarRutas, revisarRama } = require('./estilo');
const { revisarContenido } = require('./buscar-secretos');

const VACIO = /^0+$/;
const PRIVADOS = [
  /(^|\/)\.env(\.(?!example$)[^/]+)?$/i,
  /\.(pem|key|p12|pfx)$/i,
  /\.jsonl$/i,
  /(^|\/)[^/]*(conversacion|transcripcion|transcript|chat[-_ ]?export|historial[-_ ]?chat)[^/]*\.(md|txt|json|html)$/i
];
const SIN_COMENTARIOS = [/^public\/vendor\//, /^public\/fonts\//];
const SIN_TERMINOS = [/^package-lock\.json$/];
const FIRMA = /^\s*([A-Za-z]+(-[A-Za-z]+)*-(by|session)\s*:|\W*generated\s+(with|by)\b)/i;

function git(raiz, args) {
  return execFileSync('git', args, { cwd: raiz, maxBuffer: 256 * 1024 * 1024 });
}

function lista(raiz, args) {
  return git(raiz, args).toString('utf8').split('\0').filter(Boolean);
}

function esPrivado(ruta) {
  return PRIVADOS.some((p) => p.test(ruta)) || buscarRutas(ruta).length > 0;
}

function revisarTexto(ruta, contenido) {
  const problemas = revisarContenido(ruta, contenido);
  if (contenido.includes(0) || SIN_TERMINOS.some((p) => p.test(ruta))) return problemas;
  for (const { linea } of buscarTerminos(contenido.toString('utf8'))) problemas.push(`${ruta}:${linea}  termino no permitido`);
  return problemas;
}

function ejecutarEslint(raiz, args) {
  const binario = path.join(raiz, 'node_modules', 'eslint', 'bin', 'eslint.js');
  if (!fs.existsSync(binario)) return { status: 1, salida: 'eslint no esta instalado: ejecute npm ci' };
  const r = spawnSync(process.execPath, [binario, ...args], { cwd: raiz, encoding: 'utf8' });
  return { status: r.status, salida: `${r.stdout || ''}${r.stderr || ''}`.trim() };
}

function antesDeConfirmar(raiz) {
  const correcciones = [];
  const problemas = [];
  const preparados = () => lista(raiz, ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']);

  for (const ruta of preparados().filter(esPrivado)) {
    git(raiz, ['reset', '-q', '--', ruta]);
    correcciones.push(`${ruta}: retirado del commit (se conserva en disco)`);
  }

  const archivos = preparados();
  const parciales = new Set(lista(raiz, ['diff', '--name-only', '-z']));
  const conLint = fs.existsSync(path.join(raiz, 'eslint.config.js'));
  const revisables = [];

  for (const ruta of archivos) {
    const tipo = tipoDe(ruta);
    if (!tipo || SIN_COMENTARIOS.some((p) => p.test(ruta))) continue;
    const absoluta = path.join(raiz, ruta);
    const indice = git(raiz, ['show', `:${ruta}`]).toString('utf8');
    let comentarios;
    try {
      comentarios = buscarComentarios(indice, tipo);
    } catch (error) {
      problemas.push(`${ruta}: error de sintaxis (${error.message})`);
      continue;
    }
    if (tipo === 'js' && conLint) revisables.push(ruta);
    if (comentarios.length === 0) continue;
    if (parciales.has(ruta)) {
      problemas.push(`${ruta}: tiene comentarios y cambios sin preparar; prepare el archivo completo`);
      continue;
    }
    fs.writeFileSync(absoluta, quitarComentarios(fs.readFileSync(absoluta, 'utf8'), tipo));
    git(raiz, ['add', '--', ruta]);
    correcciones.push(`${ruta}: comentarios retirados`);
  }

  const completos = revisables.filter((ruta) => !parciales.has(ruta));
  if (completos.length > 0) {
    const antes = completos.map((ruta) => fs.readFileSync(path.join(raiz, ruta), 'utf8'));
    ejecutarEslint(raiz, ['--fix', '--no-warn-ignored', '--', ...completos]);
    completos.forEach((ruta, i) => {
      if (fs.readFileSync(path.join(raiz, ruta), 'utf8') === antes[i]) return;
      git(raiz, ['add', '--', ruta]);
      correcciones.push(`${ruta}: corregido por eslint`);
    });
  }
  if (revisables.length > 0) {
    const r = ejecutarEslint(raiz, ['--no-warn-ignored', '--max-warnings=0', '--', ...revisables]);
    if (r.status !== 0) problemas.push(r.salida);
  }

  for (const ruta of preparados()) problemas.push(...revisarTexto(ruta, git(raiz, ['show', `:${ruta}`])));
  return { correcciones, problemas };
}

function revisarMensaje(raiz, archivo) {
  const destino = path.resolve(raiz, archivo);
  const lineas = fs.readFileSync(destino, 'utf8').split('\n');
  const corte = lineas.findIndex((l) => /^# -+ >8 -+/.test(l));
  const utiles = (corte === -1 ? lineas : lineas.slice(0, corte)).filter((l) => !l.startsWith('#'));
  const limpias = utiles.filter((l) => !(FIRMA.test(l) && buscarTerminos(l).length > 0));
  const correcciones = [];
  if (limpias.length !== utiles.length) {
    fs.writeFileSync(destino, `${limpias.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`);
    correcciones.push(`mensaje: ${utiles.length - limpias.length} firma(s) de herramienta retiradas`);
  }
  const texto = Buffer.from(limpias.join('\n'));
  const problemas = revisarTexto('mensaje', texto);
  return { correcciones, problemas };
}

function antesDePublicar(raiz, entrada) {
  const problemas = [];
  for (const linea of entrada.split('\n').filter(Boolean)) {
    const [, local, referencia, remoto] = linea.trim().split(/\s+/);
    if (!local || VACIO.test(local)) continue;
    problemas.push(...revisarRama(referencia.replace(/^refs\/(heads|tags)\//, '')));
    const conocido = !VACIO.test(remoto) && spawnSync('git', ['cat-file', '-e', `${remoto}^{commit}`], { cwd: raiz }).status === 0;
    const rango = conocido ? [`${remoto}..${local}`] : [local, '--not', '--remotes'];
    for (const hash of git(raiz, ['rev-list', ...rango]).toString('utf8').split('\n').filter(Boolean)) {
      const corto = hash.slice(0, 7);
      const ficha = git(raiz, ['show', '-s', '--format=%an <%ae>%n%cn <%ce>%n%B', hash]);
      problemas.push(...revisarTexto('mensaje', ficha).map((p) => `commit ${corto} ${p}`));
      const cambiados = lista(raiz, ['diff-tree', '--root', '--no-commit-id', '--name-only', '--diff-filter=ACMR', '-r', '-z', hash]);
      for (const ruta of cambiados) {
        if (esPrivado(ruta)) problemas.push(`commit ${corto} ${ruta}  archivo privado`);
        problemas.push(...revisarTexto(ruta, git(raiz, ['show', `${hash}:${ruta}`])).map((p) => `commit ${corto} ${p}`));
      }
    }
  }
  return { correcciones: [], problemas };
}

function verificarCodigo(raiz) {
  const problemas = [];
  const lint = ejecutarEslint(raiz, ['--max-warnings=0', '.']);
  if (lint.status !== 0) problemas.push(lint.salida);
  const env = Object.fromEntries(Object.entries(process.env).filter(([nombre]) => !nombre.startsWith('GIT_')));
  const pruebas = spawnSync(process.execPath, ['--test', 'tests/*.test.js'], { cwd: raiz, env, stdio: 'inherit' });
  if (pruebas.status !== 0) problemas.push('las pruebas fallaron');
  return problemas;
}

function informar({ correcciones, problemas }) {
  if (correcciones.length > 0) {
    console.error(`\nCorregido automaticamente (${correcciones.length}):`);
    correcciones.forEach((c) => console.error(`  ${c}`));
  }
  if (problemas.length > 0) {
    console.error(`\nBloqueado (${problemas.length}), requiere correccion manual:`);
    problemas.forEach((p) => console.error(`  ${p}`));
    return 1;
  }
  return 0;
}

function principal([modo, ...resto]) {
  const raiz = git(process.cwd(), ['rev-parse', '--show-toplevel']).toString('utf8').trim();
  if (modo === 'pre-commit') return informar(antesDeConfirmar(raiz));
  if (modo === 'commit-msg') return informar(revisarMensaje(raiz, resto[0]));
  if (modo === 'pre-push') {
    const resultado = antesDePublicar(raiz, fs.readFileSync(0, 'utf8'));
    if (resultado.problemas.length === 0) resultado.problemas.push(...verificarCodigo(raiz));
    return informar(resultado);
  }
  console.error('Uso: guardia.js pre-commit | commit-msg <archivo> | pre-push');
  return 2;
}

if (require.main === module) process.exitCode = principal(process.argv.slice(2));

module.exports = { antesDeConfirmar, revisarMensaje, antesDePublicar, esPrivado };
