'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { comprobarDespliegue } = require('../scripts/comprobar-despliegue');
const { leerMigraciones } = require('../src/migraciones');

const VERSION = leerMigraciones().length;

const ENTORNO_PRODUCCION = Object.freeze({
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://aws-0-us-east-1.pooler.supabase.com:6543/postgres',
  CLERK_PUBLISHABLE_KEY: `pk_live_${Buffer.from('clerk.esoe.example$').toString('base64')}`,
  CLERK_SECRET_KEY: `sk_live_${'s'.repeat(40)}`,
  ORIGEN_PUBLICO: 'https://esoe.ejemplo.hn',
  CLAVE_CIFRADO: 'b'.repeat(64),
  RATE_LIMIT_STORE: 'postgres'
});

function clienteFalso(respuestas = {}) {
  const estado = {
    cifrada: true, superusuario: false, crearBases: false, escribe: true,
    escritura: true, version: VERSION, cerrado: false, ssl: null, ...respuestas
  };
  const cliente = {
    query: async (texto) => {
      if (texto.includes('pg_stat_ssl')) return { rows: [{ ssl: estado.cifrada }] };
      if (texto.includes('rolsuper')) {
        return { rows: [{ usuario: 'esoe_app', rolsuper: estado.superusuario,
          rolcreatedb: estado.crearBases, rolcreaterole: false, rolbypassrls: false }] };
      }
      if (texto.includes('has_table_privilege')) {
        return { rows: [{ inserta: estado.escribe, actualiza: estado.escribe, aula: estado.escribe }] };
      }
      if (texto.includes('pg_is_in_recovery')) return { rows: [{ disponible: estado.escritura }] };
      if (texto.includes('migraciones_aplicadas')) {
        if (estado.version === 'sin_tabla') {
          const error = new Error('no existe la relacion migraciones_aplicadas');
          error.code = '42P01';
          throw error;
        }
        return { rows: [{ version: estado.version }] };
      }
      throw new Error(`consulta inesperada: ${texto}`);
    },
    end: async () => { estado.cerrado = true; }
  };
  return { estado, conectar: async (_url, ssl) => { estado.ssl = ssl; return cliente; } };
}

test('despliegue: un entorno de produccion completo y al dia queda listo', async () => {
  const { estado, conectar } = clienteFalso();
  const informe = await comprobarDespliegue({ env: ENTORNO_PRODUCCION, conectar });
  assert.deepEqual(informe.fallos, []);
  assert.deepEqual(informe.avisos, []);
  assert.equal(informe.datos.tls, 'verificado');
  assert.equal(informe.datos.conexionCifrada, true);
  assert.equal(informe.datos.esquemaAplicado, VERSION);
  assert.equal(informe.datos.esquemaEsperado, VERSION);
  assert.deepEqual(estado.ssl, { rejectUnauthorized: true });
  assert.equal(estado.cerrado, true);
});

test('despliegue: una configuracion incompleta se detiene antes de tocar la base', async () => {
  let intentos = 0;
  const informe = await comprobarDespliegue({
    env: { NODE_ENV: 'production', DATABASE_URL: '' },
    conectar: async () => { intentos += 1; throw new Error('no deberia conectar'); }
  });
  assert.equal(intentos, 0);
  assert.ok(informe.fallos.length > 0);
  assert.ok(informe.fallos[0].includes('Configuracion invalida'));
});

test('despliegue: sin DATABASE_URL fuera de produccion se avisa y se reporta la falta', async () => {
  const informe = await comprobarDespliegue({ env: { NODE_ENV: 'development' }, conectar: async () => { throw new Error('x'); } });
  assert.ok(informe.avisos.some((a) => a.includes('development')));
  assert.ok(informe.fallos.some((f) => f.includes('DATABASE_URL')));
});

test('despliegue: una conexion remota sin cifrar es un fallo', async () => {
  const { conectar } = clienteFalso({ cifrada: false });
  const informe = await comprobarDespliegue({ env: ENTORNO_PRODUCCION, conectar });
  assert.ok(informe.fallos.some((f) => f.includes('sin cifrar')), informe.fallos.join(' | '));
});

test('despliegue: una base local sin cifrar no es un fallo', async () => {
  const { conectar } = clienteFalso({ cifrada: false });
  const informe = await comprobarDespliegue({
    env: { NODE_ENV: 'development', DATABASE_URL: 'postgresql://u:c@127.0.0.1:5432/esoe' }, conectar });
  assert.ok(!informe.fallos.some((f) => f.includes('sin cifrar')), informe.fallos.join(' | '));
});

test('despliegue: un rol con privilegios de administracion es un fallo', async () => {
  const { conectar } = clienteFalso({ superusuario: true });
  const informe = await comprobarDespliegue({ env: ENTORNO_PRODUCCION, conectar });
  assert.ok(informe.fallos.some((f) => f.includes('superusuario')), informe.fallos.join(' | '));
});

test('despliegue: una base en solo lectura es un fallo', async () => {
  const { conectar } = clienteFalso({ escritura: false });
  const informe = await comprobarDespliegue({ env: ENTORNO_PRODUCCION, conectar });
  assert.ok(informe.fallos.some((f) => f.includes('escrituras')), informe.fallos.join(' | '));
});

