'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { once } = require('node:events');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const { crearRegistro, redactar, redactarTexto, identificadorDePeticion, NIVELES, CABECERA_PETICION } = require('../src/registro');
const { conReintentos, esTransitorio, retrasoDeReintento, obtener, ErrorDeRed } = require('../src/seguridad/red');
const { esFalloDeArranque } = require('../scripts/migrar');
const { validarConfig, cargarConfig, tiemposHttpDe } = require('../src/config');
const { levantar, crearMoodleFalso } = require('./ayuda');
const { crearClienteMoodle } = require('../src/integraciones/moodle');

function capturar(opciones = {}) {
  const lineas = [];
  const registro = crearRegistro({ nivel: 'depuracion', entorno: 'test', ...opciones, salida: (l) => lineas.push(l) });
  return { registro, lineas, eventos: () => lineas.map((l) => JSON.parse(l)) };
}

test('registro: cada evento es una linea JSON con marca de tiempo, nivel y servicio', () => {
  const { registro, eventos } = capturar({ version: 'abc1234' });
  registro.info('arranque', { puerto: 8080 });
  const [evento] = eventos();
  assert.equal(evento.nivel, 'info');
  assert.equal(evento.mensaje, 'arranque');
  assert.equal(evento.servicio, 'ESOE-SMS');
  assert.equal(evento.entorno, 'test');
  assert.equal(evento.version, 'abc1234');
  assert.equal(evento.puerto, 8080);
  assert.ok(!Number.isNaN(Date.parse(evento.t)));
});

test('registro: el umbral descarta lo que esta por debajo y silencio no emite nada', () => {
  const soloErrores = capturar({ nivel: 'error' });
  soloErrores.registro.info('no debe salir');
  soloErrores.registro.aviso('tampoco');
  soloErrores.registro.error('si sale');
  assert.deepEqual(soloErrores.eventos().map((e) => e.mensaje), ['si sale']);

  const mudo = capturar({ nivel: 'silencio' });
  for (const nivel of ['depuracion', 'info', 'aviso', 'error']) mudo.registro[nivel]('nada');
  assert.equal(mudo.lineas.length, 0);
  assert.equal(NIVELES.silencio > NIVELES.error, true);
});

test('registro: un nivel desconocido cae a info en lugar de romper', () => {
  const { registro, eventos } = capturar({ nivel: 'inventado' });
  registro.depuracion('no sale');
  registro.info('si sale');
  assert.deepEqual(eventos().map((e) => e.mensaje), ['si sale']);
});

test('registro: los campos sensibles nunca llegan a la salida', () => {
  const { registro, lineas, eventos } = capturar();
  registro.info('intento de acceso', {
    authorization: 'Bearer secretisimo',
    cookie: '__session=abc',
    clave: 'Clave-Real-1',
    password: 'otra',
    token: 'tok-123',
    CLAVE_CIFRADO: 'f'.repeat(64),
    dni: '0801199900001',
    correo: 'alumno@institucion.example',
    anidado: { llaveSecreta: 'sk_live_xyz', visible: 'si' },
    usuarioId: 'user_42'
  });
  const [evento] = eventos();
  for (const clave of ['authorization', 'cookie', 'clave', 'password', 'token', 'CLAVE_CIFRADO', 'dni', 'correo']) {
    assert.equal(evento[clave], '[REDACTADO]', clave);
  }
  assert.equal(evento.anidado.llaveSecreta, '[REDACTADO]');
  assert.equal(evento.anidado.visible, 'si');
  assert.equal(evento.usuarioId, 'user_42');
  const crudo = lineas.join('');
  for (const fuga of ['secretisimo', 'Clave-Real-1', 'tok-123', '0801199900001', 'alumno@institucion.example', 'sk_live_xyz']) {
    assert.equal(crudo.includes(fuga), false, fuga);
  }
});

