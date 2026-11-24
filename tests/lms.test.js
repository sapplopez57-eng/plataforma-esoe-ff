'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { levantar, como, crearBaseDePrueba, ENTORNO_CON_SESION, URL_ADMIN } = require('./ayuda');

const sinBase = URL_ADMIN ? false : { skip: 'Sin PRUEBAS_DATABASE_URL' };

const CUENTA = {
  admin: 'user_lms_admin', ana: 'user_lms_ana', luis: 'user_lms_luis',
  carla: 'user_lms_carla', mario: 'user_lms_mario'
};
const ADMIN = como('ADMIN', CUENTA.admin);
const ANA = como('CATEDRATICO', CUENTA.ana);
const LUIS = como('CATEDRATICO', CUENTA.luis);
const CARLA = como('ESTUDIANTE', CUENTA.carla);
const MARIO = como('ESTUDIANTE', CUENTA.mario);

const FUTURO = '2030-12-01T23:59:00Z';
const PASADO = '2020-01-01T00:00:00Z';

let base;
let servidor;
let d;

const json = async (respuesta) => ({ status: respuesta.status, cuerpo: await respuesta.json() });
const enviar = (ruta, cuerpo, quien, metodo = 'PUT') => servidor.enviar(ruta, cuerpo, quien, metodo);
const pedir = (ruta, quien) => servidor.pedir(ruta, { headers: quien });

before(async () => {
  if (!URL_ADMIN) return;
  base = await crearBaseDePrueba();
  const { db } = base;
  const uno = async (sql, params) => (await db.consultar(sql, params)).rows[0];

  const periodo = await uno(`INSERT INTO periodos_lectivos (codigo, nombre, modalidad, fecha_inicio, fecha_fin)
                             VALUES ('LMS-P1', 'Periodo', 'SEMESTRAL', '2026-01-10', '2026-06-30') RETURNING id`);
  const promA = await uno(`INSERT INTO promociones (codigo, nombre, anio_ingreso, anio_egreso)
                           VALUES ('LMS-A', 'A', 2026, 2028) RETURNING id`);
  const promB = await uno(`INSERT INTO promociones (codigo, nombre, anio_ingreso, anio_egreso)
                           VALUES ('LMS-B', 'B', 2025, 2027) RETURNING id`);
  const matUno = await uno(`INSERT INTO materias (codigo, nombre) VALUES ('LMS-M1', 'Tactica') RETURNING id`);
  const matDos = await uno(`INSERT INTO materias (codigo, nombre) VALUES ('LMS-M2', 'Logistica') RETURNING id`);
  const catUno = await uno(`INSERT INTO catedraticos (dni, nombres, apellidos, titulo)
                            VALUES ('LMS-C1', 'Ana', 'Reyes', 'Lic.') RETURNING id`);
  const catDos = await uno(`INSERT INTO catedraticos (dni, nombres, apellidos, titulo)
                            VALUES ('LMS-C2', 'Luis', 'Mejia', 'Ing.') RETURNING id`);
  const estUno = await uno(`INSERT INTO estudiantes (codigo_alumno, dni, nombres, apellidos, fecha_nacimiento, promocion_id)
                            VALUES ('LMS-E1', 'LMS-E1', 'Carla', 'Diaz', '2005-03-01', $1) RETURNING id`, [promA.id]);
  const estDos = await uno(`INSERT INTO estudiantes (codigo_alumno, dni, nombres, apellidos, fecha_nacimiento, promocion_id)
                            VALUES ('LMS-E2', 'LMS-E2', 'Mario', 'Lopez', '2004-07-12', $1) RETURNING id`, [promB.id]);
  const claseUno = await uno(`INSERT INTO clases (codigo_clase, periodo_id, promocion_id, materia_id, catedratico_id, horario)
                              VALUES ('LMS-101', $1, $2, $3, $4, 'L-M 08:00') RETURNING id`,
  [periodo.id, promA.id, matUno.id, catUno.id]);
  const claseDos = await uno(`INSERT INTO clases (codigo_clase, periodo_id, promocion_id, materia_id, catedratico_id, horario)
                              VALUES ('LMS-202', $1, $2, $3, $4, 'J 10:00') RETURNING id`,
  [periodo.id, promB.id, matDos.id, catDos.id]);

  const liga = async (proveedor, rol, referencia) => (await db.consultar(
    `INSERT INTO usuarios (username, proveedor_id, rol, nombre_completo, referencia_id)
     VALUES ($1, $2, $3, $1, $4) RETURNING id`,
    [proveedor.replace('user_lms_', ''), proveedor, rol, referencia])).rows[0].id;
  await liga(CUENTA.admin, 'ADMIN', null);
  await liga(CUENTA.ana, 'CATEDRATICO', catUno.id);
  await liga(CUENTA.luis, 'CATEDRATICO', catDos.id);
  await liga(CUENTA.carla, 'ESTUDIANTE', estUno.id);
  await liga(CUENTA.mario, 'ESTUDIANTE', estDos.id);

  servidor = await levantar(ENTORNO_CON_SESION, { db });
  d = { claseUno: claseUno.id, claseDos: claseDos.id, estUno: estUno.id, estDos: estDos.id };
});

