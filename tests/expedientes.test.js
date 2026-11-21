'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { levantar, como, crearBaseDePrueba, ENTORNO_CON_SESION, URL_ADMIN } = require('./ayuda');
const { CAMPOS } = require('../src/academico/expedientes');
const { validar } = require('../src/academico/validacion');

const sinBase = URL_ADMIN ? false : { skip: 'Sin PRUEBAS_DATABASE_URL' };

const CUENTA = {
  admin: 'user_exp_admin',
  catUno: 'user_exp_cat_uno',
  catDos: 'user_exp_cat_dos',
  estUno: 'user_exp_est_uno',
  estDos: 'user_exp_est_dos'
};
const ADMIN = como('ADMIN', CUENTA.admin);

const SENSIBLE = {
  direccion: 'Colonia Kennedy, bloque 7, casa 1234',
  tipo_sangre: 'AB-',
  dni: '0801-2005-99887',
  fecha_nacimiento: '2005-03-01',
  telefono: '+504 9988-7766',
  contacto_emergencia_nombre: 'Marta Diaz de Prueba',
  contacto_emergencia_telefono: '+504 2233-4455',
  lugar_procedencia: 'Choluteca'
};

let base;
let servidor;
let d;

const leer = async (ruta, cabeceras) => {
  const r = await servidor.pedir(ruta, { headers: cabeceras });
  return { status: r.status, texto: await r.text(), cabeceras: r.headers };
};

before(async () => {
  if (!URL_ADMIN) return;
  base = await crearBaseDePrueba();
  const { db } = base;
  const uno = async (sql, params) => (await db.consultar(sql, params)).rows[0];

  const periodo = await uno(`INSERT INTO periodos_lectivos (codigo, nombre, modalidad, fecha_inicio, fecha_fin)
                             VALUES ('EXP-P1', 'Periodo', 'SEMESTRAL', '2026-01-10', '2026-06-30') RETURNING id`);
  const promA = await uno(`INSERT INTO promociones (codigo, nombre, anio_ingreso, anio_egreso)
                           VALUES ('EXP-A', 'Promocion A', 2026, 2028) RETURNING id`);
  const promB = await uno(`INSERT INTO promociones (codigo, nombre, anio_ingreso, anio_egreso)
                           VALUES ('EXP-B', 'Promocion B', 2025, 2027) RETURNING id`);
  const mat = await uno(`INSERT INTO materias (codigo, nombre) VALUES ('EXP-M', 'Materia') RETURNING id`);
  const catUno = await uno(`INSERT INTO catedraticos (dni, nombres, apellidos, titulo, correo, telefono)
                            VALUES ('CAT-0001', 'Ana', 'Reyes', 'Licenciada', 'ana@esoe.example', '+504 3111-2222') RETURNING id`);
  const catDos = await uno(`INSERT INTO catedraticos (dni, nombres, apellidos, titulo)
                            VALUES ('CAT-0002', 'Luis', 'Mejia', 'Ingeniero') RETURNING id`);
  const catBaja = await uno(`INSERT INTO catedraticos (dni, nombres, apellidos, titulo, activo)
                             VALUES ('CAT-0003', 'Pedro', 'Retirado', 'Master', FALSE) RETURNING id`);
  await db.consultar(`INSERT INTO clases (codigo_clase, periodo_id, promocion_id, materia_id, catedratico_id, horario)
                      VALUES ('EXP-C1', $1, $2, $3, $4, 'L 08:00')`, [periodo.id, promA.id, mat.id, catUno.id]);
  await db.consultar(`INSERT INTO clases (codigo_clase, periodo_id, promocion_id, materia_id, catedratico_id, horario)
                      VALUES ('EXP-C2', $1, $2, $3, $4, 'M 08:00')`, [periodo.id, promB.id, mat.id, catDos.id]);

  servidor = await levantar(ENTORNO_CON_SESION, { db });

  const liga = (proveedor, rol, referencia) => db.consultar(
    `INSERT INTO usuarios (username, proveedor_id, rol, nombre_completo, referencia_id)
     VALUES ($1, $1, $2, $1, $3)`, [proveedor, rol, referencia]);
  await liga(CUENTA.admin, 'ADMIN', null);

  const creado = await servidor.enviar('/api/estudiantes', {
    codigo_alumno: 'exp-001', nombres: 'Carla', apellidos: 'Diaz', condicion: 'MILITAR', grado: 'Cadete',
    correo: 'carla@esoe.example', promocion_id: promA.id, ...SENSIBLE
  }, ADMIN);
  assert.equal(creado.status, 201, await creado.clone().text());
  const estUno = (await creado.json()).estudiante;
  const estDos = await uno(`INSERT INTO estudiantes (codigo_alumno, dni, nombres, apellidos, fecha_nacimiento, promocion_id)
                            VALUES ('EXP-002', 'EST-0002', 'Mario', 'Lopez', '2004-07-12', $1) RETURNING id`, [promB.id]);

  await liga(CUENTA.catUno, 'CATEDRATICO', catUno.id);
  await liga(CUENTA.catDos, 'CATEDRATICO', catDos.id);
  await liga(CUENTA.estUno, 'ESTUDIANTE', estUno.id);
  await liga(CUENTA.estDos, 'ESTUDIANTE', estDos.id);

  d = { promA: promA.id, promB: promB.id, estUno: estUno.id, estDos: estDos.id,
    catUno: catUno.id, catDos: catDos.id, catBaja: catBaja.id };
});

