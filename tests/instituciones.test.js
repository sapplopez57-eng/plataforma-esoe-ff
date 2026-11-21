'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { levantar, como, crearBaseDePrueba, ENTORNO_CON_SESION, URL_ADMIN } = require('./ayuda');

const sinBase = URL_ADMIN ? false : { skip: 'Sin PRUEBAS_DATABASE_URL' };

const CUENTA = { esoe: 'user_inst_esoe', infop: 'user_inst_infop', estEsoe: 'user_inst_est' };
const ADMIN_ESOE = como('ADMIN', CUENTA.esoe);
const ADMIN_INFOP = como('ADMIN', CUENTA.infop);

let base;
let servidor;
let d;

const json = async (r) => ({ status: r.status, cuerpo: await r.json() });
const crear = async (ruta, cuerpo, quien) => {
  const r = await json(await servidor.enviar(ruta, cuerpo, quien));
  assert.equal(r.status, 201, `${ruta}: ${JSON.stringify(r.cuerpo)}`);
  return Object.values(r.cuerpo)[0];
};

before(async () => {
  if (!URL_ADMIN) return;
  base = await crearBaseDePrueba();
  const { db } = base;
  const { rows } = await db.consultar('SELECT codigo, id FROM instituciones');
  const inst = Object.fromEntries(rows.map((r) => [r.codigo, r.id]));
  const liga = (proveedor, rol, institucion, referencia = null) => db.consultar(
    `INSERT INTO usuarios (username, proveedor_id, rol, nombre_completo, institucion_id, referencia_id)
     VALUES ($1, $1, $2, $1, $3, $4)`, [proveedor, rol, institucion, referencia]);
  await liga(CUENTA.esoe, 'ADMIN', inst.ESOE);
  await liga(CUENTA.infop, 'ADMIN', inst.INFOP);
  servidor = await levantar(ENTORNO_CON_SESION, { db });

  const armar = async (quien) => {
    const periodo = await crear('/api/periodos', { codigo: 'P-2026', nombre: 'Periodo', modalidad: 'SEMESTRAL',
      fecha_inicio: '2026-01-10', fecha_fin: '2026-06-30' }, quien);
    const promocion = await crear('/api/promociones', { codigo: 'PROM-1', nombre: 'Promocion', anio_ingreso: 2026,
      anio_egreso: 2027 }, quien);
    const materia = await crear('/api/materias', { codigo: 'MAT-1', nombre: 'Materia' }, quien);
    const catedratico = await crear('/api/catedraticos', { dni: 'DNI-CAT', nombres: 'Ana', apellidos: 'Reyes',
      titulo: 'Lic.' }, quien);
    const estudiante = await crear('/api/estudiantes', { codigo_alumno: 'ALU-1', dni: 'DNI-COMUN', nombres: 'Carla',
      apellidos: 'Diaz', fecha_nacimiento: '2004-05-05', promocion_id: promocion.id }, quien);
    const clase = await crear('/api/clases', { codigo_clase: 'CL-1', periodo_id: periodo.id, promocion_id: promocion.id,
      materia_id: materia.id, catedratico_id: catedratico.id, horario: 'L 08:00' }, quien);
    return { periodo, promocion, materia, catedratico, estudiante, clase };
  };
  d = { inst, esoe: await armar(ADMIN_ESOE), infop: await armar(ADMIN_INFOP) };
  await liga(CUENTA.estEsoe, 'ESTUDIANTE', inst.ESOE, d.esoe.estudiante.id);
});

after(async () => {
  await servidor?.cerrar();
  await base?.cerrar();
});

test('instituciones: ESOE, UDH, INFOP y COPECO estan registradas con su campus virtual', sinBase, async () => {
  const { status, cuerpo } = await json(await servidor.pedir('/api/instituciones', { headers: ADMIN_INFOP }));
  assert.equal(status, 200);
  const porCodigo = Object.fromEntries(cuerpo.instituciones.map((i) => [i.codigo, i]));
  assert.deepEqual(Object.keys(porCodigo).sort(), ['COPECO', 'ESOE', 'INFOP', 'UDH']);
  assert.equal(cuerpo.instituciones[0].codigo, 'ESOE', 'la ESOE va primero');
  assert.equal(porCodigo.UDH.campus_virtual, 'https://aula.udh.edu.hn');
  assert.equal(porCodigo.INFOP.campus_virtual, 'https://plataformavirtual.infop.hn');
  assert.equal(porCodigo.COPECO.campus_virtual, 'https://cenicac.copeco.gob.hn');
  assert.equal(porCodigo.INFOP.propia, true, 'cada cuenta reconoce la suya');
  assert.equal(porCodigo.ESOE.propia, false);
  assert.equal((await servidor.pedir('/api/instituciones')).status, 401);
});

test('instituciones: los mismos codigos y el mismo DNI conviven en instituciones distintas', sinBase, async () => {
  assert.notEqual(d.esoe.estudiante.id, d.infop.estudiante.id);
  assert.equal(d.esoe.estudiante.dni, d.infop.estudiante.dni);
  assert.equal(d.esoe.clase.codigo_clase, d.infop.clase.codigo_clase);
  const repetido = await json(await servidor.enviar('/api/materias', { codigo: 'MAT-1', nombre: 'Otra' }, ADMIN_INFOP));
  assert.equal(repetido.status, 409);
});

