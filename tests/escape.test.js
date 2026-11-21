'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DIR_JS = path.join(__dirname, '..', 'public', 'js');

function cargarEsc() {
  const fuente = fs.readFileSync(path.join(DIR_JS, 'sesion.js'), 'utf8');
  const declaracion = /function esc\(valor\) \{[\s\S]*?\n\}/.exec(fuente);
  assert.ok(declaracion, 'esc() debe seguir declarada en public/js/sesion.js');
  const contexto = { resultado: null };
  vm.createContext(contexto);
  vm.runInContext(`${declaracion[0]}; resultado = esc;`, contexto);
  return contexto.resultado;
}

function archivosDeInterfaz() {
  return fs.readdirSync(DIR_JS)
    .filter((n) => n.endsWith('.js') && n !== 'clerk-es.js')
    .map((n) => path.join(DIR_JS, n));
}

function interpolacionesDeHtml(fuente) {
  const salida = [];
  const linea = (i) => fuente.slice(0, i).split('\n').length;

  function leerPlantilla(i) {
    const tramos = [];
    const expresiones = [];
    let texto = '';
    while (i < fuente.length) {
      const c = fuente[i];
      if (c === '\\') { texto += fuente.slice(i, i + 2); i += 2; continue; }
      if (c === '`') { i += 1; break; }
      if (c === '$' && fuente[i + 1] === '{') {
        tramos.push(texto); texto = '';
        const inicio = i + 2;
        let nivel = 1;
        let j = inicio;
        while (j < fuente.length && nivel > 0) {
          if (fuente[j] === '`') { j = leerPlantilla(j + 1).fin; continue; }
          if (fuente[j] === "'" || fuente[j] === '"') { j = finCadena(j); continue; }
          if (fuente[j] === '{') nivel += 1;
          else if (fuente[j] === '}') nivel -= 1;
          j += 1;
        }
        expresiones.push({ texto: fuente.slice(inicio, j - 1).trim(), linea: linea(inicio) });
        i = j;
        continue;
      }
      texto += c;
      i += 1;
    }
    tramos.push(texto);
    const esHtml = tramos.some((t) => /<\s*[a-zA-Z/]/.test(t));
    if (esHtml) expresiones.forEach((e) => salida.push(e));
    return { fin: i };
  }

  function finCadena(i) {
    const cierre = fuente[i];
    let j = i + 1;
    while (j < fuente.length) {
      if (fuente[j] === '\\') { j += 2; continue; }
      if (fuente[j] === cierre) return j + 1;
      j += 1;
    }
    return j;
  }

  let i = 0;
  while (i < fuente.length) {
    const c = fuente[i];
    if (c === '`') { i = leerPlantilla(i + 1).fin; continue; }
    if (c === "'" || c === '"') { i = finCadena(i); continue; }
    if (c === '/' && fuente[i + 1] === '/') { const n = fuente.indexOf('\n', i); i = n === -1 ? fuente.length : n; continue; }
    if (c === '/' && fuente[i + 1] === '*') { const n = fuente.indexOf('*/', i); i = n === -1 ? fuente.length : n + 2; continue; }
    i += 1;
  }
  return salida;
}

function residuo(expresion) {
  let s = expresion;

  const corte = indiceTernarioRaiz(s);
  if (corte !== -1) s = s.slice(corte + 1);

  s = quitarLlamada(s, 'esc');
  s = quitarLlamada(s, 'encodeURIComponent');
  s = quitarLlamada(s, 'emptyState');
  s = quitarLlamada(s, 'renderBienvenida');
  s = s.replace(/`[\s\S]*?`/g, '``');
  s = s.replace(/'(?:[^'\\]|\\.)*'/g, "''");
  s = s.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  s = s.replace(/ICONS\.[A-Za-z0-9_$]+/g, 'I');
  s = s.replace(/\bitem\.icon\b/g, 'I');
  s = quitarIteraciones(s);
  s = s.replace(/[A-Za-z0-9_.$[\]]+\.length\b/g, 'N');
  s = s.replace(/[A-Za-z0-9_.$[\]]+\s*(===|!==|==|!=|>=|<=|>|<)\s*(''|""|[0-9]+|[A-Za-z0-9_.$[\]]+)/g, 'B');
  s = s.replace(/\bawait\b/g, '');
  return s;
}

function indiceTernarioRaiz(s) {
  let nivel = 0;
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (c === '(' || c === '[' || c === '{') nivel += 1;
    else if (c === ')' || c === ']' || c === '}') nivel -= 1;
    else if (c === '`' || c === "'" || c === '"') {
      const cierre = c;
      i += 1;
      while (i < s.length && s[i] !== cierre) { if (s[i] === '\\') i += 1; i += 1; }
    } else if (c === '?' && nivel === 0 && s[i + 1] !== '.' && s[i + 1] !== '?') {
      return i;
    }
  }
  return -1;
}

