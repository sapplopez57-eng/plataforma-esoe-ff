'use strict';

/* DIS-01 y DIS-03. La identidad visual tiene una sola fuente de verdad: las
   variables de :root en public/css/styles.css. Esta prueba falla si:
   - la paleta de marca deja de coincidir con la que declara el README;
   - se usa una variable que no existe (no da error: el color cae en herencia
     y los fondos y bordes desaparecen sin aviso);
   - se escribe un color o un tamano de letra fuera de :root;
   - un par de texto y fondo baja de 4.5:1 (WCAG 2.1 AA). */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const HOJA = path.join(RAIZ, 'public', 'css', 'styles.css');
const leer = (archivo) => fs.readFileSync(archivo, 'utf8');

// --- Lectura de la hoja ------------------------------------------------------

function separarRaiz(css) {
  const inicio = css.indexOf(':root');
  assert.ok(inicio !== -1, 'la hoja debe declarar sus variables en :root');
  const abre = css.indexOf('{', inicio);
  let nivel = 0;
  let fin = abre;
  for (; fin < css.length; fin += 1) {
    if (css[fin] === '{') nivel += 1;
    else if (css[fin] === '}') { nivel -= 1; if (nivel === 0) break; }
  }
  return { raiz: css.slice(abre + 1, fin), resto: css.slice(0, inicio) + css.slice(fin + 1) };
}

function contarRaices(texto) {
  return (quitarComentarios(texto).match(/(^|[\s,}]):root\s*\{/g) || []).length;
}

