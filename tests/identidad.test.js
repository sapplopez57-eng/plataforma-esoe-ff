'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const HOJA = path.join(RAIZ, 'public', 'css', 'styles.css');
const leer = (archivo) => fs.readFileSync(archivo, 'utf8');

function separarRaiz(css) {
  const encontrada = /(^|[\s,}]):root\s*\{/.exec(css);
  assert.ok(encontrada, 'la hoja debe declarar sus variables en :root');
  const inicio = encontrada.index + encontrada[1].length;
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

function resolver(mapa, valor, profundidad = 0) {
  assert.ok(profundidad < 10, `ciclo de variables en ${valor}`);
  const m = /^var\((--[a-z0-9-]+)\)$/i.exec(valor.trim());
  if (!m) return valor.trim();
  assert.ok(mapa.has(m[1]), `${m[1]} no esta definida en :root`);
  return resolver(mapa, mapa.get(m[1]), profundidad + 1);
}

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

const COLOR_LITERAL = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i;

function coloresFueraDeRaiz(resto) {
  return quitarComentarios(resto).split('\n')
    .map((linea, i) => ({ linea: i + 1, texto: linea.trim() }))
    .filter(({ texto }) => COLOR_LITERAL.test(texto));
}

function tamanosFueraDeEscala(texto) {
  const halladas = [];
  const limpio = quitarComentarios(texto);
  const re = /font-size\s*:\s*([^;"]+)/gi;
  let m;
  while ((m = re.exec(limpio)) !== null) {
    const valor = m[1].trim();
    if (/^var\(--fs-[a-z0-9]+\)$/i.test(valor)) continue;
    const previo = limpio.slice(0, m.index);
    const selector = previo.slice(previo.lastIndexOf('}') + 1, previo.lastIndexOf('{')).trim();
    if (/^html(\[data-texto="[a-z-]+"\])?$/.test(selector) && /^\d+(\.\d+)?%$/.test(valor)) continue;
    halladas.push(valor);
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
  assert.equal(resolver(definidas, 'var(--fs-base)'), '1rem', 'el texto base es 1rem: 16 px con la base del navegador (DIS-03)');
});

function redefinicionesDe(css, selector) {
  const mapa = new Map();
  const re = /([^{}]+)\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(quitarComentarios(css))) !== null) {
    const selectores = m[1].split(',').map((x) => x.trim());
    if (selectores.includes(selector)) for (const [k, v] of variables(m[2])) mapa.set(k, v);
  }
  return mapa;
}

test('identidad: los pares de texto y fondo cumplen 4.5:1 en cada ambito', () => {
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
    ['--sobre-accion', '--decoracion-viva', 'iniciales del usuario'],
    ['--acento-titulo', '--papel', 'palabra destacada del titulo de acceso'],
    ['--titulo', '--superficie', 'perfil elegido, boton de ambiente activo'],
    ['--sobre-estructura-tenue', '--estructura', 'rotulo del boton de entrada']
  ];
  const interno = redefinicionesDe(resto, '.app-shell');
  const noche = redefinicionesDe(resto, 'html[data-noche]');
  const nocheInterno = redefinicionesDe(resto, 'html[data-noche] .app-shell');
  const ambitos = {
    'acceso (:root)': definidas,
    'paginas internas (.app-shell)': new Map([...definidas, ...interno]),
    'acceso de noche': new Map([...definidas, ...noche]),
    'paginas internas de noche': new Map([...definidas, ...noche, ...interno, ...nocheInterno])
  };
  assert.ok(noche.size > 0 && nocheInterno.size > 0, 'el modo noche debe redefinir los dos ambitos');
  assert.ok(ambitos['paginas internas (.app-shell)'].get('--estructura') !== definidas.get('--estructura'),
    '.app-shell debe redefinir la paleta de las paginas internas');
  const fallos = [];
  for (const [ambito, mapa] of Object.entries(ambitos)) {
    for (const [t, f, donde] of pares) {
      const r = contraste(resolver(mapa, `var(${t})`), resolver(mapa, `var(${f})`));
      if (r < 4.5) fallos.push(`${ambito} - ${donde}: ${t} sobre ${f} = ${r.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(fallos, []);
});

test('identidad: las comprobaciones fallan cuando deben', () => {
  assert.equal(coloresFueraDeRaiz('.a { color: #2859C5; }').length, 1);
  assert.equal(coloresFueraDeRaiz('.a { background: rgba(0,0,0,.5); }').length, 1);
  assert.equal(coloresFueraDeRaiz('.a { color: var(--texto); } /* #fff en comentario */').length, 0);

  assert.deepEqual(tamanosFueraDeEscala('.a { font-size: 13px; } .b { font-size: var(--fs-sm); }'), ['13px']);
  assert.deepEqual(tamanosFueraDeEscala(estilosEnLinea('<b style="font-size:12.5px; color:var(--texto)">')), ['12.5px']);

  assert.deepEqual(variablesSinDefinir('style="color:var(--olivo-fuerte)"', definidas), ['--olivo-fuerte']);
  assert.deepEqual(variablesSinDefinir('style="color:var(--piedra)"', definidas), []);

  assert.equal(contarRaices(':root { --a: 1; }\n.x {}\n:root { --b: 2; }'), 2);
  assert.equal(contarRaices('/* :root { } */ :root { --a: 1; }'), 1);

  assert.ok(contraste('#FFFFFF', '#10C5EA') < 4.5, 'el cielo de marca no sirve para texto blanco');
  assert.ok(contraste('#0F2A33', '#10C5EA') >= 4.5, 'con texto oscuro si');
});

test('identidad: la letra de las tarjetas de clase se lee sobre toda su banda de color', () => {
  const bandas = [...definidas.keys()].filter((k) => /^--banda-\d+$/.test(k));
  assert.ok(bandas.length >= 4, 'faltan las bandas de las tarjetas');
  const letra = resolver(definidas, 'var(--sobre-banda)');
  const fallos = [];
  for (const banda of bandas) {
    for (const color of definidas.get(banda).match(/#[0-9a-f]{6}/gi) || []) {
      const r = contraste(letra, color);
      if (r < 4.5) fallos.push(`${banda} ${color}: ${r.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(fallos, []);
});
