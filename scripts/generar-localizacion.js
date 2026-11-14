'use strict';

// Genera public/js/clerk-es.js a partir de @clerk/localizations.
// El archivo se versiona para que la interfaz no dependa de un CDN externo.
// Regenerar con: npm run localizacion

const fs = require('node:fs');
const path = require('node:path');
const { esMX } = require('@clerk/localizations');

const VARIANTE = 'esMX';
const destino = path.join(__dirname, '..', 'public', 'js', 'clerk-es.js');
const version = require('@clerk/localizations/package.json').version;

const contenido = `/* Traduccion al espanol del formulario de acceso.
   Generado desde @clerk/localizations ${version} (${VARIANTE}).
   No editar a mano: ejecutar "npm run localizacion". */

window.LOCALIZACION_ES = ${JSON.stringify(esMX, null, 0)};
`;

fs.writeFileSync(destino, contenido);
console.log(`${path.relative(process.cwd(), destino)}: ${Math.round(contenido.length / 1024)} KB (${VARIANTE} ${version})`);
