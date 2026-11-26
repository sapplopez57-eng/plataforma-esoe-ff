const datosServidor = { cargando: false, aviso: '' };

const NOTA_EN_SERVIDOR = { parcial1: 'parcial_1', parcial2: 'parcial_2', parcial3: 'parcial_3', acumulativo: 'acumulativo' };

const aNumero = (v) => (v === null || v === undefined ? 0 : Number(v));
const aTexto = (v) => (v === null || v === undefined ? '' : String(v));

const traducir = {
  periodo: (p) => ({
    id: p.id, codigo: p.codigo, nombre: p.nombre, modalidad: p.modalidad,
    fechaInicio: p.fecha_inicio, fechaFin: p.fecha_fin, activo: p.activo
  }),
  promocion: (p) => ({
    id: p.id, codigo: p.codigo, nombre: p.nombre,
    anioIngreso: p.anio_ingreso, anioEgreso: p.anio_egreso, activa: p.activa
  }),
  materia: (m) => ({
    id: m.id, codigo: m.codigo, nombre: m.nombre, uv: m.unidades_valorativas, horasSemanales: m.horas_semanales
  }),
  catedratico: (c) => ({
    id: c.id, dni: aTexto(c.dni), nombres: c.nombres, apellidos: c.apellidos, titulo: aTexto(c.titulo),
    condicion: c.condicion, grado: aTexto(c.grado), telefono: aTexto(c.telefono), correo: aTexto(c.correo),
    activo: c.activo !== false
  }),
  estudiante: (e) => ({
    id: e.id, codigoAlumno: e.codigo_alumno, dni: aTexto(e.dni), nombres: e.nombres, apellidos: e.apellidos,
    condicion: e.condicion, grado: aTexto(e.grado), promocionId: e.promocion_id,
    fechaNacimiento: aTexto(e.fecha_nacimiento), tipoSangre: aTexto(e.tipo_sangre), telefono: aTexto(e.telefono),
    correo: aTexto(e.correo), procedencia: aTexto(e.lugar_procedencia),
    contactoEmergencia: [e.contacto_emergencia_nombre, e.contacto_emergencia_telefono].filter(Boolean).join(' · '),
    direccion: aTexto(e.direccion), estado: e.estado
  }),
  clase: (c) => ({
    id: c.id, codigoClase: c.codigo_clase, periodoId: c.periodo_id, promocionId: c.promocion_id,
    materiaId: c.materia_id, catedraticoId: c.catedratico_id, horario: aTexto(c.horario), aula: aTexto(c.aula)
  }),
  calificacion: (claseId, estudianteId, g) => ({
    claseId, estudianteId,
    parcial1: aNumero(g.parcial_1), parcial2: aNumero(g.parcial_2), parcial3: aNumero(g.parcial_3),
    acumulativo: aNumero(g.acumulativo)
  })
};

function agruparAsistencia(claseId, filas) {
  const sesiones = new Map();
  filas.forEach((f) => {
    if (!sesiones.has(f.sesion_id)) {
      sesiones.set(f.sesion_id, { id: f.sesion_id, claseId: f.clase_id || claseId, fecha: f.fecha, tema: aTexto(f.tema_impartido), registros: [] });
    }
    if (f.estudiante_id) {
      sesiones.get(f.sesion_id).registros.push({ estudianteId: f.estudiante_id, estado: f.estado, observacion: aTexto(f.observacion) });
    }
  });
  return [...sesiones.values()];
}

async function pedirVarias(rutas) {
  const resultados = new Array(rutas.length);
  let siguiente = 0;
  async function trabajar() {
    while (siguiente < rutas.length) {
      const indice = siguiente++;
      try {
        resultados[indice] = { status: 'fulfilled', value: await api(rutas[indice]) };
      } catch (reason) {
        resultados[indice] = { status: 'rejected', reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, rutas.length) }, trabajar));
  return resultados.map((r) => {
    if (r.status === 'fulfilled') return r.value;
    if (r.reason && r.reason.codigo === 'SIN_EXPEDIENTE') {
      datosServidor.aviso = 'Su cuenta no está ligada a un expediente. Solicite a la administración que la vincule.';
    } else if (!datosServidor.aviso) {
      datosServidor.aviso = 'Parte de la información no se pudo cargar. Recargue la página.';
    }
    return null;
  });
}

