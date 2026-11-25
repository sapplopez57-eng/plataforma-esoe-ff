'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { comprobar, revisarRelease, FUNCIONES_EXIGIDAS } = require('../scripts/comprobar-moodle');
const { crearClienteMoodle } = require('../src/integraciones/moodle');
const { crearMoodleFalso } = require('./ayuda');

const RED = { permitirRedPrivada: true, tiempoMaximoMs: 1500 };

function entornoDe(moodle, extra = {}) {
  return {
    NODE_ENV: 'test',
    INTEGRACIONES_RED_PRIVADA: 'true',
    MOODLE_URL: moodle.url,
    MOODLE_TOKEN_SERVICIO: moodle.estado.tokenServicio,
    ...extra
  };
}

async function conMoodle(opciones, trabajo) {
  const moodle = await crearMoodleFalso(opciones);
  try {
    return await trabajo(moodle, { cliente: crearClienteMoodle(RED) });
  } finally {
    await moodle.cerrar();
  }
}

test('moodle listo: un sitio bien puesto no deja fallos', async () => {
  await conMoodle({}, async (moodle, dependencias) => {
    const informe = await comprobar(entornoDe(moodle), dependencias);
    assert.deepEqual(informe.fallos, []);
    assert.equal(informe.datos.sitio, 'Moodle de pruebas');
    assert.equal(informe.datos.release, '4.5');
    assert.deepEqual(informe.datos.archivosExpuestos, []);
    assert.equal(informe.datos.funcionesDisponibles, 4);
  });
});

test('moodle listo: una MOODLE_URL que no sirve se rechaza antes de salir a la red', async () => {
  for (const url of ['', 'no-es-una-url', 'http://sitio.ejemplo.hn', 'https://sitio.ejemplo.hn/con/ruta?x=1']) {
    const informe = await comprobar({ NODE_ENV: 'test', MOODLE_URL: url });
    assert.equal(informe.fallos.length, 1, url);
    assert.match(informe.fallos[0], /MOODLE_URL no sirve/);
    assert.equal(informe.datos.url, undefined);
  }
});

test('moodle listo: se detecta el DocumentRoot mal puesto que expone el arbol interno', async () => {
  await conMoodle({ exponeArbolInterno: true }, async (moodle, dependencias) => {
    const informe = await comprobar(entornoDe(moodle), dependencias);
    assert.ok(informe.datos.archivosExpuestos.includes('composer.json'));
    assert.ok(informe.datos.archivosExpuestos.includes('composer.lock'));
    const fallo = informe.fallos.find((f) => f.includes('DocumentRoot'));
    assert.ok(fallo, informe.fallos.join(' | '));
    assert.match(fallo, /public\//);
  });
});

test('moodle listo: sin servicios web ni servicio movil son dos fallos distintos', async () => {
  await conMoodle({ serviciosWeb: false }, async (moodle, dependencias) => {
    const informe = await comprobar(entornoDe(moodle), dependencias);
    assert.ok(informe.fallos.some((f) => f.includes('servicios web')));
    assert.ok(informe.fallos.some((f) => f.includes('moodle_mobile_app')));
  });
});

test('moodle listo: si al token le falta una funcion exigida, es fallo; si falta la de notas, aviso', async () => {
  await conMoodle({ funciones: FUNCIONES_EXIGIDAS.slice(0, 2) }, async (moodle, dependencias) => {
    const informe = await comprobar(entornoDe(moodle), dependencias);
    const fallo = informe.fallos.find((f) => f.includes('core_user_get_users_by_field'));
    assert.ok(fallo, informe.fallos.join(' | '));
    assert.ok(informe.avisos.some((a) => a.includes('gradereport_overview_get_course_grades')));
    assert.ok(informe.avisos.some((a) => a.includes('calificaciones del portal se veran vacias')));
  });
});

test('moodle listo: sin token de servicio se avisa y no se comprueban las funciones', async () => {
  await conMoodle({}, async (moodle, dependencias) => {
    const informe = await comprobar(entornoDe(moodle, { MOODLE_TOKEN_SERVICIO: '' }), dependencias);
    assert.deepEqual(informe.fallos, []);
    assert.ok(informe.avisos.some((a) => a.includes('MOODLE_TOKEN_SERVICIO no definido')));
    assert.equal(informe.datos.funcionesDisponibles, undefined);
  });
});

test('moodle listo: un token que la plataforma rechaza se reporta como tal', async () => {
  await conMoodle({}, async (moodle, dependencias) => {
    const informe = await comprobar(entornoDe(moodle, { MOODLE_TOKEN_SERVICIO: 'token-que-no-existe-0123456789' }), dependencias);
    assert.ok(informe.fallos.some((f) => f.includes('El token de servicio no sirve')));
  });
});

test('moodle listo: el mantenimiento se avisa en vez de romper la comprobacion', async () => {
  await conMoodle({}, async (moodle, dependencias) => {
    moodle.estado.enMantenimientoCli = true;
    const informe = await comprobar(entornoDe(moodle), dependencias);
    assert.ok(informe.fallos.some((f) => f.includes('No se pudo interrogar a la plataforma')));
    assert.match(informe.fallos[0], /mantenimiento/);
  });
});

test('moodle listo: una version de desarrollo es fallo en produccion y aviso fuera', () => {
  for (const release of ['6.0dev (Build: 20261124)', '5.4dev', '6.0beta', '5.3rc1', '6.0alpha']) {
    const enProduccion = { datos: {}, fallos: [], avisos: [] };
    revisarRelease(release, true, enProduccion);
    assert.equal(enProduccion.fallos.length, 1, release);
    assert.match(enProduccion.fallos[0], /rama de desarrollo/);
    assert.match(enProduccion.fallos[0], /expedientes reales/);

    const fuera = { datos: {}, fallos: [], avisos: [] };
    revisarRelease(release, false, fuera);
    assert.deepEqual(fuera.fallos, [], release);
    assert.equal(fuera.avisos.length, 1, release);
  }
});

test('moodle listo: una version estable pasa sin ruido, en produccion tambien', () => {
  for (const release of ['4.5', '5.3 (Build: 20260600)', '5.0.2+ (Build: 20250701)']) {
    const informe = { datos: {}, fallos: [], avisos: [] };
    revisarRelease(release, true, informe);
    assert.deepEqual(informe.fallos, [], release);
    assert.deepEqual(informe.avisos, [], release);
    assert.equal(informe.datos.release, release);
  }
});

test('moodle listo: una version ausente se avisa sin romper', () => {
  const informe = { datos: {}, fallos: [], avisos: [] };
  revisarRelease('', true, informe);
  assert.deepEqual(informe.fallos, []);
  assert.match(informe.avisos[0], /no declaro su version/);
});