test('registro: el mensaje de un Error no filtra credenciales ni datos personales', () => {
  const { registro, lineas, eventos } = capturar();
  const fallo = new Error('password authentication failed: clave=Sup3rS3creta-1 para alumno@institucion.example (dni 0801199900001)');
  fallo.code = '28P01';
  registro.error('no se pudo conectar', { fallo });
  const [evento] = eventos();
  assert.equal(evento.fallo.code, '28P01');
  const crudo = lineas.join('');
  for (const fuga of ['Sup3rS3creta-1', 'alumno@institucion.example', '0801199900001']) {
    assert.equal(crudo.includes(fuga), false, `se filtro ${fuga}`);
  }
  assert.ok(evento.fallo.mensaje.includes('[REDACTADO]'));
});

test('registro: el mensaje suelto tambien se redacta, no solo los campos', () => {
  const { registro, lineas } = capturar();
  registro.error('fallo con token=abc123-def456-ghi789 de correo@ejemplo.hn');
  const crudo = lineas.join('');
  assert.equal(crudo.includes('abc123-def456-ghi789'), false);
  assert.equal(crudo.includes('correo@ejemplo.hn'), false);
});

test('registro: la redaccion de texto deja legible lo que no es secreto', () => {
  assert.equal(redactarTexto('clase ELEC-1 de la promocion 2026'), 'clase ELEC-1 de la promocion 2026');
  assert.equal(redactarTexto('password: hunter2'), 'password: [REDACTADO]');
  assert.equal(redactarTexto('contacto en juan@esoe.hn'), 'contacto en [REDACTADO]');
  assert.equal(redactarTexto(`clave ${'f'.repeat(64)}`), 'clave [REDACTADO]');
  assert.equal(redactarTexto('expediente 0801199900001'), 'expediente [REDACTADO]');
  assert.match(redactarTexto('peticion 5f1c2d3e-4b5a-6c7d-8e9f-0a1b2c3d4e5f'), /5f1c2d3e-4b5a/);
});

test('registro: recorta textos largos, corta la profundidad y resiste ciclos', () => {
  const ciclo = { nombre: 'raiz' };
  ciclo.yo = ciclo;
  const prosa = `${'palabra '.repeat(200)}final`;
  const limpio = redactar({ largo: prosa, posibleSecreto: 'x'.repeat(900), ciclo, hondo: { a: { b: { c: { d: 'invisible' } } } } });
  assert.equal(limpio.largo.length, 512 + 5);
  assert.ok(limpio.largo.endsWith('[...]'));
  assert.equal(limpio.posibleSecreto, '[REDACTADO]');
  assert.equal(limpio.ciclo.yo, '[CICLO]');
  assert.equal(limpio.hondo.a.b.c, '[REDACTADO]');
});

test('registro: un Error se serializa con nombre, mensaje y codigo', () => {
  const { registro, eventos } = capturar();
  const fallo = new ErrorDeRed('TIEMPO_AGOTADO', 'La plataforma no respondio a tiempo.');
  registro.error('fallo de red', { fallo });
  const [evento] = eventos();
  assert.equal(evento.fallo.nombre, 'ErrorDeRed');
  assert.equal(evento.fallo.codigo, 'TIEMPO_AGOTADO');
  assert.equal(evento.fallo.mensaje, 'La plataforma no respondio a tiempo.');
});

test('registro: una funcion toJSON hostil se redacta sin llegar a serializarse', () => {
  const { registro, eventos } = capturar();
  registro.info('raro', { bomba: { toJSON() { throw new Error('no se puede'); } } });
  const [evento] = eventos();
  assert.equal(evento.mensaje, 'raro');
  assert.equal(evento.bomba.toJSON, '[REDACTADO]');
});