async function cargarEstudiantes(rol, promociones) {
  if (rol === 'ESTUDIANTE') {
    const [propio] = await pedirVarias(['/estudiantes']);
    return (propio?.estudiantes || []).map(traducir.estudiante);
  }
  const rosters = await pedirVarias(promociones.map(
    (p) => `/estudiantes?promocion_id=${encodeURIComponent(p.id)}`));
  return rosters.flatMap((roster) => (roster?.estudiantes || []).map(traducir.estudiante));
}

async function cargarDesdeServidor() {
  datosServidor.cargando = true;
  datosServidor.aviso = '';
  const rol = appState.currentRole;
  const [periodos, promociones, materias, catedraticos, clases] = await pedirVarias([
    '/periodos', '/promociones', '/materias', '/catedraticos', '/clases'
  ]);
  const nuevo = emptyStore();
  nuevo.periodos = (periodos?.periodos || []).map(traducir.periodo);
  nuevo.promociones = (promociones?.promociones || []).map(traducir.promocion);
  nuevo.materias = (materias?.materias || []).map(traducir.materia);
  nuevo.catedraticos = (catedraticos?.catedraticos || []).map(traducir.catedratico);
  nuevo.clases = (clases?.clases || []).map(traducir.clase);
  nuevo.estudiantes = await cargarEstudiantes(rol, nuevo.promociones);

  if (rol === 'ESTUDIANTE') {
    const propio = nuevo.estudiantes[0];
    if (propio) {
      appState.selectedEstudianteId = propio.id;
      const [boletin, asistencia] = await pedirVarias([
        `/estudiantes/${encodeURIComponent(propio.id)}/boletin`,
        `/estudiantes/${encodeURIComponent(propio.id)}/asistencia`
      ]);
      nuevo.calificaciones = (boletin?.calificaciones || []).map((g) => traducir.calificacion(g.clase_id, propio.id, g));
      nuevo.asistencias = agruparAsistencia(null, (asistencia?.asistencia || []).map((a) => ({ ...a, estudiante_id: propio.id })));
    }
  } else {
    const porClase = await pedirVarias(nuevo.clases.flatMap((c) => [
      `/clases/${encodeURIComponent(c.id)}/calificaciones`,
      `/clases/${encodeURIComponent(c.id)}/asistencia`
    ]));
    nuevo.clases.forEach((c, i) => {
      const notas = porClase[i * 2]?.calificaciones || [];
      notas.filter((g) => g.actualizado_en).forEach((g) => {
        nuevo.calificaciones.push(traducir.calificacion(c.id, g.estudiante_id, g));
      });
      nuevo.asistencias.push(...agruparAsistencia(c.id, porClase[i * 2 + 1]?.registros || []));
    });
  }
  store = nuevo;
  datosServidor.cargando = false;
  if (datosServidor.aviso) showToast(datosServidor.aviso);
}

async function recargarDesdeServidor() {
  await cargarDesdeServidor();
  renderSidebarAndHeader();
  renderMainView();
}

function sinVacios(objeto) {
  return Object.fromEntries(Object.entries(objeto).filter(([, v]) => v !== '' && v !== null && v !== undefined));
}

