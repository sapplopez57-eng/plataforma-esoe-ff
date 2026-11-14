'use strict';

// Revisa los archivos versionados en busca de secretos antes de cada entrega.
// Uso: node scripts/buscar-secretos.js   (sale con 1 si encuentra algo)

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
  {
    nombre: 'Secreto asignado en claro',
    patron: /\b(?:password|passwd|secret|token|api[_-]?key|clave|contrasena)\w*\s*[:=]\s*["']?[A-Za-z0-9+/_\-!@#%^&*]{12,}["']?\s*$/i
  },
  { nombre: 'Valor por defecto para un secreto', patron: /\$\{(?:\w*(?:PASSWORD|SECRET|TOKEN|KEY)\w*):-[^}]+\}/ }
];

// Archivos con credenciales ficticias de prueba, revisados a mano.
const EXCLUIDOS = new Set(['package-lock.json', 'scripts/buscar-secretos.js', 'tests/config.test.js', 'src/config.js']);

function archivosVersionados() {
  const salida = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' });
  return salida.split('\0').filter(Boolean);
}

function revisar() {
  const hallazgos = [];
  for (const archivo of archivosVersionados()) {
    if (EXCLUIDOS.has(archivo) || !fs.existsSync(archivo)) continue;
    const contenido = fs.readFileSync(archivo);
    if (contenido.includes(0)) continue;
    contenido.toString('utf8').split('\n').forEach((linea, i) => {
      for (const regla of REGLAS) {
        if (regla.patron.test(linea)) hallazgos.push(`${archivo}:${i + 1}  ${regla.nombre}`);
      }
    });
  }
  return hallazgos;
}

const hallazgos = revisar();
if (hallazgos.length > 0) {
  console.error('Posibles secretos en archivos versionados:');
  hallazgos.forEach((h) => console.error(`  ${h}`));
  process.exit(1);
}
console.log('Sin secretos en archivos versionados.');
