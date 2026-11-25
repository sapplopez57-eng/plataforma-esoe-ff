'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const acorn = require('acorn');

const RAIZ = path.resolve(__dirname, '..');

const TERMINOS = new Set([
  'c857d09db23e6822', 'c70eca6b0f88f44d', '1f381abb55a40895', '7d3194f79e645c42',
  '60965168ce762e94', '053ea4804ef1bb33', '3ea125d0bff386e6', 'fa08b62093108026',
  '0c2744adb9e9fbd8', '1f1cafe9f8a6db75', '5d72436256ada538', '487b91042c7cf27a',
  'de2187af3fb01170', '57de4cf40144bdf7', 'ebde709e306badca', '0ac0192d441f96da',
  '97f128115e33c769', '41c3e053e165453d', 'a245bf7ede84daf6', 'bafa4e6bcb0d0bd1',
  '450dcf23e621ff10', 'b1ece0f3fb4f7be0', '5667ef73dac709ef', '8316b399af662089',
  '2e8aae79d9566c63', '953de24889d67ab2', 'fb79a0a30e791cda', '803b3eb2b6af0271',
  '5eff592cc497fccb', 'cdcbb68a3444fdd6', '0677069fdf937bd1', '7548fb6416154032',
  '5d0c0ab127fdea24', '1d772ffb5ed5f970', 'fc34547c4b463431'
]);

const RUTAS = new Set([
  'e026f56c08dcdea4', '86ec294931340f57', 'a8af1293f42786da', '3dea8547906dd8f1',
  '8741d026568671be', '1602006cc336b8cf', 'f00ec2776cb8207b', 'a1d1128ffe5a2849',
  '9f8c7948c9c7ef91', 'b951327c37d8a1ed', '104075468a9cad84', '8478dc8715bd3bb5',
  'bccc86317c281a19', '315161dd3154081c', 'e486fc5f7ec848dd', 'b8294b25c15f7eb0',
  '38f7cf0b4ff37a00', '327ad2697caff5db', '0b4f1539bf94c59b', 'd5d3368a61f8d02e',
  '65e12b385a1d8a9f'
]);