after(async () => {
  await servidor?.cerrar();
  await base?.cerrar();
});

test('aula: el titular crea el curso de su clase y luego lo actualiza', sinBase, async () => {
  const creado = await json(await enviar(`/api/clases/${d.claseUno}/curso`,
    { titulo: 'Tactica basica', descripcion: 'Curso del periodo' }, ANA));
  assert.equal(creado.status, 201, JSON.stringify(creado.cuerpo));
  assert.equal(creado.cuerpo.curso.titulo, 'Tactica basica');
  assert.equal(creado.cuerpo.curso.publicado, false);
  d.curso = creado.cuerpo.curso.id;

  const actualizado = await json(await enviar(`/api/clases/${d.claseUno}/curso`,
    { titulo: 'Tactica basica', descripcion: 'Curso del periodo', publicado: true }, ANA));
  assert.equal(actualizado.status, 200);
  assert.equal(actualizado.cuerpo.curso.id, d.curso);
  assert.equal(actualizado.cuerpo.curso.publicado, true);
});

test('aula: un curso sin titulo no se acepta', sinBase, async () => {
  const r = await json(await enviar(`/api/clases/${d.claseUno}/curso`, { descripcion: 'x' }, ANA));
  assert.equal(r.status, 422);
  assert.equal(r.cuerpo.campos.titulo, 'Es obligatorio.');
});

test('aula: otro catedratico y un estudiante no pueden tocar el curso', sinBase, async () => {
  for (const quien of [LUIS, CARLA]) {
    const r = await json(await enviar(`/api/clases/${d.claseUno}/curso`, { titulo: 'Ajeno' }, quien));
    assert.equal(r.status, 403);
    assert.equal(r.cuerpo.codigo, 'NO_ES_SUYO');
  }
});

test('aula: el titular arma unidades ordenadas y rechaza un orden repetido', sinBase, async () => {
  const primera = await json(await enviar(`/api/clases/${d.claseUno}/curso/unidades`,
    { orden: 1, titulo: 'Fundamentos', publicada: true }, ANA, 'POST'));
  assert.equal(primera.status, 201, JSON.stringify(primera.cuerpo));
  d.unidad = primera.cuerpo.unidad.id;

  const oculta = await json(await enviar(`/api/clases/${d.claseUno}/curso/unidades`,
    { orden: 2, titulo: 'Borrador interno' }, ANA, 'POST'));
  assert.equal(oculta.status, 201);
  d.unidadOculta = oculta.cuerpo.unidad.id;

  const repetida = await json(await enviar(`/api/clases/${d.claseUno}/curso/unidades`,
    { orden: 1, titulo: 'Choque' }, ANA, 'POST'));
  assert.equal(repetida.status, 409);
  assert.equal(repetida.cuerpo.campos.orden, 'Ya esta ocupado.');
});

test('aula: una unidad se renombra y un cuerpo vacio no pasa', sinBase, async () => {
  const r = await json(await enviar(`/api/unidades/${d.unidad}`, { titulo: 'Fundamentos tacticos' }, ANA));
  assert.equal(r.status, 200);
  assert.equal(r.cuerpo.unidad.titulo, 'Fundamentos tacticos');
  assert.equal((await json(await enviar(`/api/unidades/${d.unidad}`, {}, ANA))).status, 422);
});

