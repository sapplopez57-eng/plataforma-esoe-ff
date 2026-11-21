'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { levantar, firmarSesion, crearBaseDePrueba, ENTORNO_CON_SESION, URL_ADMIN, DOMINIO_CLERK } = require('./ayuda');

let chromium = null;
try {
  ({ chromium } = require('playwright'));
} catch {}

if (process.env.CI && !chromium) throw new Error('CI sin Playwright: la prueba de dos sesiones no puede omitirse.');
const omitir = !URL_ADMIN ? { skip: 'Sin PRUEBAS_DATABASE_URL' } : (!chromium ? { skip: 'Sin Playwright' } : false);

const CUENTA = { admin: 'user_nav_admin', ana: 'user_nav_ana', carla: 'user_nav_carla' };

const CLERK_SUSTITUTO = `
  window.__internal_ClerkUICtor = function () {};
  window.Clerk = window.Clerk || {
    isSignedIn: true,
    user: { fullName: 'Persona de prueba', primaryEmailAddress: { emailAddress: 'prueba@esoe.example' } },
    session: { getToken: async () => window.__tokenDePrueba },
    load: async () => {},
    addListener: () => {},
    mountSignIn: () => {},
    signOut: async () => {}
  };`;

let base;
let servidor;
let navegador;
let d;

before(async () => {
  if (omitir) return;
  base = await crearBaseDePrueba();
  const { db } = base;
  const uno = async (sql, params) => (await db.consultar(sql, params)).rows[0];
  const hoy = new Date().toISOString().slice(0, 10);
  const periodo = await uno(`INSERT INTO periodos_lectivos (codigo, nombre, modalidad, fecha_inicio, fecha_fin)
                             VALUES ('NAV-P1', 'Periodo de prueba', 'ANUAL', $1::date - 30, $1::date + 30) RETURNING id`, [hoy]);
  const prom = await uno(`INSERT INTO promociones (codigo, nombre, anio_ingreso, anio_egreso)
                          VALUES ('NAV-A', 'Promocion Navegador', 2026, 2028) RETURNING id`);
  const mat = await uno(`INSERT INTO materias (codigo, nombre) VALUES ('NAV-M1', 'Tactica Basica') RETURNING id`);
  const cat = await uno(`INSERT INTO catedraticos (dni, nombres, apellidos, titulo)
                         VALUES ('NAV-C1', 'Ana', 'Reyes', 'Lic.') RETURNING id`);
  const est = await uno(`INSERT INTO estudiantes (codigo_alumno, dni, nombres, apellidos, fecha_nacimiento, promocion_id, direccion, tipo_sangre)
                         VALUES ('NAV-E1', 'NAV-E1', 'Carla', 'Diaz', '2005-03-01', $1, 'Barrio Secreto 77', 'O-') RETURNING id`, [prom.id]);
  const clase = await uno(`INSERT INTO clases (codigo_clase, periodo_id, promocion_id, materia_id, catedratico_id, horario)
                           VALUES ('NAV-101', $1, $2, $3, $4, 'L 08:00') RETURNING id`, [periodo.id, prom.id, mat.id, cat.id]);
  const liga = (proveedor, rol, referencia) => db.consultar(
    `INSERT INTO usuarios (username, proveedor_id, rol, nombre_completo, referencia_id) VALUES ($1, $1, $2, $1, $3)`,
    [proveedor, rol, referencia]);
  await liga(CUENTA.admin, 'ADMIN', null);
  await liga(CUENTA.ana, 'CATEDRATICO', cat.id);
  await liga(CUENTA.carla, 'ESTUDIANTE', est.id);
  d = { clase: clase.id, est: est.id, hoy };

  servidor = await levantar(ENTORNO_CON_SESION, { db });
  navegador = await chromium.launch();
});

after(async () => {
  await navegador?.close();
  await servidor?.cerrar();
  await base?.cerrar();
});

async function equipo(cuenta, rol) {
  const contexto = await navegador.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 900 } });
  const ahora = Math.floor(Date.now() / 1000);
  const token = firmarSesion({ usuario: cuenta, rol, exp: ahora + 900 });
  await contexto.addInitScript((t) => { window.__tokenDePrueba = t; }, token);
  await contexto.route(`https://${DOMINIO_CLERK}/**`, (ruta) => ruta.fulfill({
    status: 200,
    headers: { 'Content-Type': 'application/javascript', 'Access-Control-Allow-Origin': '*' },
    body: CLERK_SUSTITUTO
  }));
  const pagina = await contexto.newPage();
  const errores = [];
  pagina.on('pageerror', (e) => errores.push(e.message));
  pagina.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
  await pagina.goto(servidor.base);
  await pagina.waitForSelector('#app-shell:not(.hidden)', { timeout: 15000 });
  return { contexto, pagina, errores };
}

const ir = (pagina, vista) => pagina.evaluate((v) => navigateTo(v), vista);
const almacenLocal = (pagina) => pagina.evaluate(() => localStorage.getItem('esoe_sms_store_v3'));
const esperarRespuesta = (pagina, metodo, parte) => pagina.waitForResponse(
  (r) => r.request().method() === metodo && r.url().includes(parte));