test('registro: si ni la redaccion puede leer el dato, el evento degrada y el proceso sigue', () => {
  const { registro, eventos } = capturar();
  const hostil = new Proxy({}, { ownKeys() { throw new Error('no se puede enumerar'); } });
  registro.info('raro', { hostil });
  const [evento] = eventos();
  assert.equal(evento.mensaje, 'Evento de registro no serializable.');
  assert.equal(evento.nivel, 'error');
  registro.info('despues del fallo');
  assert.equal(eventos()[1].mensaje, 'despues del fallo');
});

test('registro: hijo hereda el contexto del padre y lo acumula', () => {
  const { registro, eventos } = capturar();
  registro.hijo({ peticion: 'p-1' }).hijo({ institucion: 'ESOE' }).info('anidado');
  const [evento] = eventos();
  assert.equal(evento.peticion, 'p-1');
  assert.equal(evento.institucion, 'ESOE');
});

test('identificador de peticion: acepta uno valido y descarta el que no lo es', () => {
  assert.equal(identificadorDePeticion('peticion-Valida_123'), 'peticion-Valida_123');
  for (const invalido of ['', '   ', 'corto', 'con espacio dentro', `${'a'.repeat(65)}`, '<script>alert(1)</script>', undefined]) {
    const generado = identificadorDePeticion(invalido);
    assert.notEqual(generado, invalido);
    assert.match(generado, /^[0-9a-f-]{36}$/);
  }
});

test('peticiones: la respuesta lleva el identificador y queda una linea de acceso', async () => {
  const { registro, eventos } = capturar();
  const servidor = await levantar({}, { registro });
  try {
    const respuesta = await servidor.pedir('/api/live');
    const identificador = respuesta.headers.get(CABECERA_PETICION);
    assert.match(identificador, /^[0-9a-f-]{36}$/);
    const acceso = eventos().find((e) => e.mensaje === 'peticion atendida');
    assert.equal(acceso.peticion, identificador);
    assert.equal(acceso.metodo, 'GET');
    assert.equal(acceso.ruta, '/api/live');
    assert.equal(acceso.estado, 200);
    assert.equal(acceso.nivel, 'info');
    assert.equal(typeof acceso.ms, 'number');
    assert.ok(acceso.ms >= 0);
  } finally {
    await servidor.cerrar();
  }
});

test('peticiones: un identificador entrante valido se propaga y uno invalido se reemplaza', async () => {
  const servidor = await levantar({}, { registro: capturar().registro });
  try {
    const propio = 'traza-de-la-pasarela-01';
    const conservado = await servidor.pedir('/api/live', { headers: { [CABECERA_PETICION]: propio } });
    assert.equal(conservado.headers.get(CABECERA_PETICION), propio);

    const sucio = await servidor.pedir('/api/live', { headers: { [CABECERA_PETICION]: 'a b' } });
    assert.notEqual(sucio.headers.get(CABECERA_PETICION), 'a b');
    assert.match(sucio.headers.get(CABECERA_PETICION), /^[0-9a-f-]{36}$/);
  } finally {
    await servidor.cerrar();
  }
});

test('peticiones: un 404 se registra como aviso y no como error', async () => {
  const { registro, eventos } = capturar();
  const servidor = await levantar({}, { registro });
  try {
    await servidor.pedir('/api/no-existe');
    const acceso = eventos().find((e) => e.mensaje === 'peticion atendida');
    assert.equal(acceso.estado, 404);
    assert.equal(acceso.nivel, 'aviso');
  } finally {
    await servidor.cerrar();
  }
});

test('reintentos: el retraso crece de forma exponencial, con tope y con jitter', () => {
  assert.equal(retrasoDeReintento(1, 200, 2000, () => 0), 100);
  assert.equal(retrasoDeReintento(1, 200, 2000, () => 1), 200);
  assert.equal(retrasoDeReintento(2, 200, 2000, () => 0), 200);
  assert.equal(retrasoDeReintento(3, 200, 2000, () => 1), 800);
  assert.equal(retrasoDeReintento(20, 200, 2000, () => 1), 2000);
  for (let intento = 1; intento <= 8; intento += 1) {
    const valor = retrasoDeReintento(intento, 200, 2000);
    assert.ok(valor >= 1 && valor <= 2000, `intento ${intento}: ${valor}`);
  }
});