test('aula: una unidad inexistente o con identificador invalido responde 404', sinBase, async () => {
  assert.equal((await json(await enviar('/api/unidades/no-es-uuid', { titulo: 'x' }, ADMIN))).status, 404);
  const r = await json(await enviar('/api/unidades/11111111-1111-4111-8111-111111111111', { titulo: 'x' }, ADMIN));
  assert.equal(r.status, 404);
});

test('aula: los contenidos respetan el tipo y el orden', sinBase, async () => {
  const texto = await json(await enviar(`/api/unidades/${d.unidad}/contenidos`,
    { orden: 1, titulo: 'Guia de estudio', tipo: 'TEXTO', cuerpo: 'Leer el manual.', publicado: true }, ANA, 'POST'));
  assert.equal(texto.status, 201, JSON.stringify(texto.cuerpo));
  d.contenido = texto.cuerpo.contenido.id;

  const enlace = await json(await enviar(`/api/unidades/${d.unidad}/contenidos`,
    { orden: 2, titulo: 'Video', tipo: 'VIDEO', url: 'https://aula.udh.edu.hn/v/1' }, ANA, 'POST'));
  assert.equal(enlace.status, 201);

  const sinUrl = await json(await enviar(`/api/unidades/${d.unidad}/contenidos`,
    { orden: 3, titulo: 'Documento', tipo: 'DOCUMENTO' }, ANA, 'POST'));
  assert.equal(sinUrl.status, 422);
  assert.equal(sinUrl.cuerpo.campos.url, 'Es obligatoria en un contenido de tipo DOCUMENTO.');

  const insegura = await json(await enviar(`/api/unidades/${d.unidad}/contenidos`,
    { orden: 4, titulo: 'Documento', tipo: 'DOCUMENTO', url: 'http://aula.udh.edu.hn/d/1' }, ANA, 'POST'));
  assert.equal(insegura.status, 422);
  assert.equal(insegura.cuerpo.campos.url, 'Debe ser una direccion https valida.');

  const choque = await json(await enviar(`/api/unidades/${d.unidad}/contenidos`,
    { orden: 1, titulo: 'Otro', tipo: 'TEXTO', cuerpo: 'x' }, ANA, 'POST'));
  assert.equal(choque.status, 409);
});

test('aula: un contenido se corrige sin reenviar todo', sinBase, async () => {
  const r = await json(await enviar(`/api/contenidos/${d.contenido}`, { cuerpo: 'Leer los capitulos 1 a 4.' }, ANA));
  assert.equal(r.status, 200, JSON.stringify(r.cuerpo));
  assert.equal(r.cuerpo.contenido.cuerpo, 'Leer los capitulos 1 a 4.');
  assert.equal((await json(await enviar(`/api/contenidos/${d.contenido}`, {}, ANA))).status, 422);
});