const METODOS_RECORRIDO = /\.(map|filter|join|slice|sort|forEach|reduce|concat|flat|flatMap)\s*\(/;

function quitarIteraciones(texto) {
  let s = texto;
  for (;;) {
    const m = METODOS_RECORRIDO.exec(s);
    if (!m) return s;
    const abre = m.index + m[0].length - 1;
    let inicio = m.index;
    while (inicio > 0 && /[A-Za-z0-9_.$[\]')]/.test(s[inicio - 1])) inicio -= 1;
    const cierra = finParentesis(s, abre);
    s = `${s.slice(0, inicio)}V${s.slice(cierra)}`;
  }
}

function finParentesis(s, abre) {
  let nivel = 0;
  for (let i = abre; i < s.length; i += 1) {
    const c = s[i];
    if (c === '`' || c === "'" || c === '"') {
      const cierre = c;
      i += 1;
      while (i < s.length && s[i] !== cierre) { if (s[i] === '\\') i += 1; i += 1; }
      continue;
    }
    if (c === '(') nivel += 1;
    else if (c === ')') { nivel -= 1; if (nivel === 0) return i + 1; }
  }
  return s.length;
}

function quitarLlamada(texto, nombre) {
  let s = texto;
  let desde = 0;
  for (;;) {
    const i = s.indexOf(`${nombre}(`, desde);
    if (i === -1) return s;
    let nivel = 0;
    let j = i + nombre.length;
    for (; j < s.length; j += 1) {
      if (s[j] === '(') nivel += 1;
      else if (s[j] === ')') { nivel -= 1; if (nivel === 0) { j += 1; break; } }
    }
    s = s.slice(0, i) + 'V' + s.slice(j);
    desde = i + 1;
  }
}

const FRAGMENTOS_HTML = new Set([
  'filas', 'filasMaterias', 'filasAlumnos', 'clasesRows', 'cursos', 'bloqueCursos',
  'badgeCondicion', 'gradoBadge', 'activeClass', 'tarjetas', 'opciones', 'cuerpo',
  'contenido', 'secciones', 'encabezado', 'pie', 'bloques', 'lista', 'items',
]);

function sinEscapar(expresion) {
  if (FRAGMENTOS_HTML.has(expresion)) return false;
  const r = residuo(expresion);
  const leePropiedad = /[A-Za-z0-9_$\]]\.[A-Za-z_$]/.test(r);
  const llamaFuncion = /[A-Za-z0-9_$]\s*\(/.test(r);
  return leePropiedad || llamaFuncion;
}

test('escape: esc() neutraliza el dato del criterio de aceptacion', () => {
  const esc = cargarEsc();
  const ataque = '<img src=x onerror=alert(1)>';
  const escapado = esc(ataque);

  assert.equal(escapado, '&lt;img src=x onerror=alert(1)&gt;');
  assert.ok(!escapado.includes('<'));
  assert.ok(!escapado.includes('>'));

  assert.equal(esc('&'), '&amp;');
  assert.equal(esc('"'), '&quot;');
  assert.equal(esc("'"), '&#39;');
  assert.equal(esc('a" onfocus="alert(1)'), 'a&quot; onfocus=&quot;alert(1)');

  assert.equal(esc(undefined), '');
  assert.equal(esc(null), '');
  assert.equal(esc(0), '0');

  assert.equal(esc(escapado), '&amp;lt;img src=x onerror=alert(1)&amp;gt;');
});

test('escape: ninguna plantilla de HTML interpola un dato sin escapar', () => {
  const sospechosas = [];
  for (const archivo of archivosDeInterfaz()) {
    const fuente = fs.readFileSync(archivo, 'utf8');
    for (const { texto, linea } of interpolacionesDeHtml(fuente)) {
      if (sinEscapar(texto)) {
        sospechosas.push(`${path.basename(archivo)}:${linea}  \${${texto.replace(/\s+/g, ' ').slice(0, 70)}}`);
      }
    }
  }
  assert.deepEqual(sospechosas, [], `Interpolaciones sin escapar:\n${sospechosas.join('\n')}\n`
    + 'Envolvelas en esc(). Si es HTML ya armado por la interfaz, agregalo a '
    + 'FRAGMENTOS_HTML en esta prueba explicando por que.');
});

test('escape: la prueba estructural falla cuando debe', () => {
  const conHueco = 'const f = () => `<td>${alumno.nombres}</td><td>${esc(alumno.dni)}</td>`;';
  const halladas = interpolacionesDeHtml(conHueco).filter(({ texto }) => sinEscapar(texto));
  assert.deepEqual(halladas.map((h) => h.texto), ['alumno.nombres']);

  const enAtributo = 'const f = () => `<input value="${filtro.fecha}">`;';
  assert.equal(interpolacionesDeHtml(enAtributo).filter(({ texto }) => sinEscapar(texto)).length, 1);

  const enTernario = "const f = () => `<td>${hay ? alumno.nombres : ''}</td>`;";
  assert.equal(interpolacionesDeHtml(enTernario).filter(({ texto }) => sinEscapar(texto)).length, 1);

  const mensaje = 'showToast(`Estudiante ${nuevo.nombres} registrado`);';
  assert.equal(interpolacionesDeHtml(mensaje).length, 0);

  const correcto = 'const f = () => `<td>${esc(alumno.nombres)}</td>`;';
  assert.equal(interpolacionesDeHtml(correcto).filter(({ texto }) => sinEscapar(texto)).length, 0);
});
