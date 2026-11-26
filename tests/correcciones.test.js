'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { levantar, como, crearBaseDePrueba, ENTORNO_CON_SESION, URL_ADMIN } = require('./ayuda');
const { redactarTexto, crearRegistro } = require('../src/registro');
const { atenderErroresDeCliente } = require('../src/errores-de-cliente');
const { comprobarDespliegue } = require('../scripts/comprobar-despliegue');
const { leerMigraciones } = require('../src/migraciones');
const { LIMITE_LISTADO } = require('../src/tope-de-listado');
const paquete = require('../package.json');

const sinBase = URL_ADMIN ? false : { skip: 'Sin PRUEBAS_DATABASE_URL' };
const ANA = como('CATEDRATICO', 'user_fix_ana');
const CARLA = como('ESTUDIANTE', 'user_fix_carla');
let base;
let servidor;
const d = {};

async function pedir(metodo, ruta, cuerpo, quien) {
  const r = metodo === 'GET' ? await servidor.pedir(ruta, { headers: quien })
    : await servidor.enviar(ruta, cuerpo, quien, metodo);
  return { status: r.status, cuerpo: await r.json() };
}

const tarea = (extra = {}, cabeceras = {}) => pedir('POST', `/api/clases/${d.clase}/curso/tareas`,
  { titulo: 'T', instrucciones: 'I', fecha_entrega: '2030-01-01T00:00:00Z', publicada: true, ...extra },
  { ...ANA, ...cabeceras });

before(async () => {
  if (!URL_ADMIN) return;
  base = await crearBaseDePrueba();
  const { db } = base;
  const uno = async (sql, p) => (await db.consultar(sql, p)).rows[0].id;
  const periodo = await uno("INSERT INTO periodos_lectivos (codigo, nombre, modalidad, fecha_inicio, fecha_fin) VALUES ('FIX-P','P','SEMESTRAL','2026-01-10','2026-06-30') RETURNING id");
  d.promA = await uno("INSERT INTO promociones (codigo, nombre, anio_ingreso, anio_egreso) VALUES ('FIX-A','A',2026,2028) RETURNING id");
  d.promB = await uno("INSERT INTO promociones (codigo, nombre, anio_ingreso, anio_egreso) VALUES ('FIX-B','B',2025,2027) RETURNING id");
  const materia = await uno("INSERT INTO materias (codigo, nombre) VALUES ('FIX-M','M') RETURNING id");
  const cat = await uno("INSERT INTO catedraticos (dni, nombres, apellidos, titulo) VALUES ('FIX-C','Ana','R','Lic.') RETURNING id");
  d.est = await uno("INSERT INTO estudiantes (codigo_alumno, dni, nombres, apellidos, fecha_nacimiento, promocion_id) VALUES ('FIX-E','FIX-E','Carla','D','2005-03-01',$1) RETURNING id", [d.promA]);
  d.clase = await uno("INSERT INTO clases (codigo_clase, periodo_id, promocion_id, materia_id, catedratico_id, horario) VALUES ('FIX-1',$1,$2,$3,$4,'L') RETURNING id", [periodo, d.promA, materia, cat]);
  for (const [cuenta, rol, ref] of [['user_fix_ana', 'CATEDRATICO', cat], ['user_fix_carla', 'ESTUDIANTE', d.est]]) {
    await db.consultar('INSERT INTO usuarios (username, proveedor_id, rol, nombre_completo, referencia_id) VALUES ($1,$1,$2,$1,$3)', [cuenta, rol, ref]);
  }
  servidor = await levantar(ENTORNO_CON_SESION, { db });
  await pedir('PUT', `/api/clases/${d.clase}/curso`, { titulo: 'C', publicado: true }, ANA);
});

after(async () => {
  await servidor?.cerrar();
  await base?.cerrar();
});

test('correcciones: el registro oculta credenciales en todas sus formas', () => {
  for (const [texto, secreto] of [
    [['postgres:/', '/usuario:ClaveCorta1', '@db/base'].join(''), 'ClaveCorta1'],
    [['postgres:/', '/usuario:Clave@Con', '@Arrobas@db/base'].join(''), 'Arrobas'],
    ['Authorization: Bearer abc.def.ghijk', 'abc.def'],
    ['fallo eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln', 'eyJzdWI'],
    ['llave sk_live_abc123', 'abc123'],
    ['DNI 0801-1999-12345', '1999-12345']
  ]) assert.ok(!redactarTexto(texto).includes(secreto), redactarTexto(texto));
  assert.equal(redactarTexto('ver https://esoe.hn/ruta:1 hoy'), 'ver https://esoe.hn/ruta:1 hoy');
});

test('correcciones: el script preparar-base existe', () => {
  assert.match(paquete.scripts['preparar-base'], /scripts\/preparar-base\.js/);
});