test('navegador: dos personas en equipos distintos ven los mismos datos', omitir, async () => {
  const admin = await equipo(CUENTA.admin, 'ADMIN');
  const ana = await equipo(CUENTA.ana, 'CATEDRATICO');
  try {
    await ir(admin.pagina, 'estructura');
    await admin.pagina.evaluate(() => openModalNuevoPeriodo());
    await admin.pagina.fill('#per-codigo', 'nav-2027');
    await admin.pagina.fill('#per-nombre', 'Periodo creado en el equipo A');
    await admin.pagina.selectOption('#per-modalidad', 'SEMESTRAL');
    await admin.pagina.fill('#per-inicio', '2027-01-15');
    await admin.pagina.fill('#per-fin', '2027-06-30');
    const creado = esperarRespuesta(admin.pagina, 'POST', '/api/periodos');
    await admin.pagina.click('#modal-body-content button[type="submit"]');
    assert.equal((await creado).status(), 201);

    await ir(admin.pagina, 'calificaciones');
    const notaAdmin = esperarRespuesta(admin.pagina, 'PUT', '/calificaciones/');
    await admin.pagina.fill('.grade-input >> nth=0', '88');
    await admin.pagina.press('.grade-input >> nth=0', 'Tab');
    assert.equal((await notaAdmin).status(), 200);

    await ana.pagina.reload();
    await ana.pagina.waitForSelector('#app-shell:not(.hidden)');
    await ir(ana.pagina, 'estructura');
    assert.match(await ana.pagina.textContent('#content-area'), /Periodo creado en el equipo A/);
    await ir(ana.pagina, 'calificaciones');
    assert.equal(await ana.pagina.inputValue('.grade-input >> nth=0'), '88');

    const notaAna = esperarRespuesta(ana.pagina, 'PUT', '/calificaciones/');
    await ana.pagina.fill('.grade-input >> nth=3', '75');
    await ana.pagina.press('.grade-input >> nth=3', 'Tab');
    assert.equal((await notaAna).status(), 200);
    await admin.pagina.reload();
    await admin.pagina.waitForSelector('#app-shell:not(.hidden)');
    await ir(admin.pagina, 'calificaciones');
    assert.equal(await admin.pagina.inputValue('.grade-input >> nth=3'), '75');

    const { rows } = await base.db.consultar(
      `SELECT campo, valor_nuevo, autor FROM auditoria WHERE estudiante_id = $1 ORDER BY cambiado_en`, [d.est]);
    assert.ok(rows.some((r) => r.campo === 'parcial_1' && r.valor_nuevo === '88.00' && r.autor === `api:${CUENTA.admin}`));
    assert.ok(rows.some((r) => r.campo === 'acumulativo' && r.valor_nuevo === '75.00' && r.autor === `api:${CUENTA.ana}`));

    assert.equal(await almacenLocal(admin.pagina), null);
    assert.equal(await almacenLocal(ana.pagina), null);
    assert.deepEqual(admin.errores, []);
    assert.deepEqual(ana.errores, []);
  } finally {
    await admin.contexto.close();
    await ana.contexto.close();
  }
});

test('navegador: la asistencia guardada en un equipo aparece en el otro', omitir, async () => {
  const ana = await equipo(CUENTA.ana, 'CATEDRATICO');
  const admin = await equipo(CUENTA.admin, 'ADMIN');
  try {
    await ir(ana.pagina, 'asistencia');
    await ana.pagina.click('.att-btn:has-text("AUSENTE") >> nth=0');
    const guardada = esperarRespuesta(ana.pagina, 'POST', '/asistencia');
    await ana.pagina.click('button:has-text("Guardar")');
    assert.equal((await guardada).status(), 201);

    await admin.pagina.reload();
    await admin.pagina.waitForSelector('#app-shell:not(.hidden)');
    await ir(admin.pagina, 'asistencia');
    assert.match(await admin.pagina.getAttribute('.att-btn:has-text("AUSENTE") >> nth=0', 'class'), /active-AUSENTE/);
    assert.deepEqual(ana.errores, []);
    assert.deepEqual(admin.errores, []);
  } finally {
    await ana.contexto.close();
    await admin.contexto.close();
  }
});

test('navegador: el catedratico no recibe la direccion ni la sangre del estudiante', omitir, async () => {
  const ana = await equipo(CUENTA.ana, 'CATEDRATICO');
  try {
    const datos = await ana.pagina.evaluate(() => JSON.stringify(store));
    assert.ok(datos.includes('Carla'), 've a su estudiante');
    assert.ok(!datos.includes('Barrio Secreto 77') && !datos.includes('O-'), 'sin datos sensibles en la memoria de la pagina');
  } finally {
    await ana.contexto.close();
  }
});

test('navegador: el estudiante ve su propio boletin con la nota que puso el catedratico', omitir, async () => {
  const carla = await equipo(CUENTA.carla, 'ESTUDIANTE');
  try {
    const texto = await carla.pagina.textContent('#content-area');
    assert.match(texto, /Tactica Basica/);
    assert.match(texto, /88/);
    assert.match(texto, /75/);
    assert.equal(await almacenLocal(carla.pagina), null);
    assert.deepEqual(carla.errores, []);
  } finally {
    await carla.contexto.close();
  }
});