test('aula: las tareas se publican con fecha valida y unidad del mismo curso', sinBase, async () => {
  const tarea = await json(await enviar(`/api/clases/${d.claseUno}/curso/tareas`,
    { titulo: 'Informe tactico', instrucciones: 'Entregar informe.', fecha_entrega: FUTURO,
      puntaje_maximo: 50, unidad_id: d.unidad, publicada: true }, ANA, 'POST'));
  assert.equal(tarea.status, 201, JSON.stringify(tarea.cuerpo));
  assert.equal(Number(tarea.cuerpo.tarea.puntaje_maximo), 50);
  d.tarea = tarea.cuerpo.tarea.id;

  const malaFecha = await json(await enviar(`/api/clases/${d.claseUno}/curso/tareas`,
    { titulo: 'x', instrucciones: 'y', fecha_entrega: '2030-12-01' }, ANA, 'POST'));
  assert.equal(malaFecha.status, 422);
  assert.match(malaFecha.cuerpo.campos.fecha_entrega, /ISO 8601/);

  const ajena = await json(await enviar(`/api/clases/${d.claseUno}/curso/tareas`,
    { titulo: 'x', instrucciones: 'y', fecha_entrega: FUTURO, unidad_id: '11111111-1111-4111-8111-111111111111' },
    ANA, 'POST'));
  assert.equal(ajena.status, 422);
  assert.equal(ajena.cuerpo.campos.unidad_id, 'No existe.');

  const vencida = await json(await enviar(`/api/clases/${d.claseUno}/curso/tareas`,
    { titulo: 'Tarea vencida', instrucciones: 'Ya no se recibe.', fecha_entrega: PASADO, publicada: true },
    ANA, 'POST'));
  assert.equal(vencida.status, 201);
  d.tareaVencida = vencida.cuerpo.tarea.id;

  const borrador = await json(await enviar(`/api/clases/${d.claseUno}/curso/tareas`,
    { titulo: 'Sin publicar', instrucciones: 'Aun no.', fecha_entrega: FUTURO }, ANA, 'POST'));
  assert.equal(borrador.status, 201);
  d.tareaOculta = borrador.cuerpo.tarea.id;

  const renombrada = await json(await enviar(`/api/tareas/${d.tarea}`, { titulo: 'Informe tactico final' }, ANA));
  assert.equal(renombrada.status, 200);
  assert.equal(renombrada.cuerpo.tarea.titulo, 'Informe tactico final');
});

test('aula: el estudiante de la clase solo ve lo publicado', sinBase, async () => {
  const r = await json(await pedir(`/api/clases/${d.claseUno}/curso`, CARLA));
  assert.equal(r.status, 200, JSON.stringify(r.cuerpo));
  assert.equal(r.cuerpo.unidades.length, 1);
  assert.equal(r.cuerpo.unidades[0].id, d.unidad);
  assert.deepEqual(r.cuerpo.unidades[0].contenidos.map((c) => c.titulo), ['Guia de estudio']);
  const titulos = r.cuerpo.tareas.map((t) => t.titulo);
  assert.ok(titulos.includes('Informe tactico final'));
  assert.ok(!titulos.includes('Sin publicar'));
});

test('aula: la administracion ve tambien lo que esta en borrador', sinBase, async () => {
  const r = await json(await pedir(`/api/clases/${d.claseUno}/curso`, ADMIN));
  assert.equal(r.status, 200);
  assert.equal(r.cuerpo.unidades.length, 2);
  assert.ok(r.cuerpo.tareas.some((t) => t.titulo === 'Sin publicar'));
});

test('aula: un estudiante de otra promocion no ve el curso', sinBase, async () => {
  const r = await json(await pedir(`/api/clases/${d.claseUno}/curso`, MARIO));
  assert.equal(r.status, 403);
  assert.equal(r.cuerpo.codigo, 'NO_ES_SUYO');
});

test('aula: una clase sin curso responde 404', sinBase, async () => {
  assert.equal((await json(await pedir(`/api/clases/${d.claseDos}/curso`, ADMIN))).status, 404);
  const r = await json(await enviar(`/api/clases/${d.claseDos}/curso/unidades`, { orden: 1, titulo: 'x' }, LUIS, 'POST'));
  assert.equal(r.status, 404);
  assert.equal(r.cuerpo.error, 'El curso no existe.');
});

test('aula: el estudiante guarda un borrador y luego entrega', sinBase, async () => {
  const borrador = await json(await enviar(`/api/tareas/${d.tarea}/entrega`,
    { estado: 'BORRADOR', texto: 'Voy a medias.' }, CARLA));
  assert.equal(borrador.status, 201, JSON.stringify(borrador.cuerpo));
  assert.equal(borrador.cuerpo.entrega.estado, 'BORRADOR');
  assert.equal(borrador.cuerpo.entrega.entregada_en, null);

  const entregada = await json(await enviar(`/api/tareas/${d.tarea}/entrega`,
    { estado: 'ENTREGADA', texto: 'Informe completo.', url: 'https://aula.udh.edu.hn/e/1' }, CARLA));
  assert.equal(entregada.status, 200);
  assert.equal(entregada.cuerpo.entrega.estado, 'ENTREGADA');
  assert.ok(entregada.cuerpo.entrega.entregada_en);
  d.entrega = entregada.cuerpo.entrega.id;

  const propia = await json(await pedir(`/api/tareas/${d.tarea}/entrega`, CARLA));
  assert.equal(propia.status, 200);
  assert.equal(propia.cuerpo.entrega.id, d.entrega);
});