after(async () => {
  await servidor?.cerrar();
  await base?.cerrar();
});

test('expedientes: un catedratico no recibe direccion ni tipo de sangre de su estudiante', sinBase, async () => {
  const r = await leer(`/api/estudiantes/${d.estUno}`, como('CATEDRATICO', CUENTA.catUno));
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(JSON.parse(r.texto).estudiante).sort(), [...CAMPOS.estudianteAula].sort());
  for (const [campo, valor] of Object.entries(SENSIBLE)) {
    assert.ok(!r.texto.includes(campo), `la clave ${campo} no debe viajar`);
    assert.ok(!r.texto.includes(valor), `el valor de ${campo} no debe viajar`);
  }
  assert.equal(r.cabeceras.get('cache-control'), 'no-store');
});

test('expedientes: la lista del catedratico trae solo a quienes da clase, con los campos del aula', sinBase, async () => {
  const r = await leer('/api/estudiantes', como('CATEDRATICO', CUENTA.catUno));
  assert.equal(r.status, 200);
  const { estudiantes } = JSON.parse(r.texto);
  assert.deepEqual(estudiantes.map((e) => e.id), [d.estUno]);
  assert.deepEqual(Object.keys(estudiantes[0]).sort(), [...CAMPOS.estudianteAula].sort());
  assert.ok(!r.texto.includes(SENSIBLE.direccion) && !r.texto.includes(SENSIBLE.tipo_sangre));
  const filtrada = await leer(`/api/estudiantes?promocion_id=${d.promB}`, como('CATEDRATICO', CUENTA.catUno));
  assert.deepEqual(JSON.parse(filtrada.texto).estudiantes, [], 'filtrar por otra promocion no abre la puerta');
});

test('expedientes: un catedratico no consulta a un estudiante al que no da clase', sinBase, async () => {
  const r = await leer(`/api/estudiantes/${d.estDos}`, como('CATEDRATICO', CUENTA.catUno));
  assert.equal(r.status, 403);
  assert.ok(!r.texto.includes('Mario'));
});