const PARA_LA_API = {
  periodo: (p) => ({
    ruta: '/periodos',
    cuerpo: sinVacios({ codigo: p.codigo, nombre: p.nombre, modalidad: p.modalidad, fecha_inicio: p.fechaInicio, fecha_fin: p.fechaFin })
  }),
  promocion: (p) => ({
    ruta: '/promociones',
    cuerpo: sinVacios({ codigo: p.codigo, nombre: p.nombre, anio_ingreso: p.anioIngreso, anio_egreso: p.anioEgreso })
  }),
  materia: (m) => ({
    ruta: '/materias',
    cuerpo: sinVacios({ codigo: m.codigo, nombre: m.nombre, unidades_valorativas: m.uv, horas_semanales: m.horasSemanales })
  }),
  catedratico: (c) => ({
    ruta: '/catedraticos',
    cuerpo: sinVacios({
      dni: c.dni, nombres: c.nombres, apellidos: c.apellidos, titulo: c.titulo, condicion: c.condicion,
      grado: c.condicion === 'MILITAR' ? c.grado : '', telefono: c.telefono
    })
  }),
  estudiante: (e) => ({
    ruta: '/estudiantes',
    cuerpo: sinVacios({
      codigo_alumno: e.codigoAlumno, dni: e.dni, nombres: e.nombres, apellidos: e.apellidos, condicion: e.condicion,
      grado: e.condicion === 'MILITAR' ? e.grado : '', promocion_id: e.promocionId, fecha_nacimiento: e.fechaNacimiento,
      tipo_sangre: e.tipoSangre, telefono: e.telefono, lugar_procedencia: e.procedencia,
      contacto_emergencia_nombre: e.contactoEmergencia
    })
  }),
  clase: (c) => ({
    ruta: '/clases',
    cuerpo: sinVacios({
      codigo_clase: c.codigoClase, periodo_id: c.periodoId, promocion_id: c.promocionId, materia_id: c.materiaId,
      catedratico_id: c.catedraticoId, horario: c.horario, aula: c.aula
    })
  })
};

function motivoDelServidor(error) {
  const campos = error && error.campos;
  if (campos) {
    const [campo, motivo] = Object.entries(campos)[0] || [];
    if (campo) return `${campo.replace(/_/g, ' ')}: ${motivo}`;
  }
  return (error && error.message) || 'No se pudo guardar.';
}

let edicionActiva = null;

async function crearEnServidor(tipo, local, mensajeDeExito) {
  const { ruta, cuerpo } = PARA_LA_API[tipo](local);
  const edicion = edicionActiva && edicionActiva.tipo === tipo ? edicionActiva : null;
  try {
    if (edicion) await api(`${ruta}/${encodeURIComponent(edicion.id)}`, { metodo: 'PUT', cuerpo });
    else await api(ruta, { metodo: 'POST', cuerpo });
  } catch (error) {
    showToast(motivoDelServidor(error));
    return;
  }
  closeModal();
  await recargarDesdeServidor();
  showToast(edicion ? 'Cambios guardados' : mensajeDeExito);
}

async function guardarNotaEnServidor(claseId, estudianteId, campo, valor) {
  const cal = obtenerCalificacion(claseId, estudianteId);
  try {
    const { calificacion } = await api(
      `/clases/${encodeURIComponent(claseId)}/calificaciones/${encodeURIComponent(estudianteId)}`,
      { metodo: 'PUT', cuerpo: { [NOTA_EN_SERVIDOR[campo]]: valor } });
    Object.assign(cal, traducir.calificacion(claseId, estudianteId, calificacion));
    renderMainView();
  } catch (error) {
    showToast(motivoDelServidor(error));
    await recargarDesdeServidor();
  }
}

async function guardarAsistenciaEnServidor(sesion) {
  try {
    await api(`/clases/${encodeURIComponent(sesion.claseId)}/asistencia`, {
      metodo: 'POST',
      cuerpo: sinVacios({
        fecha: sesion.fecha,
        tema_impartido: sesion.tema,
        registros: sesion.registros.map((r) => sinVacios({ estudiante_id: r.estudianteId, estado: r.estado, observacion: r.observacion }))
      })
    });
  } catch (error) {
    showToast(motivoDelServidor(error));
    return;
  }
  await recargarDesdeServidor();
  showToast('Acta de asistencia guardada en el servidor');
}