test('aula: una entrega vacia, fuera de plazo o de una tarea sin publicar no pasa', sinBase, async () => {
  const vacia = await json(await enviar(`/api/tareas/${d.tarea}/entrega`, { estado: 'ENTREGADA' }, CARLA));
  assert.equal(vacia.status, 422);
  assert.equal(vacia.cuerpo.campos.texto, 'Una entrega necesita texto o una direccion https.');

  const tarde = await json(await enviar(`/api/tareas/${d.tareaVencida}/entrega`,
    { estado: 'ENTREGADA', texto: 'Tarde.' }, CARLA));
  assert.equal(tarde.status, 409);
  assert.equal(tarde.cuerpo.codigo, 'FUERA_DE_PLAZO');

  const oculta = await json(await enviar(`/api/tareas/${d.tareaOculta}/entrega`,
    { estado: 'ENTREGADA', texto: 'No deberia.' }, CARLA));
  assert.equal(oculta.status, 404);
});

test('aula: solo el estudiante entrega y solo ve su propia entrega', sinBase, async () => {
  const deAna = await json(await enviar(`/api/tareas/${d.tarea}/entrega`, { estado: 'ENTREGADA', texto: 'x' }, ANA));
  assert.equal(deAna.status, 403);
  assert.equal((await json(await pedir(`/api/tareas/${d.tarea}/entrega`, ANA))).status, 403);
  const mario = await json(await enviar(`/api/tareas/${d.tarea}/entrega`, { estado: 'ENTREGADA', texto: 'x' }, MARIO));
  assert.equal(mario.status, 403);
});

test('aula: el titular ve la lista de entregas con todos los alumnos de la promocion', sinBase, async () => {
  const r = await json(await pedir(`/api/tareas/${d.tarea}/entregas`, ANA));
  assert.equal(r.status, 200);
  assert.equal(r.cuerpo.entregas.length, 1);
  assert.equal(r.cuerpo.entregas[0].codigo_alumno, 'LMS-E1');
  assert.equal(r.cuerpo.entregas[0].estado, 'ENTREGADA');
  assert.equal((await json(await pedir(`/api/tareas/${d.tarea}/entregas`, LUIS))).status, 403);
});

test('aula: la calificacion respeta el puntaje maximo y exige nota', sinBase, async () => {
  const pasada = await json(await enviar(`/api/entregas/${d.entrega}/calificacion`,
    { estado: 'CALIFICADA', nota: 80 }, ANA));
  assert.equal(pasada.status, 422);
  assert.match(pasada.cuerpo.campos.nota, /puntaje maximo/);

  const sinNota = await json(await enviar(`/api/entregas/${d.entrega}/calificacion`, { estado: 'CALIFICADA' }, ANA));
  assert.equal(sinNota.status, 422);

  const buena = await json(await enviar(`/api/entregas/${d.entrega}/calificacion`,
    { estado: 'CALIFICADA', nota: 45.5, retroalimentacion: 'Buen informe.' }, ANA));
  assert.equal(buena.status, 200, JSON.stringify(buena.cuerpo));
  assert.equal(Number(buena.cuerpo.entrega.nota), 45.5);
  assert.ok(buena.cuerpo.entrega.calificada_en);
});

test('aula: una entrega calificada ya no la cambia el estudiante', sinBase, async () => {
  const r = await json(await enviar(`/api/tareas/${d.tarea}/entrega`,
    { estado: 'ENTREGADA', texto: 'Quiero rehacerla.' }, CARLA));
  assert.equal(r.status, 409);
  assert.equal(r.cuerpo.codigo, 'YA_CALIFICADA');
});