test('reintentos: solo son transitorios los fallos de los que vale la pena reintentar', () => {
  assert.equal(esTransitorio(new ErrorDeRed('TIEMPO_AGOTADO', 'x')), true);
  assert.equal(esTransitorio(new ErrorDeRed('SIN_CONEXION', 'x')), true);
  assert.equal(esTransitorio(new ErrorDeRed('CREDENCIAL_RECHAZADA', 'x')), false);
  assert.equal(esTransitorio(new ErrorDeRed('DESTINO_NO_PERMITIDO', 'x')), false);
  assert.equal(esTransitorio(new Error('cualquiera')), false);
  for (const estado of [429, 502, 503, 504]) {
    const fallo = new ErrorDeRed('RESPUESTA_INESPERADA', 'x');
    fallo.estado = estado;
    assert.equal(esTransitorio(fallo), true, String(estado));
  }
  for (const estado of [400, 401, 404, 500]) {
    const fallo = new ErrorDeRed('RESPUESTA_INESPERADA', 'x');
    fallo.estado = estado;
    assert.equal(esTransitorio(fallo), false, String(estado));
  }
});

test('reintentos: insiste ante un fallo transitorio y entrega el resultado bueno', async () => {
  const esperas = [];
  let llamadas = 0;
  const valor = await conReintentos(() => {
    llamadas += 1;
    if (llamadas < 3) throw new ErrorDeRed('SIN_CONEXION', 'cae');
    return 'listo';
  }, { intentos: 4, dormir: (ms) => { esperas.push(ms); }, aleatorio: () => 0 });
  assert.equal(valor, 'listo');
  assert.equal(llamadas, 3);
  assert.deepEqual(esperas, [100, 200]);
});

test('reintentos: se rinde al agotar los intentos y propaga el ultimo fallo', async () => {
  let llamadas = 0;
  await assert.rejects(() => conReintentos(() => {
    llamadas += 1;
    throw new ErrorDeRed('TIEMPO_AGOTADO', 'siempre cae');
  }, { intentos: 3, dormir: () => {}, aleatorio: () => 0 }), /siempre cae/);
  assert.equal(llamadas, 3);
});

test('reintentos: un fallo definitivo no se reintenta ni una vez', async () => {
  let llamadas = 0;
  await assert.rejects(() => conReintentos(() => {
    llamadas += 1;
    throw new ErrorDeRed('CREDENCIAL_RECHAZADA', 'no insistas');
  }, { intentos: 5, dormir: () => { throw new Error('no deberia dormir'); } }), /no insistas/);
  assert.equal(llamadas, 1);
});

test('reintentos: un Retry-After por encima del presupuesto detiene los reintentos al instante', async () => {
  const anotaciones = [];
  let llamadas = 0;
  const conEspera = (segundos) => {
    const fallo = new ErrorDeRed('RESPUESTA_INESPERADA', 'estado 503');
    fallo.estado = 503;
    fallo.esperaPedidaMs = segundos * 1000;
    return fallo;
  };

  await assert.rejects(() => conReintentos(() => { llamadas += 1; throw conEspera(300); }, {
    intentos: 5, baseMs: 200, maximoMs: 2000, dormir: () => {}, anotar: (d) => anotaciones.push(d)
  }), /503/);
  assert.equal(llamadas, 1, 'no se insiste cuando el servidor pide 300 s y el presupuesto son 10 s');
  assert.equal(anotaciones[0].decision, 'no se reintenta');
  assert.equal(anotaciones[0].esperaPedidaMs, 300000);

  llamadas = 0;
  await assert.rejects(() => conReintentos(() => { llamadas += 1; throw conEspera(1); }, {
    intentos: 3, baseMs: 200, maximoMs: 2000, dormir: () => {}, aleatorio: () => 0
  }), /503/);
  assert.equal(llamadas, 3, 'un Retry-After de 1 s si cabe en el presupuesto y se reintenta');
});

