'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { revisarRelease } = require('../scripts/comprobar-moodle');

const DIRECTORIO = path.join(__dirname, '..', 'deploy', 'moodle');
const nginx = fs.readFileSync(path.join(DIRECTORIO, 'nginx.conf'), 'utf8');
const apache = fs.readFileSync(path.join(DIRECTORIO, 'apache.conf'), 'utf8');
const objetivo = JSON.parse(fs.readFileSync(path.join(DIRECTORIO, 'version-objetivo.json'), 'utf8'));

const MARCADORES = Object.freeze([
  'composer\\.json', 'composer\\.lock', 'package\\.json', 'package-lock\\.json',
  'UPGRADING\\.md', 'Gruntfile\\.js', 'phpunit\\.xml\\.dist', 'phpcs\\.xml\\.dist',
  'rector\\.php', 'jest\\.config\\.js', 'xo\\.config\\.mjs'
]);
const DIRECTORIOS_NEGADOS = Object.freeze(['vendor', 'vendor-bin', 'node_modules', 'bin', 'scripts']);
const RUTAS_QUE_SI_EXISTEN_EN_PUBLIC = Object.freeze(['admin', 'lib', 'local', 'theme', 'course', 'user', 'webservice']);

test('despliegue moodle: el docroot apunta a public/ en las dos configuraciones', () => {
  const raiz = /^\s*root\s+(\S+);/m.exec(nginx);
  assert.ok(raiz, 'nginx.conf debe declarar root');
  assert.match(raiz[1], /\/public$/, `el root de nginx no termina en /public: ${raiz[1]}`);

  const docroot = /^\s*DocumentRoot\s+(\S+)/m.exec(apache);
  assert.ok(docroot, 'apache.conf debe declarar DocumentRoot');
  assert.match(docroot[1], /\/public$/, `el DocumentRoot de apache no termina en /public: ${docroot[1]}`);
});

test('despliegue moodle: los marcadores del arbol interno estan negados en las dos', () => {
  for (const marcador of MARCADORES) {
    assert.ok(nginx.includes(marcador), `nginx.conf no niega ${marcador}`);
    assert.ok(apache.includes(marcador), `apache.conf no niega ${marcador}`);
  }
});

test('despliegue moodle: los directorios que nunca viven en public/ estan negados', () => {
  for (const directorio of DIRECTORIOS_NEGADOS) {
    assert.match(nginx, new RegExp(`\\(?[^)]*\\b${directorio}\\b[^)]*\\)?/`), `nginx.conf no niega ${directorio}/`);
    assert.ok(apache.includes(directorio), `apache.conf no niega ${directorio}/`);
  }
});

test('despliegue moodle: no se niega ninguna ruta que si existe dentro de public/', () => {
  const negadasNginx = [...nginx.matchAll(/location ~ \^?\/?\(([^)]+)\)/g)].flatMap((m) => m[1].split('|'));
  const negadasApache = [...apache.matchAll(/LocationMatch "\^?\/?\(([^)]+)\)/g)].flatMap((m) => m[1].split('|'));
  for (const ruta of RUTAS_QUE_SI_EXISTEN_EN_PUBLIC) {
    for (const [nombre, lista] of [['nginx', negadasNginx], ['apache', negadasApache]]) {
      const choque = lista.find((n) => n.replace(/\\\./g, '.') === ruta);
      assert.equal(choque, undefined, `${nombre} niega ${ruta}, que si se sirve desde public/`);
    }
  }
});

test('despliegue moodle: se usa el enrutador r.php de Moodle 5.1 en adelante', () => {
  assert.match(nginx, /try_files \$uri \$uri\/ \/r\.php/);
  assert.match(apache, /FallbackResource \/r\.php/);
});

test('despliegue moodle: las dos configuraciones exigen HTTPS y cabeceras de seguridad', () => {
  for (const [nombre, texto] of [['nginx', nginx], ['apache', apache]]) {
    assert.match(texto, /Strict-Transport-Security/, `${nombre} sin HSTS`);
    assert.match(texto, /X-Content-Type-Options/, `${nombre} sin nosniff`);
    assert.match(texto, /TLSv1\.2/, `${nombre} sin minimo de TLS`);
    assert.ok(/301|Redirect permanent/.test(texto), `${nombre} no redirige a https`);
  }
});

test('despliegue moodle: la version objetivo esta fijada a una rama estable', () => {
  assert.equal(objetivo.rama, 'MOODLE_503_STABLE');
  assert.equal(objetivo.maturity, 'MATURITY_STABLE');
  assert.equal(objetivo.branch, '503');
  assert.match(objetivo.commitVerificado, /^[0-9a-f]{40}$/);
  assert.equal(objetivo.codigoServibleEn, 'public/');
});

test('despliegue moodle: la comprobacion de Moodle aceptaria la version objetivo y rechazaria la rechazada', () => {
  const buena = { datos: {}, fallos: [], avisos: [] };
  revisarRelease(objetivo.release, true, buena);
  assert.deepEqual(buena.fallos, [], `la version objetivo no deberia fallar: ${objetivo.release}`);
  assert.deepEqual(buena.avisos, []);

  const mala = { datos: {}, fallos: [], avisos: [] };
  revisarRelease(objetivo.rechazado.release, true, mala);
  assert.equal(mala.fallos.length, 1, `la version rechazada deberia fallar: ${objetivo.rechazado.release}`);
});
