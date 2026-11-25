'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const {
  cargarConfig, validarConfig, tlsDeBaseDeDatos, esHostLocal,
  urlSinParametrosTls, parametrosTlsDeUrl, modoImplicitoPorUrl
} = require('../src/config');
const { URL_ADMIN } = require('./ayuda');

const BASE_PRODUCCION = Object.freeze({
  NODE_ENV: 'production',
  CLERK_PUBLISHABLE_KEY: `pk_test_${Buffer.from('clerk.pruebas.example$').toString('base64')}`,
  CLERK_SECRET_KEY: `sk_test_${'p'.repeat(40)}`,
  ORIGEN_PUBLICO: 'https://esoe.pruebas.example',
  CLAVE_CIFRADO: 'a'.repeat(64),
  RATE_LIMIT_STORE: 'postgres'
});

const REMOTA = 'postgresql://esoe@base.ejemplo.hn:5432/esoe_sms';

test('tls url: el sslmode de la URL de verdad anula el objeto ssl de la aplicacion', async (t) => {
  if (!URL_ADMIN) return t.skip('PRUEBAS_DATABASE_URL no definida');

  const conSslmode = new Client({
    connectionString: `${URL_ADMIN}?sslmode=disable`,
    ssl: { rejectUnauthorized: true }
  });
  await conSslmode.connect();
  const { rows } = await conSslmode.query('SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()');
  await conSslmode.end();
  assert.equal(rows[0].ssl, false,
    'si esto deja de ser false, node-postgres cambio y esta defensa habria que revisarla');

  const limpia = new Client({
    connectionString: urlSinParametrosTls(`${URL_ADMIN}?sslmode=disable`),
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 3000
  });
  await assert.rejects(() => limpia.connect(), (error) => {
    assert.match(String(error.message), /ssl|certificate|altnames|self[- ]signed/i,
      `se esperaba un fallo de TLS y llego: ${error.message}`);
    return true;
  }, 'quitado el sslmode, manda el objeto ssl: o el servidor no habla TLS, o el certificado no verifica');
  await limpia.end().catch(() => {});

  const sinTls = new Client({
    connectionString: urlSinParametrosTls(`${URL_ADMIN}?sslmode=disable`),
    ssl: false,
    connectionTimeoutMillis: 3000
  });
  await sinTls.connect();
  await sinTls.end();
});

test('tls url: una politica declarada que la URL contradiria no arranca', () => {
  for (const [sslmode, pedido] of [['disable', 'verificado'], ['disable', 'requerido']]) {
    assert.throws(
      () => tlsDeBaseDeDatos({ DATABASE_URL: `${REMOTA}?sslmode=${sslmode}`, DB_SSL: pedido }),
      (error) => {
        assert.equal(error.code, 'CONFIG_INVALIDA');
        assert.match(error.message, /sslmode de DATABASE_URL/);
        assert.match(error.message, /mas debil/);
        return true;
      }, `${sslmode} contra ${pedido}`);
  }
});

test('tls url: sin DB_SSL se adopta lo que pide la URL y la URL se limpia', () => {
  for (const [sslmode, esperado] of [['disable', 'desactivado'], ['require', 'verificado'], ['verify-ca', 'verificado'], ['verify-full', 'verificado']]) {
    assert.equal(tlsDeBaseDeDatos({ DATABASE_URL: `${REMOTA}?sslmode=${sslmode}` }).modo, esperado);
    assert.equal(modoImplicitoPorUrl(`${REMOTA}?sslmode=${sslmode}`), esperado);
  }
  const config = cargarConfig({ NODE_ENV: 'test', DATABASE_URL: `${REMOTA}?sslmode=verify-full` });
  assert.equal(config.tlsBaseDeDatos, 'verificado');
  assert.equal(config.databaseUrl.includes('sslmode'), false, 'la url que usa la aplicacion no lleva sslmode');
});

test('tls url: si la URL pide mas TLS que la politica, se adopta el mas fuerte sin romper', () => {
  assert.equal(tlsDeBaseDeDatos({ DATABASE_URL: `${REMOTA}?sslmode=verify-full`, DB_SSL: 'requerido' }).modo, 'verificado');
  assert.equal(tlsDeBaseDeDatos({ DATABASE_URL: `${REMOTA}?sslmode=require`, DB_SSL: 'desactivado' }).modo, 'verificado');
  assert.equal(tlsDeBaseDeDatos({ DATABASE_URL: `${REMOTA}?sslmode=require`, DB_SSL: 'verificado' }).modo, 'verificado');
});