test('reintentos: cada espera queda anotada para el registro', async () => {
  const anotaciones = [];
  await assert.rejects(() => conReintentos(() => {
    throw new ErrorDeRed('SIN_CONEXION', 'cae');
  }, { intentos: 3, dormir: () => {}, aleatorio: () => 0, anotar: (d) => anotaciones.push(d) }));
  assert.deepEqual(anotaciones, [
    { intento: 1, intentos: 3, retraso: 100, codigo: 'SIN_CONEXION' },
    { intento: 2, intentos: 3, retraso: 200, codigo: 'SIN_CONEXION' }
  ]);
});

test('moodle: una lectura que falla de forma transitoria se reintenta y termina bien', async () => {
  const moodle = await crearMoodleFalso();
  try {
    const cliente = crearClienteMoodle({ permitirRedPrivada: true, tiempoMaximoMs: 1500 });
    const configuracion = (ruta) => moodle.estado.peticiones.filter((p) => p.ruta === ruta).length;
    const RUTA = '/lib/ajax/service-nologin.php';

    moodle.estado.fallosTransitorios = 2;
    const sitio = await cliente.configuracionPublica(moodle.url);

    assert.equal(sitio.serviciosWeb, true);
    assert.equal(configuracion(RUTA), 3, 'debieron hacerse dos reintentos antes del exito');
    assert.equal(moodle.estado.fallosTransitorios, 0);
  } finally {
    await moodle.cerrar();
  }
});

test('moodle: una lectura que nunca se recupera agota los reintentos y falla', async () => {
  const moodle = await crearMoodleFalso();
  try {
    const cliente = crearClienteMoodle({ permitirRedPrivada: true, tiempoMaximoMs: 1500 });
    moodle.estado.fallosTransitorios = 99;

    await assert.rejects(() => cliente.configuracionPublica(moodle.url), /mantenimiento/);
    assert.equal(
      moodle.estado.peticiones.filter((p) => p.ruta === '/lib/ajax/service-nologin.php').length, 3,
      'se esperan exactamente 3 intentos y ni uno mas');
  } finally {
    await moodle.cerrar();
  }
});

test('moodle: el mantenimiento CLI real no gasta reintentos, porque Moodle pide 300 s', async () => {
  const moodle = await crearMoodleFalso();
  try {
    const cliente = crearClienteMoodle({ permitirRedPrivada: true, tiempoMaximoMs: 1500 });
    moodle.estado.enMantenimientoCli = true;

    await assert.rejects(() => cliente.configuracionPublica(moodle.url), (error) => {
      assert.equal(error.name, 'ErrorDeMoodle');
      assert.equal(error.codigo, 'EN_MANTENIMIENTO');
      return true;
    });
    assert.equal(
      moodle.estado.peticiones.filter((p) => p.ruta === '/lib/ajax/service-nologin.php').length, 1,
      'con Retry-After por encima del presupuesto no se reintenta ni una vez');
  } finally {
    await moodle.cerrar();
  }
});

test('moodle: el envio de credenciales no se reintenta ni ante un fallo transitorio', async () => {
  const moodle = await crearMoodleFalso();
  try {
    const cliente = crearClienteMoodle({ permitirRedPrivada: true, tiempoMaximoMs: 1500 });
    const intentosDeLogin = () => moodle.estado.peticiones.filter((p) => p.ruta === '/login/token.php').length;

    moodle.estado.fallosTransitorios = 1;
    await assert.rejects(() => cliente.obtenerToken(moodle.url, 'alumno.prueba', 'Clave-Correcta-1'), /estado 503/);
    assert.equal(intentosDeLogin(), 1, 'un 503 al enviar credenciales no se reintenta');

    await assert.rejects(() => cliente.obtenerToken(moodle.url, 'alumno.prueba', 'Clave-Equivocada'), /credenciales/);
    assert.equal(intentosDeLogin(), 2, 'una credencial rechazada tampoco se reintenta');
  } finally {
    await moodle.cerrar();
  }
});