test('expedientes: el estudiante ve su expediente completo y ningun otro', sinBase, async () => {
  const propio = await leer(`/api/estudiantes/${d.estUno}`, como('ESTUDIANTE', CUENTA.estUno));
  assert.equal(propio.status, 200);
  const { estudiante } = JSON.parse(propio.texto);
  assert.deepEqual(Object.keys(estudiante).sort(), [...CAMPOS.estudianteCompleto].sort());
  assert.equal(estudiante.direccion, SENSIBLE.direccion);
  assert.equal(estudiante.fecha_nacimiento, SENSIBLE.fecha_nacimiento);
  assert.equal((await leer(`/api/estudiantes/${d.estDos}`, como('ESTUDIANTE', CUENTA.estUno))).status, 403);
  const lista = JSON.parse((await leer('/api/estudiantes', como('ESTUDIANTE', CUENTA.estUno))).texto).estudiantes;
  assert.deepEqual(lista.map((e) => e.id), [d.estUno]);
});

test('expedientes: la administracion ve todo y puede filtrar por promocion', sinBase, async () => {
  const todos = JSON.parse((await leer('/api/estudiantes', ADMIN)).texto).estudiantes;
  assert.ok(todos.length >= 2);
  assert.deepEqual(Object.keys(todos[0]).sort(), [...CAMPOS.estudianteCompleto].sort());
  const deB = JSON.parse((await leer(`/api/estudiantes?promocion_id=${d.promB}`, ADMIN)).texto).estudiantes;
  assert.deepEqual(deB.map((e) => e.id), [d.estDos]);
  const malo = await leer('/api/estudiantes?promocion_id=1%20OR%201=1', ADMIN);
  assert.equal(malo.status, 422);
  assert.equal((await leer('/api/estudiantes/11111111-1111-4111-8111-111111111111', ADMIN)).status, 404);
  assert.equal((await leer('/api/estudiantes/no-es-uuid', ADMIN)).status, 404);
});

test('expedientes: el directorio de catedraticos no muestra DNI, correo ni telefono a los demas', sinBase, async () => {
  const r = await leer('/api/catedraticos', como('ESTUDIANTE', CUENTA.estUno));
  assert.equal(r.status, 200);
  const { catedraticos } = JSON.parse(r.texto);
  for (const c of catedraticos) assert.deepEqual(Object.keys(c).sort(), [...CAMPOS.catedraticoDirectorio].sort());
  assert.ok(!r.texto.includes('CAT-0001') && !r.texto.includes('ana@esoe.example') && !r.texto.includes('3111-2222'));
  assert.ok(!catedraticos.some((c) => c.id === d.catBaja), 'un catedratico dado de baja no aparece');
  assert.equal((await leer(`/api/catedraticos/${d.catBaja}`, como('ESTUDIANTE', CUENTA.estUno))).status, 404);

  const propio = JSON.parse((await leer(`/api/catedraticos/${d.catUno}`, como('CATEDRATICO', CUENTA.catUno))).texto);
  assert.deepEqual(Object.keys(propio.catedratico).sort(), [...CAMPOS.catedraticoCompleto].sort());
  const colega = JSON.parse((await leer(`/api/catedraticos/${d.catUno}`, como('CATEDRATICO', CUENTA.catDos))).texto);
  assert.deepEqual(Object.keys(colega.catedratico).sort(), [...CAMPOS.catedraticoDirectorio].sort());

  const admin = JSON.parse((await leer('/api/catedraticos', ADMIN)).texto).catedraticos;
  assert.ok(admin.some((c) => c.id === d.catBaja), 'la administracion ve tambien a los dados de baja');
  assert.deepEqual(Object.keys(admin[0]).sort(), [...CAMPOS.catedraticoCompleto].sort());
});