test('despliegue: un esquema atrasado o mas nuevo se reporta con la version', async () => {
  const atrasado = await comprobarDespliegue({ env: ENTORNO_PRODUCCION, conectar: clienteFalso({ version: VERSION - 1 }).conectar });
  assert.ok(atrasado.fallos.some((f) => f.includes('npm run migrar')), atrasado.fallos.join(' | '));
  const nuevo = await comprobarDespliegue({ env: ENTORNO_PRODUCCION, conectar: clienteFalso({ version: VERSION + 1 }).conectar });
  assert.ok(nuevo.fallos.some((f) => f.includes('Actualice el codigo')), nuevo.fallos.join(' | '));
});

test('despliegue: una base sin esquema pide migrar', async () => {
  const { conectar } = clienteFalso({ version: 'sin_tabla' });
  const informe = await comprobarDespliegue({ env: ENTORNO_PRODUCCION, conectar });
  assert.ok(informe.fallos.some((f) => f.includes('no tiene el esquema')), informe.fallos.join(' | '));
});

test('despliegue: una base inalcanzable se reporta sin lanzar', async () => {
  const informe = await comprobarDespliegue({
    env: ENTORNO_PRODUCCION, conectar: async () => { throw new Error('tiempo de conexion agotado'); } });
  assert.ok(informe.fallos.some((f) => f.includes('No se pudo conectar')), informe.fallos.join(' | '));
});

test('despliegue: un rol con otros privilegios de administracion tampoco pasa', async () => {
  const { conectar } = clienteFalso({ crearBases: true });
  const informe = await comprobarDespliegue({ env: ENTORNO_PRODUCCION, conectar });
  assert.ok(informe.fallos.some((f) => f.includes('crear bases')), informe.fallos.join(' | '));
});

test('despliegue: una instancia de Clerk de desarrollo no pasa a produccion', async () => {
  const { conectar } = clienteFalso();
  const informe = await comprobarDespliegue({
    env: {
      ...ENTORNO_PRODUCCION,
      CLERK_PUBLISHABLE_KEY: `pk_test_${Buffer.from('alegre-puma-12.clerk.accounts.dev$').toString('base64')}`,
      CLERK_SECRET_KEY: `sk_test_${'s'.repeat(40)}`
    },
    conectar
  });
  assert.equal(informe.datos.instanciaClerk, 'desarrollo');
  assert.ok(informe.fallos.some((f) => f.includes('CLERK_PUBLISHABLE_KEY')), informe.fallos.join(' | '));
  assert.ok(informe.fallos.some((f) => f.includes('CLERK_SECRET_KEY')), informe.fallos.join(' | '));
  assert.ok(informe.fallos.some((f) => f.includes('accounts.dev')), informe.fallos.join(' | '));
});

test('despliegue: una llave viva sobre un dominio accounts.dev tampoco pasa', async () => {
  const { conectar } = clienteFalso();
  const informe = await comprobarDespliegue({
    env: {
      ...ENTORNO_PRODUCCION,
      CLERK_PUBLISHABLE_KEY: `pk_live_${Buffer.from('alegre-puma-12.clerk.accounts.dev$').toString('base64')}`
    },
    conectar
  });
  assert.equal(informe.datos.instanciaClerk, 'desarrollo');
  assert.ok(informe.fallos.some((f) => f.includes('accounts.dev')), informe.fallos.join(' | '));
});

test('despliegue: fuera de produccion la instancia de desarrollo solo avisa', async () => {
  const { conectar } = clienteFalso();
  const informe = await comprobarDespliegue({
    env: {
      ...ENTORNO_PRODUCCION,
      NODE_ENV: 'development',
      CLERK_PUBLISHABLE_KEY: `pk_test_${Buffer.from('alegre-puma-12.clerk.accounts.dev$').toString('base64')}`,
      CLERK_SECRET_KEY: `sk_test_${'s'.repeat(40)}`
    },
    conectar
  });
  assert.equal(informe.datos.instanciaClerk, 'desarrollo');
  assert.ok(informe.avisos.some((a) => a.includes('Clerk es de desarrollo')), informe.avisos.join(' | '));
  assert.ok(!informe.fallos.some((f) => f.includes('Clerk')), informe.fallos.join(' | '));
});

test('despliegue: una instancia de produccion queda registrada en el informe', async () => {
  const { conectar } = clienteFalso();
  const informe = await comprobarDespliegue({ env: ENTORNO_PRODUCCION, conectar });
  assert.equal(informe.datos.instanciaClerk, 'produccion');
  assert.equal(informe.datos.dominioClerk, 'clerk.esoe.example');
});

test('despliegue: un rol sin permiso real de escritura es un fallo', async () => {
  const { conectar } = clienteFalso({ escribe: false });
  const informe = await comprobarDespliegue({ env: ENTORNO_PRODUCCION, conectar });
  assert.equal(informe.datos.puedeEscribir, false);
  assert.ok(informe.fallos.some((f) => f.includes('escribir en las tablas')), informe.fallos.join(' | '));
});