test('migrar: un plazo de conexion agotado cuenta como fallo de arranque y permite reintentar', () => {
  const porPlazo = new Error('timeout expired');
  assert.equal(esFalloDeArranque(porPlazo), true);
  assert.equal(esFalloDeArranque(new Error('Connection terminated unexpectedly')), true);
  assert.equal(esFalloDeArranque(new Error('password authentication failed')), false);
});

test('migrar: se reconocen los fallos de una base que aun esta arrancando', () => {
  for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET', '57P03', '53300']) {
    assert.equal(esFalloDeArranque(Object.assign(new Error('x'), { code })), true, code);
  }
  assert.equal(esFalloDeArranque(Object.assign(new Error('x'), { code: '28P01' })), false);
  assert.equal(esFalloDeArranque(new Error('sin codigo')), false);
  const agregado = new Error('agregado');
  agregado.errors = [Object.assign(new Error('a'), { code: 'EHOSTUNREACH' }), Object.assign(new Error('b'), { code: 'ECONNREFUSED' })];
  assert.equal(esFalloDeArranque(agregado), true);
});

test('tiempos http: la configuracion trae valores sanos y exige un orden coherente', () => {
  const config = cargarConfig({ NODE_ENV: 'test' });
  assert.deepEqual(config.tiemposHttp, { keepAliveMs: 5000, cabecerasMs: 10000, peticionMs: 30000, revisionMs: 2500 });
  assert.equal(config.registro.nivel, 'silencio');

  const propio = cargarConfig({
    NODE_ENV: 'test', LOG_NIVEL: 'aviso',
    HTTP_KEEPALIVE_TIMEOUT_MS: '2000', HTTP_HEADERS_TIMEOUT_MS: '4000', HTTP_REQUEST_TIMEOUT_MS: '9000'
  });
  assert.deepEqual(propio.tiemposHttp, { keepAliveMs: 2000, cabecerasMs: 4000, peticionMs: 9000, revisionMs: 1000 });
  assert.equal(tiemposHttpDe({ HTTP_KEEPALIVE_TIMEOUT_MS: '1000', HTTP_HEADERS_TIMEOUT_MS: '1000' }).revisionMs, 500);
  assert.equal(propio.registro.nivel, 'aviso');

  assert.throws(() => cargarConfig({ NODE_ENV: 'test', HTTP_HEADERS_TIMEOUT_MS: '3000' }), /HTTP_HEADERS_TIMEOUT_MS/);
  assert.throws(() => cargarConfig({ NODE_ENV: 'test', HTTP_REQUEST_TIMEOUT_MS: '6000' }), /HTTP_REQUEST_TIMEOUT_MS/);
  assert.throws(() => cargarConfig({ NODE_ENV: 'test', LOG_NIVEL: 'verboso' }), /LOG_NIVEL/);
  assert.throws(() => cargarConfig({ NODE_ENV: 'test', HTTP_KEEPALIVE_TIMEOUT_MS: '0' }), /HTTP_KEEPALIVE_TIMEOUT_MS/);
  assert.deepEqual(validarConfig({ voz: {}, limitePeticiones: { almacen: 'memory' }, clerk: {}, integraciones: {} }), []);
});

function puertoLibre() {
  return new Promise((resolver, rechazar) => {
    const sonda = net.createServer();
    sonda.unref();
    sonda.on('error', rechazar);
    sonda.listen(0, '127.0.0.1', () => {
      const { port } = sonda.address();
      sonda.close(() => resolver(port));
    });
  });
}