test('instituciones: cada administracion ve solo lo suyo', sinBase, async () => {
  for (const [quien, propio, ajeno] of [[ADMIN_ESOE, d.esoe, d.infop], [ADMIN_INFOP, d.infop, d.esoe]]) {
    for (const [ruta, clave, nombre] of [
      ['/api/periodos', 'periodos', 'periodo'], ['/api/promociones', 'promociones', 'promocion'],
      ['/api/materias', 'materias', 'materia'], ['/api/catedraticos', 'catedraticos', 'catedratico'],
      ['/api/estudiantes', 'estudiantes', 'estudiante'], ['/api/clases', 'clases', 'clase']]) {
      const ids = (await json(await servidor.pedir(ruta, { headers: quien }))).cuerpo[clave].map((x) => x.id);
      assert.ok(ids.includes(propio[nombre].id), `${ruta}: ve lo propio`);
      assert.ok(!ids.includes(ajeno[nombre].id), `${ruta}: no ve lo ajeno`);
    }
  }
  const est = (await json(await servidor.pedir('/api/catedraticos', { headers: como('ESTUDIANTE', CUENTA.estEsoe) })))
    .cuerpo.catedraticos.map((c) => c.id);
  assert.deepEqual(est, [d.esoe.catedratico.id], 'el directorio de un estudiante es el de su institucion');
});

test('instituciones: lo de otra institucion responde igual que lo que no existe', sinBase, async () => {
  const ajeno = d.infop;
  const pedidos = [
    ['GET', `/api/estudiantes/${ajeno.estudiante.id}`],
    ['GET', `/api/catedraticos/${ajeno.catedratico.id}`],
    ['GET', `/api/clases/${ajeno.clase.id}/calificaciones`],
    ['GET', `/api/clases/${ajeno.clase.id}/auditoria`],
    ['PUT', `/api/estudiantes/${ajeno.estudiante.id}`, { nombres: 'X' }],
    ['PUT', `/api/periodos/${ajeno.periodo.id}`, { nombre: 'X' }],
    ['PUT', `/api/clases/${ajeno.clase.id}`, { horario: 'X' }],
    ['PUT', `/api/clases/${ajeno.clase.id}/calificaciones/${ajeno.estudiante.id}`, { parcial_1: 100 }]
  ];
  for (const [metodo, ruta, cuerpo] of pedidos) {
    const r = metodo === 'GET'
      ? await servidor.pedir(ruta, { headers: ADMIN_ESOE })
      : await servidor.enviar(ruta, cuerpo, ADMIN_ESOE, metodo);
    assert.equal(r.status, 404, `${metodo} ${ruta}`);
  }
  const { rows } = await base.db.consultar('SELECT count(*)::int AS n FROM calificaciones');
  assert.equal(rows[0].n, 0, 'nada se escribio en la otra institucion');
});

test('instituciones: una clase no puede usar piezas de otra institucion', sinBase, async () => {
  const mezcla = await json(await servidor.enviar('/api/clases', {
    codigo_clase: 'CL-MEZCLA', periodo_id: d.esoe.periodo.id, promocion_id: d.esoe.promocion.id,
    materia_id: d.infop.materia.id, catedratico_id: d.esoe.catedratico.id, horario: 'M 08:00'
  }, ADMIN_ESOE));
  assert.equal(mezcla.status, 422);
  assert.deepEqual(mezcla.cuerpo.campos, { materia_id: 'No existe.' });
  const alumno = await json(await servidor.enviar('/api/estudiantes', {
    codigo_alumno: 'ALU-X', dni: 'DNI-X', nombres: 'X', apellidos: 'Y', fecha_nacimiento: '2004-01-01',
    promocion_id: d.infop.promocion.id }, ADMIN_ESOE));
  assert.equal(alumno.status, 422);
  assert.match(alumno.cuerpo.campos.promocion_id, /No existe/);
});

test('instituciones: la base impide mezclar instituciones aunque se escriba sin la API', sinBase, async () => {
  await assert.rejects(base.db.consultar(
    `INSERT INTO clases (institucion_id, codigo_clase, periodo_id, promocion_id, materia_id, catedratico_id, horario)
     VALUES ($1, 'SQL-MEZCLA', $2, $3, $4, $5, 'X')`,
    [d.inst.ESOE, d.esoe.periodo.id, d.esoe.promocion.id, d.infop.materia.id, d.esoe.catedratico.id]),
  /clases_materia_id_fkey/);
  await assert.rejects(base.db.consultar(
    'INSERT INTO calificaciones (clase_id, estudiante_id, parcial_1) VALUES ($1, $2, 90)',
    [d.infop.clase.id, d.esoe.estudiante.id]), /instituciones distintas/);
  const sesion = (await base.db.consultar(
    `INSERT INTO sesiones_asistencia (clase_id, fecha) VALUES ($1, '2026-02-02') RETURNING id`, [d.infop.clase.id])).rows[0];
  await assert.rejects(base.db.consultar(
    'INSERT INTO detalle_asistencia (sesion_id, estudiante_id) VALUES ($1, $2)', [sesion.id, d.esoe.estudiante.id]),
  /instituciones distintas/);
});

test('instituciones: lo que llega sin institucion queda en la ESOE, como antes', sinBase, async () => {
  const { rows } = await base.db.consultar(
    `INSERT INTO materias (codigo, nombre) VALUES ('SIN-INST', 'Antigua') RETURNING institucion_id`);
  assert.equal(rows[0].institucion_id, d.inst.ESOE);
});