const SIN_REVISION_DE_COMENTARIOS = [/^public\/vendor\//, /^public\/fonts\//];
const SIN_REVISION_DE_TERMINOS = [/^package-lock\.json$/];

function huella(texto) {
  return crypto.createHash('sha256').update(texto).digest('hex').slice(0, 16);
}

function tipoDe(ruta) {
  const nombre = path.basename(ruta).toLowerCase();
  const ext = path.extname(nombre);
  if (['.js', '.cjs', '.mjs'].includes(ext)) return 'js';
  if (ext === '.css') return 'css';
  if (ext === '.sql') return 'sql';
  if (['.html', '.htm', '.svg', '.xml'].includes(ext)) return 'marcado';
  if (['.sh', '.yml', '.yaml', '.toml'].includes(ext)) return 'numeral';
  if (ext === '.md') return 'markdown';
  if (['dockerfile', '.gitignore', '.dockerignore', '.env.example', '.gitattributes', '.npmrc'].includes(nombre)) return 'numeral';
  return null;
}

function rangosJs(texto) {
  const intentos = ['script', 'module'];
  let ultimoError = null;
  for (const sourceType of intentos) {
    const rangos = [];
    try {
      acorn.parse(texto, {
        ecmaVersion: 'latest',
        sourceType,
        allowHashBang: true,
        allowReturnOutsideFunction: true,
        allowAwaitOutsideFunction: true,
        onComment: (_bloque, _contenido, inicio, fin) => {
          if (!(inicio === 0 && texto.startsWith('#!'))) rangos.push([inicio, fin]);
        }
      });
      return rangos;
    } catch (error) {
      ultimoError = error;
    }
  }
  throw ultimoError;
}

function saltarCadena(texto, i, comilla, dobleEscapa) {
  let j = i + 1;
  while (j < texto.length) {
    const c = texto[j];
    if (c === '\\' && !dobleEscapa) { j += 2; continue; }
    if (c === comilla) {
      if (dobleEscapa && texto[j + 1] === comilla) { j += 2; continue; }
      return j + 1;
    }
    j++;
  }
  return j;
}

function rangosCss(texto) {
  const rangos = [];
  let i = 0;
  while (i < texto.length) {
    const c = texto[i];
    if (c === '"' || c === "'") { i = saltarCadena(texto, i, c, false); continue; }
    if (c === '/' && texto[i + 1] === '*') {
      const fin = texto.indexOf('*/', i + 2);
      const cierre = fin === -1 ? texto.length : fin + 2;
      rangos.push([i, cierre]);
      i = cierre;
      continue;
    }
    i++;
  }
  return rangos;
}

function rangosSql(texto) {
  const rangos = [];
  let i = 0;
  while (i < texto.length) {
    const c = texto[i];
    if (c === "'") { i = saltarCadena(texto, i, "'", true); continue; }
    if (c === '"') { i = saltarCadena(texto, i, '"', true); continue; }
    if (c === '$') {
      const etiqueta = /^\$[A-Za-z_]*\$/.exec(texto.slice(i));
      if (etiqueta) {
        const fin = texto.indexOf(etiqueta[0], i + etiqueta[0].length);
        i = fin === -1 ? texto.length : fin + etiqueta[0].length;
        continue;
      }
    }
    if (c === '-' && texto[i + 1] === '-') {
      const fin = texto.indexOf('\n', i);
      const cierre = fin === -1 ? texto.length : fin;
      rangos.push([i, cierre]);
      i = cierre;
      continue;
    }
    if (c === '/' && texto[i + 1] === '*') {
      let profundidad = 1;
      let j = i + 2;
      while (j < texto.length && profundidad > 0) {
        if (texto[j] === '/' && texto[j + 1] === '*') { profundidad++; j += 2; continue; }
        if (texto[j] === '*' && texto[j + 1] === '/') { profundidad--; j += 2; continue; }
        j++;
      }
      rangos.push([i, j]);
      i = j;
      continue;
    }
    i++;
  }
  return rangos;
}

function rangosMarcado(texto) {
  const rangos = [];
  const patron = /<!--[\s\S]*?-->/g;
  let m;
  while ((m = patron.exec(texto)) !== null) rangos.push([m.index, m.index + m[0].length]);
  return rangos;
}

function rangosNumeral(texto) {
  const rangos = [];
  let inicio = 0;
  let numero = 0;
  while (inicio <= texto.length) {
    const fin = texto.indexOf('\n', inicio);
    const cierre = fin === -1 ? texto.length : fin;
    const linea = texto.slice(inicio, cierre);
    const sangria = linea.length - linea.trimStart().length;
    const esShebang = numero === 0 && linea.startsWith('#!');
    if (!esShebang && linea.trimStart().startsWith('#')) rangos.push([inicio + sangria, cierre]);
    if (fin === -1) break;
    inicio = fin + 1;
    numero++;
  }
  return rangos;
}

const LENGUAJES_DE_BLOQUE = {
  '': 'consola', bash: 'consola', sh: 'consola', shell: 'consola', zsh: 'consola', console: 'consola',
  yaml: 'numeral', yml: 'numeral', dockerfile: 'numeral', dotenv: 'numeral', env: 'numeral',
  js: 'js', javascript: 'js', css: 'css', sql: 'sql', html: 'marcado', xml: 'marcado', svg: 'marcado'
};

function rangosConsola(texto) {
  const rangos = [];
  let comilla = null;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comilla) {
      if (c === '\\' && comilla === '"') { i++; continue; }
      if (c === comilla) comilla = null;
      continue;
    }
    if (c === '"' || c === "'") { comilla = c; continue; }
    if (c === '\n') continue;
    if (c === '#' && (i === 0 || /\s/.test(texto[i - 1])) && !(i === 0 && texto[1] === '!')) {
      const fin = texto.indexOf('\n', i);
      const cierre = fin === -1 ? texto.length : fin;
      rangos.push([i, cierre]);
      i = cierre - 1;
    }
  }
  return rangos;
}