test('tiempos http: el servidor corta una peticion que no termina de enviar cabeceras', async () => {
  const puerto = await puertoLibre();
  const hijo = spawn(process.execPath, ['src/server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: '',
      PORT: String(puerto),
      HOST: '127.0.0.1',
      LOG_NIVEL: 'info',
      HTTP_KEEPALIVE_TIMEOUT_MS: '1000',
      HTTP_HEADERS_TIMEOUT_MS: '1500',
      HTTP_REQUEST_TIMEOUT_MS: '2500'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const arrancado = new Promise((resolver, rechazar) => {
    let acumulado = '';
    hijo.stdout.on('data', (trozo) => {
      acumulado += trozo.toString('utf8');
      for (const linea of acumulado.split('\n')) {
        if (!linea.trim()) continue;
        try {
          const evento = JSON.parse(linea);
          if (evento.mensaje === 'servidor activo' && evento.puerto === puerto) resolver(evento);
        } catch { continue; }
      }
    });
    hijo.once('error', rechazar);
    hijo.once('exit', (codigo) => rechazar(new Error(`el servidor termino con codigo ${codigo}`)));
  });

  try {
    const evento = await arrancado;
    assert.equal(evento.nivel, 'info');
    assert.equal(evento.baseDeDatos, 'SIN_CONFIGURAR');

    const enchufe = net.connect(puerto, '127.0.0.1');
    await once(enchufe, 'connect');
    const respuesta = [];
    enchufe.on('data', (trozo) => respuesta.push(trozo));
    enchufe.write('GET /api/live HTTP/1.1\r\nHost: 127.0.0.1\r\n');
    const inicio = Date.now();
    await once(enchufe, 'close');
    const transcurrido = Date.now() - inicio;
    assert.ok(transcurrido < 6000, `el servidor tardo ${transcurrido} ms en cortar la conexion a medias`);
    assert.ok(transcurrido >= 1000, `el servidor corto demasiado pronto (${transcurrido} ms)`);
    assert.match(Buffer.concat(respuesta).toString('utf8'), /^HTTP\/1\.1 408 /);
  } finally {
    hijo.kill('SIGKILL');
    await once(hijo, 'exit').catch(() => {});
  }
});

async function arrancarServidor(extra = {}, argumentos = ['src/server.js']) {
  const puerto = await puertoLibre();
  const hijo = spawn(process.execPath, argumentos, {
    cwd: process.cwd(),
    env: {
      ...process.env, NODE_ENV: 'test', DATABASE_URL: '', PORT: String(puerto),
      HOST: '127.0.0.1', LOG_NIVEL: 'info', ...extra
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const salida = [];
  hijo.stdout.on('data', (t) => salida.push(t.toString('utf8')));
  hijo.stderr.on('data', (t) => salida.push(t.toString('utf8')));
  const activo = new Promise((resolver, rechazar) => {
    const revisar = () => {
      for (const linea of salida.join('').split('\n')) {
        if (!linea.trim()) continue;
        try {
          const evento = JSON.parse(linea);
          if (evento.mensaje === 'servidor activo' && evento.puerto === puerto) return resolver(evento);
        } catch { continue; }
      }
      return null;
    };
    hijo.stdout.on('data', revisar);
    hijo.once('exit', (codigo) => rechazar(new Error(`el servidor termino con codigo ${codigo}: ${salida.join('')}`)));
  });
  return { hijo, puerto, salida, activo };
}

test('apagado: una senal ordenada termina con codigo 0', async () => {
  const { hijo, activo, salida } = await arrancarServidor();
  await activo;
  hijo.kill('SIGTERM');
  const [codigo] = await once(hijo, 'exit');
  assert.equal(codigo, 0, salida.join(''));
  assert.match(salida.join(''), /"mensaje":"apagado completo"/);
});

test('apagado: una promesa rechazada sin manejador termina con codigo distinto de cero', async () => {
  const { hijo, activo, salida } = await arrancarServidor(
    {}, ['-e', "require('./src/server.js'); setTimeout(() => Promise.reject(new Error('fallo asincrono de prueba')), 300);"]);
  await activo;
  const [codigo] = await once(hijo, 'exit');
  assert.notEqual(codigo, 0, `un fallo debe terminar con codigo != 0, termino con ${codigo}: ${salida.join('')}`);
  assert.match(salida.join(''), /promesa rechazada sin manejador/);
});

test('apagado: una excepcion no capturada termina con codigo distinto de cero', async () => {
  const { hijo, activo, salida } = await arrancarServidor(
    {}, ['-e', "require('./src/server.js'); setTimeout(() => { throw new Error('fallo sincrono de prueba'); }, 300);"]);
  await activo;
  const [codigo] = await once(hijo, 'exit');
  assert.notEqual(codigo, 0, `un crash debe terminar con codigo != 0, termino con ${codigo}: ${salida.join('')}`);
  assert.match(salida.join(''), /excepcion no capturada/);
});

test('red: una respuesta mas grande que el limite rechaza y no deja la promesa colgada', async () => {
  const http = require('node:http');
  const servidor = http.createServer((_peticion, respuesta) => {
    respuesta.writeHead(200, { 'Content-Type': 'text/plain' });
    respuesta.write('a'.repeat(66000));
    setTimeout(() => respuesta.end('final'), 5000).unref();
  });
  await new Promise((listo) => servidor.listen(0, '127.0.0.1', listo));
  const { port } = servidor.address();
  let reloj;
  const conPlazo = (promesa) => Promise.race([
    promesa,
    new Promise((_sin, fallar) => {
      reloj = setTimeout(() => fallar(new Error('la promesa quedo colgada')), 3000);
    })
  ]);
  try {
    await assert.rejects(
      () => conPlazo(obtener(`http://127.0.0.1:${port}/`, {
        permitirRedPrivada: true, tiempoMaximoMs: 20000, maximoBytes: 65536
      })),
      (error) => error instanceof ErrorDeRed && error.codigo === 'RESPUESTA_DEMASIADO_GRANDE'
    );
  } finally {
    clearTimeout(reloj);
    servidor.close();
  }
});

test('reintentos: un Retry-After que cabe en el presupuesto fija el minimo de espera', async () => {
  const conEspera = (ms) => {
    const fallo = new ErrorDeRed('RESPUESTA_INESPERADA', 'estado 503');
    fallo.estado = 503;
    fallo.esperaPedidaMs = ms;
    return fallo;
  };

  const esperasLargas = [];
  const anotaciones = [];
  await assert.rejects(() => conReintentos(() => { throw conEspera(1000); }, {
    intentos: 3, baseMs: 200, maximoMs: 2000, aleatorio: () => 0,
    dormir: (ms) => { esperasLargas.push(ms); }, anotar: (d) => anotaciones.push(d)
  }), /503/);
  assert.deepEqual(esperasLargas, [1000, 1000], 'sin honrar el Retry-After serian 100 y 200');
  assert.equal(anotaciones[0].esperaPedidaMs, 1000);

  const esperasCortas = [];
  const anotacionesCortas = [];
  await assert.rejects(() => conReintentos(() => { throw conEspera(50); }, {
    intentos: 3, baseMs: 200, maximoMs: 2000, aleatorio: () => 0,
    dormir: (ms) => { esperasCortas.push(ms); }, anotar: (d) => anotacionesCortas.push(d)
  }), /503/);
  assert.deepEqual(esperasCortas, [100, 200], 'un Retry-After menor que el exponencial no lo acorta');
  assert.deepEqual(anotacionesCortas, [
    { intento: 1, intentos: 3, retraso: 100, codigo: 'RESPUESTA_INESPERADA' },
    { intento: 2, intentos: 3, retraso: 200, codigo: 'RESPUESTA_INESPERADA' }
  ]);
});