test('correcciones: replicacion y falta de permisos del aula impiden el despliegue', async () => {
  const conectar = async () => ({
    end: async () => {},
    query: async (sql) => {
      if (/pg_stat_ssl/.test(sql)) return { rows: [{ ssl: true }] };
      if (/pg_roles/.test(sql)) return { rows: [{ usuario: 'r', rolreplication: true }] };
      if (/transaction_read_only/.test(sql)) return { rows: [{ disponible: true }] };
      if (/has_table_privilege/.test(sql)) return { rows: [{ inserta: true, actualiza: true, aula: false }] };
      return { rows: [{ version: leerMigraciones().length }] };
    }
  });
  const { fallos } = await comprobarDespliegue({ env: { DATABASE_URL: 'postgres://r:p@localhost/x' }, conectar });
  assert.ok(fallos.some((f) => f.includes('replicacion')), fallos.join(' | '));
  assert.ok(fallos.some((f) => f.includes('escribir en las tablas')), fallos.join(' | '));
});

test('correcciones: la consulta de permisos del aula funciona en PostgreSQL', sinBase, async () => {
  const informe = await comprobarDespliegue({ env: { DATABASE_URL: base.url } });
  assert.equal(informe.datos.puedeEscribir, true, informe.fallos.join(' | '));
});

test('correcciones: la misma clave no duplica la tarea y con otros datos choca', sinBase, async () => {
  const cabecera = { 'Idempotency-Key': 'clave-prueba-0001' };
  const [a, b] = await Promise.all([tarea({}, cabecera), tarea({}, cabecera)]);
  assert.deepEqual([a.status, b.status].sort(), [200, 201]);
  assert.equal(a.cuerpo.tarea.id, b.cuerpo.tarea.id);
  assert.equal(a.cuerpo.tarea.huella_peticion, undefined);
  assert.equal((await tarea({ titulo: 'Otra' }, cabecera)).cuerpo.codigo, 'CLAVE_REUTILIZADA');
  assert.equal((await tarea({}, { 'Idempotency-Key': 'corta' })).status, 422);
  assert.equal((await tarea()).status, 201);
});

test('correcciones: una entrega devuelta no se reenvia sin cambios', sinBase, async () => {
  const t = (await tarea()).cuerpo.tarea.id;
  d.entrega = (await pedir('PUT', `/api/tareas/${t}/entrega`, { estado: 'ENTREGADA', texto: 'v1' }, CARLA)).cuerpo.entrega.id;
  await pedir('PUT', `/api/entregas/${d.entrega}/calificacion`, { estado: 'DEVUELTA', retroalimentacion: 'corrija' }, ANA);
  const igual = await pedir('PUT', `/api/tareas/${t}/entrega`, { estado: 'ENTREGADA', texto: 'v1' }, CARLA);
  assert.equal(igual.cuerpo.codigo, 'SIN_CAMBIOS');
  const previa = await pedir('GET', `/api/tareas/${t}/entrega`, null, CARLA);
  assert.equal(previa.cuerpo.entrega.retroalimentacion, 'corrija');
  assert.equal((await pedir('PUT', `/api/tareas/${t}/entrega`, { estado: 'ENTREGADA', texto: 'v2' }, CARLA)).status, 200);
});

test('correcciones: los listados del aula tienen tope', sinBase, async () => {
  await base.db.consultar(`INSERT INTO tareas (institucion_id, curso_id, titulo, instrucciones, fecha_entrega, publicada)
    SELECT institucion_id, id, 'm', 'i', now(), TRUE FROM cursos, generate_series(1, $1)`, [LIMITE_LISTADO + 5]);
  for (const [ruta, quien] of [[`/api/clases/${d.clase}/curso`, ANA], ['/api/mis-tareas', CARLA]]) {
    assert.equal((await pedir('GET', ruta, null, quien)).cuerpo.tareas.length, LIMITE_LISTADO);
  }
});

test('correcciones: la baja pierde el acceso y fuera de la promocion no se califica', sinBase, async () => {
  await base.db.consultar("UPDATE estudiantes SET estado = 'BAJA' WHERE id = $1", [d.est]);
  assert.equal((await pedir('GET', `/api/clases/${d.clase}/curso`, null, CARLA)).status, 403);
  assert.deepEqual((await pedir('GET', '/api/mis-tareas', null, CARLA)).cuerpo.tareas, []);
  await base.db.consultar("UPDATE estudiantes SET estado = 'ACTIVO', promocion_id = $2 WHERE id = $1", [d.est, d.promB]);
  const r = await pedir('PUT', `/api/entregas/${d.entrega}/calificacion`, { estado: 'CALIFICADA', nota: 90 }, ANA);
  assert.equal(r.status, 409);
  assert.equal(r.cuerpo.codigo, 'FUERA_DE_PROMOCION');
});

test('correcciones: el 408 lleva identificador de peticion y queda registrado', async () => {
  const lineas = [];
  const srv = http.createServer({ headersTimeout: 600, requestTimeout: 900, connectionsCheckingInterval: 200 },
    (_req, res) => res.end());
  atenderErroresDeCliente(srv, crearRegistro({ salida: (l) => lineas.push(l) }));
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const respuesta = await new Promise((ok) => {
    let texto = '';
    const c = net.connect(srv.address().port, '127.0.0.1', () => c.write('GET / HTTP/1.1\r\nHost: a\r\n'));
    c.on('data', (x) => { texto += x; });
    c.on('close', () => ok(texto));
  });
  await new Promise((ok) => srv.close(ok));
  const id = /x-peticion-id: ([\w-]+)/.exec(respuesta)[1];
  assert.match(respuesta, /^HTTP\/1\.1 408/);
  assert.equal(JSON.parse(lineas[0]).peticion, id);
});