test('expedientes: solo la administracion crea y edita; sin sesion, 401', sinBase, async () => {
  const nuevo = { dni: 'CAT-9', nombres: 'X', apellidos: 'Y', titulo: 'Z' };
  for (const [rol, cuenta] of [['CATEDRATICO', CUENTA.catUno], ['ESTUDIANTE', CUENTA.estUno]]) {
    assert.equal((await servidor.enviar('/api/catedraticos', nuevo, como(rol, cuenta))).status, 403);
    assert.equal((await servidor.enviar(`/api/estudiantes/${d.estUno}`, { nombres: 'Otro' }, como(rol, cuenta), 'PUT')).status, 403,
      `${rol} no edita ni su propio expediente`);
  }
  assert.equal((await servidor.enviar('/api/estudiantes', {})).status, 401);
  assert.equal((await servidor.pedir('/api/estudiantes')).status, 401);
  assert.equal((await servidor.pedir('/api/catedraticos')).status, 401);
});

test('expedientes: la entrada se valida y responde 422 nombrando cada campo', sinBase, async () => {
  const r = await servidor.enviar('/api/estudiantes', {
    codigo_alumno: 'EXP-9', dni: 'EST-9', nombres: 'Ana', apellidos: 'Paz', promocion_id: d.promA,
    fecha_nacimiento: '2099-01-01', tipo_sangre: 'Z+', correo: 'sin-arroba', condicion: 'CIVIL', grado: 'Teniente'
  }, ADMIN);
  assert.equal(r.status, 422);
  const { campos } = await r.json();
  assert.match(campos.fecha_nacimiento, /pasada/);
  assert.match(campos.tipo_sangre, /no admitido/);
  assert.match(campos.correo, /no valido/);
  assert.match(campos.grado, /militar/);
  const faltan = await (await servidor.enviar('/api/catedraticos', {}, ADMIN)).json();
  assert.deepEqual(Object.keys(faltan.campos).sort(), ['apellidos', 'dni', 'nombres', 'titulo']);
});

test('expedientes: DNI o codigo repetidos responden 409 con el campo; promocion inexistente, 422', sinBase, async () => {
  const base1 = { nombres: 'Rep', apellidos: 'Tido', fecha_nacimiento: '2003-01-01', promocion_id: d.promA };
  const dni = await servidor.enviar('/api/estudiantes', { ...base1, codigo_alumno: 'EXP-R1', dni: SENSIBLE.dni.toLowerCase() }, ADMIN);
  assert.equal(dni.status, 409);
  assert.deepEqual((await dni.json()).campos, { dni: 'Ya existe.' });
  const codigo = await servidor.enviar('/api/estudiantes', { ...base1, codigo_alumno: 'EXP-001', dni: 'EST-R2' }, ADMIN);
  assert.equal(codigo.status, 409);
  assert.deepEqual((await codigo.json()).campos, { codigo_alumno: 'Ya existe.' });
  const fantasma = await servidor.enviar('/api/estudiantes',
    { ...base1, codigo_alumno: 'EXP-R3', dni: 'EST-R3', promocion_id: '11111111-1111-4111-8111-111111111111' }, ADMIN);
  assert.equal(fantasma.status, 422);
  assert.match((await fantasma.json()).campos.promocion_id, /No existe/);
  const catRep = await servidor.enviar('/api/catedraticos', { dni: 'cat-0001', nombres: 'A', apellidos: 'B', titulo: 'C' }, ADMIN);
  assert.equal(catRep.status, 409);
});

test('expedientes: editar valida contra lo guardado', sinBase, async () => {
  const malo = await servidor.enviar(`/api/estudiantes/${d.estUno}`, { condicion: 'CIVIL' }, ADMIN, 'PUT');
  assert.equal(malo.status, 422);
  assert.match((await malo.json()).campos.grado, /militar/);
  const bien = await servidor.enviar(`/api/estudiantes/${d.estUno}`, { condicion: 'CIVIL', grado: null }, ADMIN, 'PUT');
  assert.equal(bien.status, 200);
  const { estudiante } = await bien.json();
  assert.equal(estudiante.condicion, 'CIVIL');
  assert.equal(estudiante.grado, null);
  assert.equal(estudiante.direccion, SENSIBLE.direccion, 'lo no enviado no cambia');
  const baja = await servidor.enviar(`/api/catedraticos/${d.catDos}`, { activo: false, telefono: '' }, ADMIN, 'PUT');
  assert.equal(baja.status, 200);
  assert.equal((await baja.json()).catedratico.telefono, null, 'un opcional vacio se guarda como ausente');
  assert.equal((await servidor.enviar('/api/catedraticos/no-es-uuid', { titulo: 'X' }, ADMIN, 'PUT')).status, 404);
  assert.equal((await servidor.enviar('/api/catedraticos/11111111-1111-4111-8111-111111111111', { titulo: 'X' }, ADMIN, 'PUT')).status, 404);
  await servidor.enviar(`/api/catedraticos/${d.catDos}`, { activo: true }, ADMIN, 'PUT');
});

