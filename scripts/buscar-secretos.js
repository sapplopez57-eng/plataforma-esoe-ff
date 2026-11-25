'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

const REGLAS = [
  { nombre: 'Llave privada', patron: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { nombre: 'Llave de AWS', patron: /\bAKIA[0-9A-Z]{16}\b/ },
  { nombre: 'Token de GitHub', patron: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { nombre: 'Token de Slack', patron: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { nombre: 'Llave secreta de Clerk', patron: /\bsk_(?:test|live)_[A-Za-z0-9]{20,}\b/ },
  { nombre: 'Token JWT', patron: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { nombre: 'Credencial en URL', patron: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@${}<>]+:[^\s:/@${}<>]{6,}@[^\s/]+/i },
  { nombre: 'Llave de API de Google', patron: /\bAIza[0-9A-Za-z_-]{35}/ },
  { nombre: 'Llave de servicio con prefijo sk', patron: /\bsk-(?:[a-z]+-)*[A-Za-z0-9_-]{24,}/ },
  { nombre: 'Token detallado de GitHub', patron: /\bgithub_pat_[A-Za-z0-9_]{40,}/ },
  {
    nombre: 'Secreto asignado en claro',
    patron: /\b(?:password|passwd|secret|token|api[_-]?key|clave|contrasena)\w*\s*[:=]\s*["']?[A-Za-z0-9+/_\-!@#%^&*]{12,}["']?\s*$/i
  },
  { nombre: 'Valor por defecto para un secreto', patron: /\$\{(?:\w*(?:PASSWORD|SECRET|TOKEN|KEY)\w*):-[^}]+\}/ }
];

const EXCLUIDOS = new Set(['package-lock.json', 'scripts/buscar-secretos.js']);
const SOLO_FORMATOS = new Set(['tests/config.test.js', 'src/config.js']);
const REGLAS_GENERICAS = new Set(['Credencial en URL', 'Secreto asignado en claro', 'Valor por defecto para un secreto']);

function archivosVersionados() {
  const salida = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' });
  return salida.split('\0').filter(Boolean);
}

function revisarContenido(archivo, contenido) {
  const hallazgos = [];
  if (EXCLUIDOS.has(archivo) || contenido.includes(0)) return hallazgos;
  contenido.toString('utf8').split('\n').forEach((linea, i) => {
    for (const regla of REGLAS) {
      if (SOLO_FORMATOS.has(archivo) && REGLAS_GENERICAS.has(regla.nombre)) continue;
      if (regla.patron.test(linea)) hallazgos.push(`${archivo}:${i + 1}  ${regla.nombre}`);
    }
  });
  return hallazgos;
}

function revisar() {
  return archivosVersionados()
    .filter((archivo) => fs.existsSync(archivo))
    .flatMap((archivo) => revisarContenido(archivo, fs.readFileSync(archivo)));
}

function principal() {
  const hallazgos = revisar();
  if (hallazgos.length > 0) {
    console.error('Posibles secretos en archivos versionados:');
    hallazgos.forEach((h) => console.error(`  ${h}`));
    return 1;
  }
  console.log('Sin secretos en archivos versionados.');
  return 0;
}

if (require.main === module) process.exitCode = principal();

module.exports = { revisarContenido };