function rangosMarkdown(texto) {
  const rangos = [];
  const patron = /^([ \t]*)(```|~~~)[ \t]*([A-Za-z0-9_-]*)[^\n]*\n([\s\S]*?)^[ \t]*\2[ \t]*$/gm;
  let m;
  while ((m = patron.exec(texto)) !== null) {
    const tipo = LENGUAJES_DE_BLOQUE[m[3].toLowerCase()];
    if (!tipo) continue;
    const desplazamiento = m.index + m[0].indexOf('\n') + 1;
    let internos;
    try {
      internos = tipo === 'consola' ? rangosConsola(m[4]) : rangosDe(m[4], tipo);
    } catch {
      internos = [];
    }
    for (const [inicio, fin] of internos) rangos.push([inicio + desplazamiento, fin + desplazamiento]);
  }
  return rangos;
}

function rangosDe(texto, tipo) {
  switch (tipo) {
    case 'js': return rangosJs(texto);
    case 'css': return rangosCss(texto);
    case 'sql': return rangosSql(texto);
    case 'marcado': return rangosMarcado(texto);
    case 'numeral': return rangosNumeral(texto);
    case 'markdown': return rangosMarkdown(texto);
    default: return [];
  }
}

function quitarComentarios(texto, tipo) {
  const rangos = rangosDe(texto, tipo);
  if (rangos.length === 0) return texto;

  const borrado = new Uint8Array(texto.length);
  for (const [inicio, fin] of rangos) borrado.fill(1, inicio, fin);

  const lineas = [];
  let inicio = 0;
  while (inicio <= texto.length) {
    const fin = texto.indexOf('\n', inicio);
    const cierre = fin === -1 ? texto.length : fin;
    let resultado = '';
    let tocada = false;
    let previo = '';
    for (let k = inicio; k < cierre; k++) {
      if (borrado[k]) {
        previo = 'hueco';
        tocada = true;
        continue;
      }
      if (previo === 'hueco') {
        if (/[ \t]$/.test(resultado) && /[ \t]/.test(texto[k])) continue;
        if (/\{[ \t]+$/.test(resultado) && texto[k] === '}') resultado = resultado.replace(/[ \t]+$/, '');
        else if (/[\w$]$/.test(resultado) && /[\w$]/.test(texto[k])) resultado += ' ';
      }
      previo = '';
      resultado += texto[k];
    }
    const original = texto.slice(inicio, cierre);
    if (tocada) {
      resultado = resultado.replace(/[ \t]+$/, '');
      lineas.push({ texto: resultado, eliminada: resultado.trim() === '' && original.trim() !== '' });
    } else {
      lineas.push({ texto: original, eliminada: false });
    }
    if (fin === -1) break;
    inicio = fin + 1;
  }

  const salida = [];
  for (let k = 0; k < lineas.length; k++) {
    if (!lineas[k].eliminada) { salida.push(lineas[k].texto); continue; }
    let j = k;
    while (j < lineas.length && lineas[j].eliminada) j++;
    const anteriorVacia = salida.length === 0 || salida[salida.length - 1].trim() === '';
    const siguiente = lineas[j];
    if (anteriorVacia && siguiente && !siguiente.eliminada && siguiente.texto.trim() === '' && j < lineas.length - 1) j++;
    k = j - 1;
  }
  return salida.join('\n');
}

function buscarComentarios(texto, tipo) {
  return rangosDe(texto, tipo).map(([inicio]) => texto.slice(0, inicio).split('\n').length);
}

function normalizar(texto) {
  return texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function buscarTerminos(texto, terminos = TERMINOS) {
  const hallazgos = [];
  const lineas = normalizar(texto).split('\n');
  lineas.forEach((linea, indice) => {
    const palabras = linea.split(/[^a-z0-9]+/).filter(Boolean);
    for (let k = 0; k < palabras.length; k++) {
      const candidatos = [palabras[k]];
      if (k + 1 < palabras.length) candidatos.push(`${palabras[k]} ${palabras[k + 1]}`);
      for (const candidato of candidatos) {
        if (terminos.has(huella(candidato))) hallazgos.push({ linea: indice + 1, termino: candidato });
      }
    }
  });
  return hallazgos;
}

function buscarRutas(ruta, rutas = RUTAS) {
  return normalizar(ruta).split('/').filter((segmento) => rutas.has(huella(segmento)));
}

function ocultar(termino) {
  return termino.replace(/[a-z0-9]/g, (c, i) => (i === 0 ? c : '*'));
}

function archivosVersionados() {
  const salida = execFileSync('git', ['ls-files', '-z'], { cwd: RAIZ, encoding: 'utf8' });
  return salida.split('\0').filter(Boolean);
}

function esTexto(buffer) {
  return !buffer.subarray(0, 8000).includes(0);
}

function revisarArchivos({ corregir }) {
  const problemas = [];
  let corregidos = 0;
  for (const ruta of archivosVersionados()) {
    const absoluta = path.join(RAIZ, ruta);
    if (!fs.existsSync(absoluta)) continue;
    for (const segmento of buscarRutas(ruta)) {
      problemas.push(`${ruta}: ruta no permitida (${ocultar(segmento)})`);
    }
    const buffer = fs.readFileSync(absoluta);
    if (!esTexto(buffer)) continue;
    let texto = buffer.toString('utf8');
    const tipo = tipoDe(ruta);
    const revisaComentarios = tipo && !SIN_REVISION_DE_COMENTARIOS.some((p) => p.test(ruta));
    if (revisaComentarios) {
      if (corregir) {
        const limpio = quitarComentarios(texto, tipo);
        if (limpio !== texto) {
          fs.writeFileSync(absoluta, limpio);
          texto = limpio;
          corregidos++;
        }
      }
      for (const linea of buscarComentarios(texto, tipo)) problemas.push(`${ruta}:${linea}: comentario`);
    }
    if (!SIN_REVISION_DE_TERMINOS.some((p) => p.test(ruta))) {
      for (const { linea, termino } of buscarTerminos(texto)) {
        problemas.push(`${ruta}:${linea}: termino no permitido (${ocultar(termino)})`);
      }
    }
  }
  return { problemas, corregidos };
}

function revisarCommits(rango) {
  const problemas = [];
  const salida = execFileSync('git', ['log', '--format=%H%x1f%an <%ae>%x1f%cn <%ce>%x1f%B%x1e', rango], { cwd: RAIZ, encoding: 'utf8' });
  for (const registro of salida.split('\x1e').map((r) => r.trim()).filter(Boolean)) {
    const [hash, autor, confirmador, mensaje] = registro.split('\x1f');
    for (const { termino } of buscarTerminos(`${autor}\n${confirmador}\n${mensaje}`)) {
      problemas.push(`commit ${hash.slice(0, 7)}: termino no permitido (${ocultar(termino)})`);
    }
  }
  return problemas;
}

function revisarRama(nombre) {
  const problemas = [];
  for (const { termino } of buscarTerminos(nombre.replace(/[/_-]/g, ' '))) {
    problemas.push(`rama ${nombre}: termino no permitido (${ocultar(termino)})`);
  }
  return problemas;
}

function argumento(args, nombre) {
  const i = args.indexOf(nombre);
  return i === -1 ? null : args[i + 1] || null;
}

function principal(args) {
  const corregir = args.includes('--corregir');
  const { problemas, corregidos } = revisarArchivos({ corregir });
  const rango = argumento(args, '--commits');
  if (rango) problemas.push(...revisarCommits(rango));
  const rama = argumento(args, '--rama');
  if (rama) problemas.push(...revisarRama(rama));

  if (corregir) console.log(`Archivos corregidos: ${corregidos}`);
  if (problemas.length > 0) {
    for (const p of problemas) console.error(p);
    console.error(`\n${problemas.length} problema(s) de estilo.`);
    return 1;
  }
  console.log('Estilo en orden: sin comentarios ni terminos no permitidos.');
  return 0;
}

if (require.main === module) process.exitCode = principal(process.argv.slice(2));

module.exports = { tipoDe, quitarComentarios, buscarComentarios, buscarTerminos, buscarRutas, revisarRama, huella };