test('tls url: require se honra como verificado, no como cifrado sin comprobar', () => {
  assert.equal(modoImplicitoPorUrl(`${REMOTA}?sslmode=require`), 'verificado');
  const { modo, ssl } = tlsDeBaseDeDatos({ DATABASE_URL: `${REMOTA}?sslmode=require` });
  assert.equal(modo, 'verificado');
  assert.deepEqual(ssl, { rejectUnauthorized: true },
    'la plataforma no hace TLS sin comprobar el certificado salvo que se pida con DB_SSL a proposito');
});

test('tls url: un sslmode ambiguo no se admite', () => {
  for (const sslmode of ['prefer', 'allow', 'inventado']) {
    assert.throws(() => tlsDeBaseDeDatos({ DATABASE_URL: `${REMOTA}?sslmode=${sslmode}` }), /no admite/);
  }
});

test('tls url: los demas parametros de TLS en la URL se rechazan con su nombre', () => {
  for (const nombre of ['ssl', 'sslrootcert', 'sslcert', 'sslkey', 'sslnegotiation']) {
    assert.throws(() => tlsDeBaseDeDatos({ DATABASE_URL: `${REMOTA}?${nombre}=algo`, DB_SSL: 'verificado' }), (error) => {
      assert.match(error.message, new RegExp(nombre));
      assert.match(error.message, /DB_SSL y DB_CA_CERT/);
      return true;
    }, nombre);
  }
});

test('tls url: limpiar la URL respeta lo que no es TLS y no toca una URL ya limpia', () => {
  assert.equal(
    urlSinParametrosTls('postgresql://u:p@h:5432/d?sslmode=require&application_name=esoe'),
    'postgresql://u:p@h:5432/d?application_name=esoe');
  assert.equal(urlSinParametrosTls('postgresql://u:p@h:5432/d'), 'postgresql://u:p@h:5432/d');
  assert.equal(urlSinParametrosTls('postgresql://u:p@h:5432/d?sslmode=require'), 'postgresql://u:p@h:5432/d');
  assert.equal(urlSinParametrosTls(''), '');
  assert.equal(urlSinParametrosTls('no-es-una-url'), 'no-es-una-url');
  assert.deepEqual(parametrosTlsDeUrl('postgresql://u:p@h/d?sslmode=require&sslcert=x').map((p) => p.nombre), ['sslmode', 'sslcert']);
});

test('tls url: los hosts se clasifican por lo que son, no por como empiezan', () => {
  for (const host of ['localhost', '127.0.0.1', '::1', '[::1]', '10.0.0.5', '192.168.1.9', '172.20.0.3', 'fc00::1', 'esoe-db', 'postgres', 'db.local', 'base.internal']) {
    assert.equal(esHostLocal(host), true, `${host} deberia ser local`);
  }
  for (const host of ['10.database.example', '192.168.ejemplo.hn', '172.16.proveedor.net', '2606:4700::1111', 'base.ejemplo.hn', 'db.supabase.co']) {
    assert.equal(esHostLocal(host), false, `${host} deberia ser remoto`);
  }
});

test('tls url: el host de docker-compose sigue siendo local', () => {
  assert.equal(esHostLocal('esoe-db'), true, 'si esto cambia, docker-compose deja de arrancar');
  const config = cargarConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://esoe_app:x@esoe-db:5432/esoe_sms' });
  assert.equal(config.tlsBaseDeDatos, 'desactivado');
});

test('tls url: en produccion una base remota con TLS sin verificar no arranca', () => {
  const errores = validarConfig({
    esProduccion: true, databaseUrl: REMOTA, tlsBaseDeDatos: 'requerido',
    clerk: { habilitado: true, origenesAutorizados: ['https://esoe.pruebas.example'] },
    integraciones: { claveCifrado: 'a'.repeat(64) }, voz: {}, limitePeticiones: { almacen: 'postgres' }
  });
  const error = errores.find((e) => e.includes('requerido'));
  assert.ok(error, errores.join(' | '));
  assert.match(error, /suplantar/);
});

test('tls url: en produccion una base remota con TLS verificado arranca', () => {
  const config = cargarConfig({ ...BASE_PRODUCCION, DATABASE_URL: REMOTA, DB_SSL: 'verificado' });
  assert.equal(config.tlsBaseDeDatos, 'verificado');
  assert.equal(config.baseDeDatos.ssl.rejectUnauthorized, true);
});

test('tls url: un host remoto escrito como prefijo privado ya no se cuela sin TLS', () => {
  const errores = validarConfig({
    esProduccion: true, databaseUrl: 'postgresql://u:p@10.database.example:5432/esoe',
    tlsBaseDeDatos: 'desactivado',
    clerk: { habilitado: true, origenesAutorizados: ['https://esoe.pruebas.example'] },
    integraciones: { claveCifrado: 'a'.repeat(64) }, voz: {}, limitePeticiones: { almacen: 'postgres' }
  });
  assert.ok(errores.some((e) => e.includes('DB_SSL no puede quedar desactivado')), errores.join(' | '));
});