test('aula: no se califica lo que sigue en borrador', sinBase, async () => {
  const nueva = await json(await enviar(`/api/clases/${d.claseUno}/curso/tareas`,
    { titulo: 'Segunda', instrucciones: 'Otra.', fecha_entrega: FUTURO, publicada: true }, ANA, 'POST'));
  assert.equal(nueva.status, 201);
  const borrador = await json(await enviar(`/api/tareas/${nueva.cuerpo.tarea.id}/entrega`,
    { estado: 'BORRADOR', texto: 'A medias.' }, CARLA));
  assert.equal(borrador.status, 201);
  const r = await json(await enviar(`/api/entregas/${borrador.cuerpo.entrega.id}/calificacion`,
    { estado: 'DEVUELTA', retroalimentacion: 'Rehacer.' }, ANA));
  assert.equal(r.status, 409);
  assert.equal(r.cuerpo.codigo, 'SIN_ENTREGAR');
});

test('aula: el estudiante consulta sus tareas publicadas con el estado de cada una', sinBase, async () => {
  const r = await json(await pedir('/api/mis-tareas', CARLA));
  assert.equal(r.status, 200, JSON.stringify(r.cuerpo));
  const porTitulo = new Map(r.cuerpo.tareas.map((t) => [t.titulo, t]));
  assert.equal(porTitulo.get('Informe tactico final').estado, 'CALIFICADA');
  assert.equal(Number(porTitulo.get('Informe tactico final').nota), 45.5);
  assert.equal(porTitulo.get('Tarea vencida').estado, 'BORRADOR');
  assert.ok(!porTitulo.has('Sin publicar'));
  assert.equal(porTitulo.get('Informe tactico final').codigo_clase, 'LMS-101');
  assert.equal((await json(await pedir('/api/mis-tareas', ANA))).status, 403);
});

test('aula: sin sesion no se llega a nada del aula virtual', sinBase, async () => {
  for (const ruta of [`/api/clases/${d.claseUno}/curso`, '/api/mis-tareas', `/api/tareas/${d.tarea}/entregas`]) {
    assert.equal((await servidor.pedir(ruta)).status, 401, ruta);
  }
});

test('aula: una tarea no toma prestada una unidad de otro curso', sinBase, async () => {
  const curso = await json(await enviar(`/api/clases/${d.claseDos}/curso`, { titulo: 'Logistica' }, LUIS));
  assert.equal(curso.status, 201, JSON.stringify(curso.cuerpo));
  const unidad = await json(await enviar(`/api/clases/${d.claseDos}/curso/unidades`,
    { orden: 1, titulo: 'Cadena de suministro' }, LUIS, 'POST'));
  assert.equal(unidad.status, 201);

  const r = await json(await enviar(`/api/clases/${d.claseUno}/curso/tareas`,
    { titulo: 'Cruzada', instrucciones: 'No debe pasar.', fecha_entrega: FUTURO, unidad_id: unidad.cuerpo.unidad.id },
    ANA, 'POST'));
  assert.equal(r.status, 422, JSON.stringify(r.cuerpo));
  assert.equal(r.cuerpo.campos.unidad_id, 'Pertenece a otro curso.');
});

test('aula: el titular ve el contenido entregado, no solo que se entrego', sinBase, async () => {
  const r = await json(await pedir(`/api/tareas/${d.tarea}/entregas`, ANA));
  assert.equal(r.status, 200);
  const entrega = r.cuerpo.entregas[0];
  assert.equal(entrega.texto, 'Informe completo.');
  assert.equal(entrega.url, 'https://aula.udh.edu.hn/e/1');
  assert.equal(entrega.retroalimentacion, 'Buen informe.');
});

test('aula: una entrega ya enviada no vuelve a borrador', sinBase, async () => {
  const tarea = await json(await enviar(`/api/clases/${d.claseUno}/curso/tareas`,
    { titulo: 'Tercera', instrucciones: 'Otra mas.', fecha_entrega: FUTURO, publicada: true }, ANA, 'POST'));
  assert.equal(tarea.status, 201);
  d.tareaTercera = tarea.cuerpo.tarea.id;

  const enviada = await json(await enviar(`/api/tareas/${d.tareaTercera}/entrega`,
    { estado: 'ENTREGADA', texto: 'Primera version.' }, CARLA));
  assert.equal(enviada.status, 201);
  d.entregaTercera = enviada.cuerpo.entrega.id;

  const atras = await json(await enviar(`/api/tareas/${d.tareaTercera}/entrega`,
    { estado: 'BORRADOR', texto: 'Me arrepenti.' }, CARLA));
  assert.equal(atras.status, 409);
  assert.equal(atras.cuerpo.codigo, 'NO_REGRESA_A_BORRADOR');
});

