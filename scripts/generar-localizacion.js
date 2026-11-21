'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { esMX } = require('@clerk/localizations');

const VARIANTE = 'esMX';
const destino = path.join(__dirname, '..', 'public', 'js', 'clerk-es.js');
const version = require('@clerk/localizations/package.json').version;

const contenido = `window.LOCALIZACION_ES = ${JSON.stringify(esMX, null, 0)};
`;

fs.writeFileSync(destino, contenido);
console.log(`${path.relative(process.cwd(), destino)}: ${Math.round(contenido.length / 1024)} KB (${VARIANTE} ${version})`);