function quitarComentarios(texto) {
  return texto.replace(/\/\*[\s\S]*?\*\//g, '');
}

function variables(raiz) {
  const mapa = new Map();
  const re = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;
  let m;
  while ((m = re.exec(quitarComentarios(raiz))) !== null) mapa.set(m[1], m[2].trim());
  return mapa;
}

// Sigue var(--x) hasta un valor literal.
function resolver(mapa, valor, profundidad = 0) {
  assert.ok(profundidad < 10, `ciclo de variables en ${valor}`);
  const m = /^var\((--[a-z0-9-]+)\)$/i.exec(valor.trim());
  if (!m) return valor.trim();
  assert.ok(mapa.has(m[1]), `${m[1]} no esta definida en :root`);
  return resolver(mapa, mapa.get(m[1]), profundidad + 1);
}

// --- Contraste WCAG ---------------------------------------------------------

function luminancia(hex) {
  const limpio = hex.replace('#', '');
  const largo = limpio.length === 3 ? limpio.split('').map((c) => c + c).join('') : limpio;
  const [r, g, b] = largo.match(/../g).map((x) => parseInt(x, 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contraste(a, b) {
  const [claro, oscuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (claro + 0.05) / (oscuro + 0.05);
}

// --- Comprobaciones reutilizables (las prueban tambien los casos negativos) --

const COLOR_LITERAL = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i;

function coloresFueraDeRaiz(resto) {
  return quitarComentarios(resto).split('\n')
    .map((linea, i) => ({ linea: i + 1, texto: linea.trim() }))
    .filter(({ texto }) => COLOR_LITERAL.test(texto));
}

function tamanosFueraDeEscala(texto) {
  const halladas = [];
  const re = /font-size\s*:\s*([^;"]+)/gi;
  let m;
  while ((m = re.exec(quitarComentarios(texto))) !== null) {
    if (!/^var\(--fs-[a-z0-9]+\)$/i.test(m[1].trim())) halladas.push(m[1].trim());
  }
  return halladas;
}

function variablesSinDefinir(texto, definidas) {
  const usadas = new Set();
  const re = /var\((--[a-z0-9-]+)/gi;
  let m;
  while ((m = re.exec(texto)) !== null) usadas.add(m[1]);
  return [...usadas].filter((v) => !definidas.has(v)).sort();
}

function estilosEnLinea(texto) {
  const halladas = [];
  const re = /style="([^"]*)"/g;
  let m;
  while ((m = re.exec(texto)) !== null) halladas.push(m[1]);
  return halladas.join(';\n');
}

// ---------------------------------------------------------------------------

const css = leer(HOJA);
const { raiz, resto } = separarRaiz(css);
const definidas = variables(raiz);
const archivosDeInterfaz = [
  path.join(RAIZ, 'public', 'index.html'),
  ...fs.readdirSync(path.join(RAIZ, 'public', 'js'))
    .filter((n) => n.endsWith('.js') && n !== 'clerk-es.js')
    .map((n) => path.join(RAIZ, 'public', 'js', n))
];

test('identidad: la paleta de marca coincide con la del README', () => {
  const readme = leer(path.join(RAIZ, 'README.md'));
  const declaradas = [...readme.matchAll(/\*\*0([1-9]) [^(*]+\(`(#[0-9A-Fa-f]{6})`\)/g)]
    .map(([, n, hex]) => [Number(n), hex.toUpperCase()]);
  assert.ok(declaradas.length >= 2, 'el README debe declarar la paleta como **0N Nombre (`#RRGGBB`)**');
  for (const [n, hex] of declaradas) {
    assert.ok(definidas.has(`--marca-${n}`), `falta --marca-${n} en :root`);
    assert.equal(resolver(definidas, `var(--marca-${n})`).toUpperCase(), hex, `--marca-${n} no coincide con el README`);
  }
  const enHoja = [...definidas.keys()].filter((k) => /^--marca-\d+$/.test(k)).length;
  assert.equal(enHoja, declaradas.length, 'la hoja y el README declaran distinto numero de colores de marca');
});

test('identidad: hay un solo bloque :root', () => {
  // Las variables viven en un unico :root. Un segundo bloque las repartiria y
  // esta prueba, que lee el primero, daria por inexistentes las del segundo.
  assert.equal(contarRaices(css), 1, 'declare todas las variables en el :root principal de styles.css');
});

test('identidad: toda variable usada en la interfaz existe en :root', () => {
  const faltan = {};
  for (const archivo of [HOJA, ...archivosDeInterfaz]) {
    const sinDefinir = variablesSinDefinir(leer(archivo), definidas);
    if (sinDefinir.length) faltan[path.relative(RAIZ, archivo)] = sinDefinir;
  }
  assert.deepEqual(faltan, {}, 'Variables usadas que no existen: el navegador no avisa, el estilo se pierde.');
});

test('identidad: ningun color se escribe fuera de :root', () => {
  const enHoja = coloresFueraDeRaiz(resto).map(({ texto }) => `styles.css: ${texto.slice(0, 90)}`);
  const enLinea = [];
  for (const archivo of archivosDeInterfaz) {
    const estilos = estilosEnLinea(leer(archivo));
    if (COLOR_LITERAL.test(estilos)) enLinea.push(`${path.basename(archivo)}: ${estilos.match(COLOR_LITERAL)[0]}`);
  }
  assert.deepEqual([...enHoja, ...enLinea], [], 'Usa una variable de :root en lugar de un color literal.');
});

test('identidad: ningun tamano de letra sale de la escala', () => {
  const fuera = {};
  const enHoja = tamanosFueraDeEscala(resto);
  if (enHoja.length) fuera['styles.css'] = enHoja;
  for (const archivo of archivosDeInterfaz) {
    const enLinea = tamanosFueraDeEscala(estilosEnLinea(leer(archivo)));
    if (enLinea.length) fuera[path.basename(archivo)] = enLinea;
  }
  assert.deepEqual(fuera, {}, 'Usa var(--fs-...) de la escala tipografica.');
  assert.equal(resolver(definidas, 'var(--fs-base)'), '16px', 'el texto base es de 16 px (DIS-03)');
});

test('identidad: los pares de texto y fondo cumplen 4.5:1', () => {
  // [texto, fondo, donde aparece]
  const pares = [
    ['--texto', '--papel', 'texto general'],
    ['--titulo', '--papel', 'titulos'],
    ['--piedra', '--papel', 'texto secundario'],
    ['--piedra', '--superficie', 'texto secundario sobre superficie'],
    ['--texto', '--superficie', 'encabezado de tabla'],
    ['--enlace', '--papel', 'enlaces y botones de contorno'],
    ['--sobre-accion', '--accion', 'boton primario, menu activo'],
    ['--sobre-accion', '--accion-hondo', 'boton primario al pasar'],
    ['--sobre-accion', '--positivo', 'Aprobado, Presente'],
    ['--sobre-accion', '--negativo', 'Reprobado, Ausente, cierre'],
    ['--sobre-accion', '--negativo-hondo', 'cierre al pasar'],
    ['--sobre-accion', '--advertencia', 'Tardanza'],
    ['--sobre-estructura', '--estructura', 'menu lateral, panel de acceso'],
    ['--sobre-estructura-tenue', '--estructura', 'rotulos del menu, pie del acceso'],
    ['--decoracion-viva', '--estructura', 'escudo del acceso, foco en el menu'],
    ['--papel', '--estructura', 'nombre en el menu']
  ];
  const fallos = pares
    .map(([t, f, donde]) => ({ donde, t, f, r: contraste(resolver(definidas, `var(${t})`), resolver(definidas, `var(${f})`)) }))
    .filter(({ r }) => r < 4.5)
    .map(({ donde, t, f, r }) => `${donde}: ${t} sobre ${f} = ${r.toFixed(2)}:1`);
  assert.deepEqual(fallos, []);
});

test('identidad: las comprobaciones fallan cuando deben', () => {
  // Una comprobacion que no se puede ver fallar no protege nada (L-018).
  assert.equal(coloresFueraDeRaiz('.a { color: #2859C5; }').length, 1);
  assert.equal(coloresFueraDeRaiz('.a { background: rgba(0,0,0,.5); }').length, 1);
  assert.equal(coloresFueraDeRaiz('.a { color: var(--texto); } /* #fff en comentario */').length, 0);

  assert.deepEqual(tamanosFueraDeEscala('.a { font-size: 13px; } .b { font-size: var(--fs-sm); }'), ['13px']);
  assert.deepEqual(tamanosFueraDeEscala(estilosEnLinea('<b style="font-size:12.5px; color:var(--texto)">')), ['12.5px']);

  // la regresion real de esta vuelta: nombres viejos tras renombrar la paleta
  assert.deepEqual(variablesSinDefinir('style="color:var(--olivo-fuerte)"', definidas), ['--olivo-fuerte']);
  assert.deepEqual(variablesSinDefinir('style="color:var(--piedra)"', definidas), []);

  // y el contraste distingue lo que pasa de lo que no
  assert.equal(contarRaices(':root { --a: 1; }\n.x {}\n:root { --b: 2; }'), 2);
  assert.equal(contarRaices('/* :root { } */ :root { --a: 1; }'), 1);

  assert.ok(contraste('#FFFFFF', '#10C5EA') < 4.5, 'el cielo de marca no sirve para texto blanco');
  assert.ok(contraste('#0F2A33', '#10C5EA') >= 4.5, 'con texto oscuro si');
});