test('aula: al reentregar una devuelta, la nota anterior no sobrevive', sinBase, async () => {
  const devuelta = await json(await enviar(`/api/entregas/${d.entregaTercera}/calificacion`,
    { estado: 'DEVUELTA', nota: 30, retroalimentacion: 'Rehacer el analisis.' }, ANA));
  assert.equal(devuelta.status, 200, JSON.stringify(devuelta.cuerpo));
  assert.equal(Number(devuelta.cuerpo.entrega.nota), 30);

  const otra = await json(await enviar(`/api/tareas/${d.tareaTercera}/entrega`,
    { estado: 'ENTREGADA', texto: 'Version corregida.' }, CARLA));
  assert.equal(otra.status, 200, JSON.stringify(otra.cuerpo));
  assert.equal(otra.cuerpo.entrega.nota, null);
  assert.equal(otra.cuerpo.entrega.retroalimentacion, null);
  assert.equal(otra.cuerpo.entrega.calificada_en, null);
});

test('aula: un curso sin publicar no recibe entregas ni se deja ver', sinBase, async () => {
  const tarea = await json(await enviar(`/api/clases/${d.claseDos}/curso/tareas`,
    { titulo: 'En curso oculto', instrucciones: 'No deberia recibirse.', fecha_entrega: FUTURO, publicada: true },
    LUIS, 'POST'));
  assert.equal(tarea.status, 201, JSON.stringify(tarea.cuerpo));

  const entrega = await json(await enviar(`/api/tareas/${tarea.cuerpo.tarea.id}/entrega`,
    { estado: 'ENTREGADA', texto: 'Hola.' }, MARIO));
  assert.equal(entrega.status, 404);
  assert.equal((await json(await pedir(`/api/tareas/${tarea.cuerpo.tarea.id}/entrega`, MARIO))).status, 404);
  assert.equal((await json(await pedir(`/api/clases/${d.claseDos}/curso`, MARIO))).status, 404);
});

test('aula: la base deja retirar una unidad que una tarea referencia', sinBase, async () => {
  const { rows: [creada] } = await base.db.consultar(
    `INSERT INTO tareas (institucion_id, curso_id, unidad_id, titulo, instrucciones, fecha_entrega)
     SELECT u.institucion_id, u.curso_id, u.id, 'Atada a la unidad', 'x', $2
       FROM unidades u WHERE u.id = $1 RETURNING id`, [d.unidadOculta, FUTURO]);
  await base.db.consultar('DELETE FROM unidades WHERE id = $1', [d.unidadOculta]);
  const { rows: [despues] } = await base.db.consultar(
    'SELECT unidad_id, curso_id FROM tareas WHERE id = $1', [creada.id]);
  assert.equal(despues.unidad_id, null);
  assert.ok(despues.curso_id);
});

test('aula: la base rechaza una nota que pasa el puntaje maximo de la tarea', sinBase, async () => {
  await assert.rejects(
    base.db.consultar('UPDATE entregas SET nota = 90 WHERE id = $1', [d.entrega]),
    (error) => {
      assert.match(error.message, /puntaje maximo/i);
      return true;
    });
});

test('aula: el puntaje maximo no baja por debajo de una nota ya puesta', sinBase, async () => {
  await assert.rejects(
    base.db.consultar('UPDATE tareas SET puntaje_maximo = 10 WHERE id = $1', [d.tarea]),
    (error) => {
      assert.match(error.message, /no puede bajar/i);
      return true;
    });
  const subir = await base.db.consultar('UPDATE tareas SET puntaje_maximo = 60 WHERE id = $1 RETURNING puntaje_maximo', [d.tarea]);
  assert.equal(Number(subir.rows[0].puntaje_maximo), 60);
});