test('expedientes: la base sostiene las mismas reglas aunque se escriba sin la API', sinBase, async () => {
  await assert.rejects(base.db.consultar(
    `INSERT INTO estudiantes (codigo_alumno, dni, nombres, apellidos, fecha_nacimiento, promocion_id, tipo_sangre)
     VALUES ('SQL-S', 'SQL-S', 'N', 'A', '2000-01-01', $1, 'X+')`, [d.promA]), /estudiante_tipo_sangre_valido/);
  await assert.rejects(base.db.consultar(
    `INSERT INTO estudiantes (codigo_alumno, dni, nombres, apellidos, fecha_nacimiento, promocion_id, condicion, grado)
     VALUES ('SQL-G', 'SQL-G', 'N', 'A', '2000-01-01', $1, 'CIVIL', 'Sargento')`, [d.promA]), /estudiante_grado_solo_militar/);
  await assert.rejects(base.db.consultar(
    `INSERT INTO estudiantes (codigo_alumno, dni, nombres, apellidos, fecha_nacimiento, promocion_id)
     VALUES ('SQL-F', 'SQL-F', 'N', 'A', '1850-01-01', $1)`, [d.promA]), /estudiante_nacimiento_razonable/);
  await assert.rejects(base.db.consultar(
    `INSERT INTO catedraticos (dni, nombres, apellidos, titulo, condicion, grado)
     VALUES ('SQL-C', 'N', 'A', 'T', 'CIVIL', 'Coronel')`), /catedratico_grado_solo_militar/);
});

test('expedientes: DNI y codigo se normalizan; los opcionales vacios quedan ausentes', () => {
  const { datos, campos } = validar('estudiante', {
    codigo_alumno: ' exp-77 ', dni: ' 0801-abc ', nombres: ' Ana ', apellidos: 'Paz',
    fecha_nacimiento: '2001-05-05', promocion_id: '11111111-1111-4111-8111-111111111111', direccion: '   '
  });
  assert.deepEqual(campos, {});
  assert.equal(datos.codigo_alumno, 'EXP-77');
  assert.equal(datos.dni, '0801-ABC');
  assert.equal(datos.nombres, 'Ana');
  assert.equal(datos.direccion, null);
  assert.ok(validar('estudiante', { promocion_id: 'x' }, { parcial: true }).campos.promocion_id);
  assert.ok(validar('catedratico', { telefono: 'abc' }, { parcial: true }).campos.telefono);
  assert.ok(validar('catedratico', { dni: '<script>' }, { parcial: true }).campos.dni);
});

test('expedientes: las listas de campos por rol no se cruzan con los sensibles', () => {
  for (const campo of ['direccion', 'tipo_sangre', 'dni', 'fecha_nacimiento', 'telefono', 'correo',
    'contacto_emergencia_nombre', 'contacto_emergencia_telefono', 'lugar_procedencia']) {
    assert.ok(!CAMPOS.estudianteAula.includes(campo), `${campo} no es del aula`);
  }
  for (const campo of ['dni', 'correo', 'telefono']) assert.ok(!CAMPOS.catedraticoDirectorio.includes(campo));
});
