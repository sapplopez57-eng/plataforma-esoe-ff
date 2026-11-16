/* ==========================================================================
   PLATAFORMA ESOE - LOGICA DE APLICACION E INTERFAZ (SMS)
   ========================================================================== */

let store = loadStore();
document.addEventListener('DOMContentLoaded', () => hydrateStaticIcons());

let appState = {
  authenticated: false,
  currentRole: 'ADMIN', // 'ADMIN' | 'CATEDRATICO' | 'ESTUDIANTE'
  currentView: 'dashboard',
  selectedCatedraticoId: '',
  selectedEstudianteId: '',
  filters: {
    estudianteSearch: '',
    estudiantePromocion: 'ALL',
    catedraticoSearch: '',
    clasePromocion: 'ALL',
    claseModalidad: 'ALL',
    asistenciaClaseId: '',
    asistenciaFecha: new Date().toISOString().slice(0, 10),
    notasClaseId: '',
    boletinEstudianteId: ''
  }
};

// Iconos: Icon Park (ver js/icons.js)
const fa = (name) => (ICON_SVG[name] || '').replace('<svg', '<svg class="ico" aria-hidden="true"');
const ICONS = {
  dashboard: fa('dashboard'),
  structure: fa('structure'),
  students: fa('students'),
  teachers: fa('teachers'),
  classes: fa('classes'),
  attendance: fa('attendance'),
  grades: fa('grades'),
  plus: fa('plus'),
  search: fa('search'),
  eye: fa('eye'),
  check: fa('check'),
  print: fa('print')
};

function hydrateStaticIcons() {
  document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = fa(el.dataset.icon); });
}

function emptyState(texto) {
  return `<div class="empty-state">${texto}</div>`;
}

// ==========================================================================
// FUNCIONES UTILITARIAS Y CALCULOS DE NEGOCIO
// ==========================================================================

function getPromocion(id) {
  return store.promociones.find(p => p.id === id) || { nombre: 'Sin asignar', codigo: '-' };
}

function getPeriodo(id) {
  return store.periodos.find(p => p.id === id) || { nombre: 'Sin periodo', modalidad: '-' };
}

function getMateria(id) {
  return store.materias.find(m => m.id === id) || { nombre: 'Sin materia', codigo: '-' };
}

function getCatedratico(id) {
  return store.catedraticos.find(c => c.id === id) || { nombres: 'Sin', apellidos: 'Asignar', grado: '', condicion: 'CIVIL' };
}

function getEstudiante(id) {
  return store.estudiantes.find(e => e.id === id);
}

function formatNombreConGrado(persona) {
  if (!persona) return 'No asignado';
  if (persona.condicion === 'MILITAR' && persona.grado && !persona.grado.startsWith('N/A')) {
    return `${persona.grado} ${persona.nombres} ${persona.apellidos}`;
  }
  return `${persona.nombres} ${persona.apellidos}`;
}

function calcularNotaFinal(cal) {
  if (!cal) return 0;
  const p1 = Number(cal.parcial1) || 0;
  const p2 = Number(cal.parcial2) || 0;
  const p3 = Number(cal.parcial3) || 0;
  const ac = Number(cal.acumulativo) || 0;
  return Math.round(((p1 + p2 + p3 + ac) / 4) * 10) / 10;
}

function obtenerCalificacion(claseId, estudianteId) {
  let rec = store.calificaciones.find(c => c.claseId === claseId && c.estudianteId === estudianteId);
  if (!rec) {
    rec = { claseId, estudianteId, parcial1: 0, parcial2: 0, parcial3: 0, acumulativo: 0 };
    store.calificaciones.push(rec);
  }
  return rec;
}

function calcularPorcentajeAsistencia(claseId, estudianteId) {
  const sesiones = store.asistencias.filter(a => a.claseId === claseId);
  if (sesiones.length === 0) return 100;
  let asistidas = 0;
  sesiones.forEach(s => {
    const reg = s.registros.find(r => r.estudianteId === estudianteId);
    if (!reg || reg.estado === 'PRESENTE' || reg.estado === 'EXCUSA') {
      asistidas += 1;
    } else if (reg.estado === 'TARDANZA') {
      asistidas += 0.5;
    }
  });
  return Math.round((asistidas / sesiones.length) * 100);
}

function showToast(mensaje) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = mensaje;
  container.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 3200);
}

// ==========================================================================
// AUTENTICACION Y CAMBIO DE PERFIL
// ==========================================================================

function selectLoginRole(role) {
  appState.currentRole = role;
  document.querySelectorAll('.role-card-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.role === role);
  });
}

function handleLoginSubmit(e) {
  e.preventDefault();
  if (sesionReal.activa) return;
  appState.authenticated = true;
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app-shell').classList.remove('hidden');

  if (appState.currentRole === 'ESTUDIANTE') {
    appState.currentView = 'boletin';
  } else {
    appState.currentView = 'dashboard';
  }

  renderSidebarAndHeader();
  renderMainView();
  showToast('Sesión iniciada');
}

function handleLogout() {
  if (sesionReal.activa) {
    cerrarSesionReal();
    return;
  }
  appState.authenticated = false;
  document.getElementById('app-shell').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
}

function switchActiveRole(role) {
  // Con sesion real el rol lo decide el servidor.
  if (sesionReal.activa) return;
  appState.currentRole = role;
  if (role === 'ESTUDIANTE' && ['estructura', 'catedraticos'].includes(appState.currentView)) {
    appState.currentView = 'boletin';
  }
  renderSidebarAndHeader();
  renderMainView();
  showToast(`Vista cambiada a perfil: ${role}`);
}

function toggleMobileSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebar-overlay').classList.toggle('open');
}

function closeMobileSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('open');
}

function navigateTo(view) {
  appState.currentView = view;
  closeMobileSidebar();
  renderSidebarAndHeader();
  renderMainView();
}

// ==========================================================================
// RENDERIZADO DE NAVEGACION Y CABECERA
// ==========================================================================

function renderSidebarAndHeader() {
  const navContainer = document.getElementById('sidebar-nav');
  const role = appState.currentRole;

  const menuItems = [
    { id: 'dashboard', label: 'Panel General', icon: ICONS.dashboard, roles: ['ADMIN', 'CATEDRATICO', 'ESTUDIANTE'], section: 'Principal' },
    { id: 'estructura', label: 'Periodos y Promociones', icon: ICONS.structure, roles: ['ADMIN'], section: 'Gestión Académica' },
    { id: 'clases', label: 'Carga Académica y Clases', icon: ICONS.classes, roles: ['ADMIN', 'CATEDRATICO', 'ESTUDIANTE'], section: 'Gestión Académica' },
    { id: 'estudiantes', label: 'Expedientes de Alumnos', icon: ICONS.students, roles: ['ADMIN', 'CATEDRATICO'], section: 'Directorio Institucional' },
    { id: 'catedraticos', label: 'Catedráticos', icon: ICONS.teachers, roles: ['ADMIN'], section: 'Directorio Institucional' },
    { id: 'asistencia', label: 'Control de Asistencia', icon: ICONS.attendance, roles: ['ADMIN', 'CATEDRATICO', 'ESTUDIANTE'], section: 'Evaluación y Control' },
    { id: 'calificaciones', label: 'Libro de Calificaciones', icon: ICONS.grades, roles: ['ADMIN', 'CATEDRATICO'], section: 'Evaluación y Control' },
    { id: 'boletin', label: 'Boletín y Expediente', icon: ICONS.grades, roles: ['ADMIN', 'CATEDRATICO', 'ESTUDIANTE'], section: 'Evaluación y Control' },
    { id: 'integraciones', label: 'Otras Plataformas', icon: ICONS.structure, roles: ['ADMIN', 'CATEDRATICO', 'ESTUDIANTE'], section: 'Formación Externa' }
  ];

  const allowed = menuItems.filter(item => item.roles.includes(role));
  let html = '';
  let lastSection = '';

  allowed.forEach(item => {
    if (item.section !== lastSection) {
      html += `<div class="nav-section-label">${esc(item.section)}</div>`;
      lastSection = item.section;
    }
    const activeClass = appState.currentView === item.id ? 'active' : '';
    html += `
      <button class="nav-item ${activeClass}" data-on-click="navigateTo('${esc(item.id)}')">
        ${item.icon}
        <span>${esc(item.label)}</span>
      </button>
    `;
  });

  navContainer.innerHTML = html;

  // Perfil inferior en Sidebar
  const profileName = document.getElementById('sidebar-user-name');
  const profileRole = document.getElementById('sidebar-user-role');
  const profileAvatar = document.getElementById('sidebar-user-avatar');

  if (sesionReal.activa) {
    const etiquetas = { ADMIN: 'Personal Administrativo', CATEDRATICO: 'Catedrático', ESTUDIANTE: 'Estudiante' };
    const nombre = sesionReal.nombre || sesionReal.correo || 'Usuario';
    profileName.textContent = nombre;
    profileRole.textContent = etiquetas[role] || '';
    profileAvatar.textContent = nombre.slice(0, 2).toUpperCase();
  } else if (role === 'ADMIN') {
    profileName.textContent = 'Jefatura de Estudios';
    profileRole.textContent = 'Personal Administrativo';
    profileAvatar.textContent = 'JE';
  } else if (role === 'CATEDRATICO') {
    const cat = getCatedratico(appState.selectedCatedraticoId);
    profileName.textContent = formatNombreConGrado(cat);
    profileRole.textContent = 'Catedrático';
    profileAvatar.textContent = 'CT';
  } else {
    const est = getEstudiante(appState.selectedEstudianteId);
    profileName.textContent = formatNombreConGrado(est);
    profileRole.textContent = `Cód. ${est ? est.codigoAlumno : ''}`;
    profileAvatar.textContent = 'AL';
  }

  // Botones de cambio rapido de rol en la barra superior
  document.querySelectorAll('#role-quick-switch button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.role === role);
  });
}

// ==========================================================================
// ENRUTADOR DE VISTAS PRINCIPALES
// ==========================================================================

function renderMainView() {
  const container = document.getElementById('content-area');
  const titleEl = document.getElementById('topbar-title');
  const subtitleEl = document.getElementById('topbar-subtitle');

  switch (appState.currentView) {
    case 'dashboard':
      titleEl.textContent = 'Panel';
      subtitleEl.textContent = '';
      container.innerHTML = renderDashboardView();
      break;
    case 'estructura':
      titleEl.textContent = 'Periodos y promociones';
      subtitleEl.textContent = '';
      container.innerHTML = renderEstructuraView();
      break;
    case 'estudiantes':
      titleEl.textContent = 'Estudiantes';
      subtitleEl.textContent = '';
      container.innerHTML = renderEstudiantesView();
      break;
    case 'catedraticos':
      titleEl.textContent = 'Catedráticos';
      subtitleEl.textContent = '';
      container.innerHTML = renderCatedraticosView();
      break;
    case 'clases':
      titleEl.textContent = 'Clases';
      subtitleEl.textContent = '';
      container.innerHTML = renderClasesView();
      break;
    case 'asistencia':
      titleEl.textContent = 'Asistencia';
      subtitleEl.textContent = '';
      container.innerHTML = renderAsistenciaView();
      break;
    case 'calificaciones':
      titleEl.textContent = 'Calificaciones';
      subtitleEl.textContent = '';
      container.innerHTML = renderCalificacionesView();
      break;
    case 'boletin':
      titleEl.textContent = 'Boletín';
      subtitleEl.textContent = '';
      container.innerHTML = renderBoletinView();
      break;
    case 'integraciones':
      titleEl.textContent = 'Otras plataformas';
      subtitleEl.textContent = 'Moodle · INFOP';
      container.innerHTML = renderIntegracionesView();
      pintarIntegraciones();
      break;
    default:
      container.innerHTML = renderDashboardView();
  }
}

// ==========================================================================
// VISTA 1: PANEL DE CONTROL (DASHBOARD)
// ==========================================================================

function renderDashboardView() {
  const totalEstudiantes = store.estudiantes.length;
  const totalPromociones = store.promociones.length;
  const totalCatedraticos = store.catedraticos.length;

  // Calcular tasa de aprobacion global (>= 70%)
  let aprobadas = 0;
  store.calificaciones.forEach(c => {
    if (calcularNotaFinal(c) >= 70) aprobadas++;
  });
  const tasaAprobacion = store.calificaciones.length > 0
    ? Math.round((aprobadas / store.calificaciones.length) * 100)
    : null;

  const clasesRows = store.clases.map(cls => {
    const mat = getMateria(cls.materiaId);
    const prom = getPromocion(cls.promocionId);
    const per = getPeriodo(cls.periodoId);
    const cat = getCatedratico(cls.catedraticoId);
    const alumnosSeccion = store.estudiantes.filter(e => e.promocionId === cls.promocionId).length;

    return `
      <tr>
        <td><strong>${esc(cls.codigoClase)}</strong></td>
        <td>${esc(mat.nombre)}</td>
        <td><span class="badge badge-choco">${esc(prom.codigo)}</span></td>
        <td><span class="badge badge-neutral">${esc(per.modalidad)}</span></td>
        <td>${esc(formatNombreConGrado(cat))}</td>
        <td>${alumnosSeccion} alumnos</td>
        <td>
          <button class="btn btn-outline btn-sm" data-on-click="irACalificacionesDeClase('${esc(cls.id)}')">Notas</button>
          <button class="btn btn-primary btn-sm" data-on-click="irAAsistenciaDeClase('${esc(cls.id)}')">Asistencia</button>
        </td>
      </tr>
    `;
  }).join('');

  return `
    <div class="stats-grid">
      <div class="stat-card accent-olive">
        <div class="stat-card-info">
          <span>Estudiantes</span>
          <h3>${totalEstudiantes}</h3>
          <small>Organizados en ${totalPromociones} promociones</small>
        </div>
        <div class="stat-icon-box">${ICONS.students}</div>
      </div>

      <div class="stat-card accent-choco">
        <div class="stat-card-info">
          <span>Promociones</span>
          <h3>${totalPromociones}</h3>
          <small>4 modalidades lectivas habilitadas</small>
        </div>
        <div class="stat-icon-box">${ICONS.structure}</div>
      </div>

      <div class="stat-card accent-olive">
        <div class="stat-card-info">
          <span>Catedráticos</span>
          <h3>${totalCatedraticos}</h3>
          <small>${store.clases.length} clases asignadas activas</small>
        </div>
        <div class="stat-icon-box">${ICONS.teachers}</div>
      </div>

      <div class="stat-card accent-rust">
        <div class="stat-card-info">
          <span>Aprobación</span>
          <h3>${tasaAprobacion === null ? '—' : tasaAprobacion + '%'}</h3>
          <small>Mínimo aprobatorio: 70% sobre 100%</small>
        </div>
        <div class="stat-icon-box">${ICONS.grades}</div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header">
        <div class="panel-title">
          <h2>Clases activas</h2>
          <p>Cada clase cuenta con 1 catedrático titular</p>
        </div>
        <div style="display:flex; gap:8px;">
          ${appState.currentRole === 'ADMIN' ? `<button class="btn btn-primary" data-on-click="openModalNuevaClase()">${ICONS.plus} Nueva clase</button>` : ''}
        </div>
      </div>
      <div class="panel-body" style="padding:0;">
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Materia / Asignatura</th>
                <th>Promoción</th>
                <th>Modalidad</th>
                <th>Catedrático</th>
                <th>Matrícula</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${clasesRows}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function irACalificacionesDeClase(claseId) {
  appState.filters.notasClaseId = claseId;
  navigateTo('calificaciones');
}

function irAAsistenciaDeClase(claseId) {
  appState.filters.asistenciaClaseId = claseId;
  navigateTo('asistencia');
}

// ==========================================================================
// VISTA 2: ESTRUCTURA ACADEMICA (4 MODALIDADES DE PERIODO Y PROMOCIONES)
// ==========================================================================

function renderEstructuraView() {
  const periodosRows = store.periodos.map(p => `
    <tr>
      <td><strong>${esc(p.codigo)}</strong></td>
      <td>${esc(p.nombre)}</td>
      <td><span class="badge badge-olive">${esc(p.modalidad)}</span></td>
      <td>${esc(p.fechaInicio)}</td>
      <td>${esc(p.fechaFin)}</td>
      <td><span class="badge badge-choco">${p.activo ? 'ACTIVO' : 'CERRADO'}</span></td>
    </tr>
  `).join('');

  const promocionesCards = store.promociones.map(prom => {
    const totalAlumnos = store.estudiantes.filter(e => e.promocionId === prom.id).length;

    return `
      <div class="entity-card">
        <div>
          <div class="entity-card-header">
            <div>
              <span class="badge badge-choco" style="margin-bottom:6px;">${esc(prom.codigo)}</span>
              <h3>${esc(prom.nombre)}</h3>
            </div>
            <span class="badge badge-olive">${esc(prom.anioIngreso)} - ${esc(prom.anioEgreso)}</span>
          </div>
          <p style="font-size:var(--fs-sm); color:var(--piedra);">
            Estudiantes inscritos en la promoción: <strong>${totalAlumnos} alumnos</strong>
          </p>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="panel">
      <div class="panel-header">
        <div class="panel-title">
          <h2>Periodos lectivos</h2>
          <p>Soporte simultáneo para periodos Semestrales, Cuatrimestrales, Modulares y Anuales</p>
        </div>
        <button class="btn btn-primary" data-on-click="openModalNuevoPeriodo()">${ICONS.plus} Nuevo periodo</button>
      </div>
      <div class="panel-body" style="padding:0;">
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Nombre del Periodo</th>
                <th>Modalidad</th>
                <th>Fecha de Inicio</th>
                <th>Fecha de Cierre</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              ${periodosRows}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header">
        <div class="panel-title">
          <h2>Promociones</h2>
          
        </div>
        <button class="btn btn-choco" data-on-click="openModalNuevaPromocion()">${ICONS.plus} Nueva Promoción</button>
      </div>
      <div class="panel-body">
        <div class="cards-grid">
          ${promocionesCards}
        </div>
      </div>
    </div>
  `;
}

// ==========================================================================
// VISTA 3: EXPEDIENTES DE ESTUDIANTES
// ==========================================================================

function renderEstudiantesView() {
  const search = appState.filters.estudianteSearch.toLowerCase();
  const promFilter = appState.filters.estudiantePromocion;

  const filtered = store.estudiantes.filter(e => {
    const matchSearch =
      e.codigoAlumno.toLowerCase().includes(search) ||
      e.dni.toLowerCase().includes(search) ||
      `${e.nombres} ${e.apellidos}`.toLowerCase().includes(search) ||
      (e.grado || '').toLowerCase().includes(search);
    const matchProm = promFilter === 'ALL' || e.promocionId === promFilter;
    return matchSearch && matchProm;
  });

  const rows = filtered.map(est => {
    const prom = getPromocion(est.promocionId);
    const badgeCondicion = est.condicion === 'MILITAR'
      ? `<span class="badge badge-olive">${esc(est.grado)}</span>`
      : `<span class="badge badge-neutral">Civil</span>`;

    return `
      <tr>
        <td><strong style="color:var(--texto); font-family:monospace; font-size:var(--fs-sm);">${esc(est.codigoAlumno)}</strong></td>
        <td>${esc(est.dni)}</td>
        <td>
          <strong style="display:block;">${esc(est.apellidos)}, ${esc(est.nombres)}</strong>
          <small style="color:var(--piedra);">${esc(est.correo)}</small>
        </td>
        <td>${badgeCondicion}</td>
        <td><span class="badge badge-choco">${esc(prom.codigo)}</span></td>
        <td>${esc(est.telefono)}</td>
        <td>
          <button class="btn btn-outline btn-sm" data-on-click="verExpedienteEstudiante('${esc(est.id)}')">${ICONS.eye} Expediente</button>
          <button class="btn btn-primary btn-sm" data-on-click="verBoletinDeEstudiante('${esc(est.id)}')">Boletín</button>
        </td>
      </tr>
    `;
  }).join('');

  return `
    <div class="panel">
      <div class="panel-header">
        <div class="panel-title">
          <h2>Expedientes</h2>
          <p>Identificación por Código de Alumno (FFAA), DNI, Grado Militar y Promoción asignada</p>
        </div>
        ${appState.currentRole === 'ADMIN' ? `<button class="btn btn-primary" data-on-click="openModalNuevoEstudiante()">${ICONS.plus} Nuevo estudiante</button>` : ''}
      </div>
      <div class="panel-body">
        <div class="toolbar">
          <div class="toolbar-filters">
            <div class="search-input-wrap">
              ${ICONS.search}
              <input type="text" class="form-control"
                value="${esc(appState.filters.estudianteSearch)}"
                data-on-input="updateEstudianteFilter('estudianteSearch', this.value)">
            </div>
            <select class="form-control" style="width:auto;" data-on-change="updateEstudianteFilter('estudiantePromocion', this.value)">
              <option value="ALL">Todas las Promociones</option>
              ${store.promociones.map(p => `<option value="${esc(p.id)}" ${promFilter === p.id ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>DNI</th>
                <th>Apellidos y Nombres</th>
                <th>Grado / Condición</th>
                <th>Promoción</th>
                <th>Teléfono</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${rows || `<tr><td colspan="7" style="text-align:center; padding:24px;">No se encontraron estudiantes con los filtros seleccionados.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

const FILTROS_PERMITIDOS = ['clasePromocion', 'claseModalidad', 'asistenciaClaseId', 'asistenciaFecha', 'notasClaseId', 'boletinEstudianteId'];

function actualizarFiltro(clave, valor) {
  if (!FILTROS_PERMITIDOS.includes(clave)) return;
  appState.filters[clave] = valor;
  renderMainView();
}

function filtrarCatedraticos(valor) {
  appState.filters.catedraticoSearch = valor;
  renderMainView();
}

function confirmarActaCalificaciones() {
  saveStore(store);
  showToast('Calificaciones registradas en el acta oficial');
}

function imprimirPagina() {
  window.print();
}

function updateEstudianteFilter(key, val) {
  appState.filters[key] = val;
  renderMainView();
}

function verBoletinDeEstudiante(estudianteId) {
  appState.filters.boletinEstudianteId = estudianteId;
  navigateTo('boletin');
}

// ==========================================================================
// VISTA 4: PLANTA DE CATEDRATICOS
// ==========================================================================

function renderCatedraticosView() {
  const search = appState.filters.catedraticoSearch.toLowerCase();

  const filtered = store.catedraticos.filter(c =>
    c.dni.toLowerCase().includes(search) ||
    `${c.nombres} ${c.apellidos}`.toLowerCase().includes(search) ||
    c.titulo.toLowerCase().includes(search) ||
    (c.grado || '').toLowerCase().includes(search)
  );

  const rows = filtered.map(cat => {
    const clasesImpartidas = store.clases.filter(cl => cl.catedraticoId === cat.id);
    const gradoBadge = cat.condicion === 'MILITAR'
      ? `<span class="badge badge-olive">${esc(cat.grado)}</span>`
      : `<span class="badge badge-neutral">Catedrático Civil</span>`;

    const resumenClases = clasesImpartidas.map(cl => {
      const m = getMateria(cl.materiaId);
      const p = getPromocion(cl.promocionId);
      return `<div style="font-size:var(--fs-sm); margin-bottom:3px;">• <strong>${esc(m.codigo)}</strong> (${esc(p.codigo)})</div>`;
    }).join('') || '<span style="color:var(--piedra); font-size:var(--fs-sm);">Sin clases asignadas</span>';

    return `
      <tr>
        <td>
          <strong style="display:block; color:var(--texto);">${esc(cat.apellidos)}, ${esc(cat.nombres)}</strong>
          <small style="color:var(--piedra);">${esc(cat.correo)} | Tel: ${esc(cat.telefono)}</small>
        </td>
        <td>${esc(cat.dni)}</td>
        <td>${gradoBadge}</td>
        <td>${esc(cat.titulo)}</td>
        <td>${resumenClases}</td>
      </tr>
    `;
  }).join('');

  return `
    <div class="panel">
      <div class="panel-header">
        <div class="panel-title">
          <h2>Directorio</h2>
          <p>Registro oficial con Nombre, DNI, Título Académico y Grado Militar (en caso de ser militar)</p>
        </div>
        <button class="btn btn-primary" data-on-click="openModalNuevoCatedratico()">${ICONS.plus} Nuevo catedrático</button>
      </div>
      <div class="panel-body">
        <div class="toolbar">
          <div class="search-input-wrap">
            ${ICONS.search}
            <input type="text" class="form-control"
              value="${esc(appState.filters.catedraticoSearch)}"
              data-on-input="filtrarCatedraticos(this.value)">
          </div>
        </div>

        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Nombre del Catedrático</th>
                <th>DNI</th>
                <th>Condición / Grado</th>
                <th>Título Académico</th>
                <th>Clases</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

// ==========================================================================
// VISTA 5: CARGA ACADEMICA Y ASIGNACION DE CLASES
// ==========================================================================

function renderClasesView() {
  const promFilter = appState.filters.clasePromocion;
  const modFilter = appState.filters.claseModalidad;

  const filtered = store.clases.filter(cl => {
    const per = getPeriodo(cl.periodoId);
    const matchProm = promFilter === 'ALL' || cl.promocionId === promFilter;
    const matchMod = modFilter === 'ALL' || per.modalidad === modFilter;
    return matchProm && matchMod;
  });

  const rows = filtered.map(cl => {
    const per = getPeriodo(cl.periodoId);
    const prom = getPromocion(cl.promocionId);
    const mat = getMateria(cl.materiaId);
    const cat = getCatedratico(cl.catedraticoId);

    return `
      <tr>
        <td><strong>${esc(cl.codigoClase)}</strong></td>
        <td>
          <strong style="display:block; color:var(--texto);">${esc(mat.nombre)}</strong>
          <small style="color:var(--piedra);">Código: ${esc(mat.codigo)} | ${esc(mat.uv)} UV</small>
        </td>
        <td>
          <span class="badge badge-choco">${esc(prom.codigo)}</span>
        </td>
        <td>
          <span class="badge badge-olive">${esc(per.modalidad)}</span>
          <small style="display:block; color:var(--piedra); margin-top:2px;">${esc(per.nombre)}</small>
        </td>
        <td>
          <strong style="display:block;">${esc(formatNombreConGrado(cat))}</strong>
          <small style="color:var(--piedra);">${esc(cat.titulo)}</small>
        </td>
        <td>
          <span style="display:block; font-size:var(--fs-sm);">${esc(cl.horario)}</span>
          <small style="color:var(--piedra);">${esc(cl.aula)}</small>
        </td>
        <td>
          <button class="btn btn-outline btn-sm" data-on-click="irAAsistenciaDeClase('${esc(cl.id)}')">Asistencia</button>
          ${appState.currentRole !== 'ESTUDIANTE' ? `<button class="btn btn-primary btn-sm" data-on-click="irACalificacionesDeClase('${esc(cl.id)}')">Calificar</button>` : ''}
        </td>
      </tr>
    `;
  }).join('');

  return `
    <div class="panel">
      <div class="panel-header">
        <div class="panel-title">
          <h2>Asignaciones</h2>
          <p>Un catedrático titular por clase</p>
        </div>
        ${appState.currentRole === 'ADMIN' ? `
          <div style="display:flex; gap:8px;">
            <button class="btn btn-outline" data-on-click="openModalNuevaMateria()">${ICONS.plus} Nueva Materia</button>
            <button class="btn btn-primary" data-on-click="openModalNuevaClase()">${ICONS.plus} Nueva clase</button>
          </div>
        ` : ''}
      </div>
      <div class="panel-body">
        <div class="toolbar">
          <div class="toolbar-filters">
            <select class="form-control" style="width:auto;" data-on-change="actualizarFiltro('clasePromocion', this.value)">
              <option value="ALL">Todas las Promociones</option>
              ${store.promociones.map(p => `<option value="${esc(p.id)}" ${promFilter === p.id ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')}
            </select>
            <select class="form-control" style="width:auto;" data-on-change="actualizarFiltro('claseModalidad', this.value)">
              <option value="ALL">Todas las Modalidades de Periodo</option>
              ${MODALIDADES_PERIODO.map(m => `<option value="${esc(m.codigo)}" ${modFilter === m.codigo ? 'selected' : ''}>${esc(m.etiqueta)}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Código Clase</th>
                <th>Materia</th>
                <th>Promoción</th>
                <th>Periodo / Modalidad</th>
                <th>Catedrático (1 por Clase)</th>
                <th>Horario y Aula</th>
                <th>Gestión</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

// ==========================================================================
// VISTA 6: CONTROL DE ASISTENCIA POR CLASE
// ==========================================================================

function renderAsistenciaView() {
  if (!store.clases.length) return emptyState('Aún no hay clases registradas.');
  const claseId = appState.filters.asistenciaClaseId || store.clases[0]?.id;
  const fecha = appState.filters.asistenciaFecha;
  const claseActual = store.clases.find(c => c.id === claseId) || store.clases[0];

  const mat = getMateria(claseActual.materiaId);
  const prom = getPromocion(claseActual.promocionId);
  const cat = getCatedratico(claseActual.catedraticoId);

  const alumnosSeccion = store.estudiantes.filter(e => e.promocionId === claseActual.promocionId);

  // Buscar o inicializar sesion de asistencia para esa clase y fecha
  let sesion = store.asistencias.find(a => a.claseId === claseActual.id && a.fecha === fecha);
  if (!sesion) {
    sesion = {
      id: 'asis-' + Date.now(),
      claseId: claseActual.id,
      fecha,
      tema: 'Sesión ordinaria de clase',
      registros: alumnosSeccion.map(al => ({ estudianteId: al.id, estado: 'PRESENTE', observacion: '' }))
    };
    store.asistencias.push(sesion);
    saveStore(store);
  }

  const rows = alumnosSeccion.map(est => {
    let reg = sesion.registros.find(r => r.estudianteId === est.id);
    if (!reg) {
      reg = { estudianteId: est.id, estado: 'PRESENTE', observacion: '' };
      sesion.registros.push(reg);
    }
    const pctHistorico = calcularPorcentajeAsistencia(claseActual.id, est.id);
    const readOnly = appState.currentRole === 'ESTUDIANTE';

    return `
      <tr>
        <td><strong style="font-family:monospace;">${esc(est.codigoAlumno)}</strong></td>
        <td>
          <strong>${esc(est.apellidos)}, ${esc(est.nombres)}</strong>
          <small style="display:block; color:var(--piedra);">${esc(est.condicion === 'MILITAR' ? est.grado : 'Civil')}</small>
        </td>
        <td>
          <div class="attendance-group">
            ${['PRESENTE', 'AUSENTE', 'TARDANZA', 'EXCUSA'].map(st => `
              <button type="button" class="att-btn ${reg.estado === st ? 'active-' + st : ''}"
                ${readOnly ? 'disabled' : ''}
                data-on-click="setEstadoAsistencia('${esc(sesion.id)}', '${esc(est.id)}', '${st}')">
                ${st}
              </button>
            `).join('')}
          </div>
        </td>
        <td>
          <input type="text" class="form-control"
            value="${esc(reg.observacion)}"
            ${readOnly ? 'disabled' : ''}
            data-on-change="setObservacionAsistencia('${esc(sesion.id)}', '${esc(est.id)}', this.value)">
        </td>
        <td>
          <span class="badge ${pctHistorico >= 80 ? 'badge-olive' : 'badge-rust'}">${pctHistorico}%</span>
        </td>
      </tr>
    `;
  }).join('');

  return `
    <div class="panel">
      <div class="panel-header">
        <div class="panel-title">
          <h2>Registro de asistencia</h2>
          <p>Catedrático titular: <strong>${esc(formatNombreConGrado(cat))}</strong> | ${esc(prom.nombre)}</p>
        </div>
        ${appState.currentRole !== 'ESTUDIANTE' ? `
          <div style="display:flex; gap:8px;">
            <button class="btn btn-outline" data-on-click="marcarTodosPresentes('${esc(sesion.id)}')">${ICONS.check} Todos presentes</button>
            <button class="btn btn-primary" data-on-click="guardarSesionAsistencia()">Guardar</button>
          </div>
        ` : ''}
      </div>
      <div class="panel-body">
        <div class="form-grid-3" style="margin-bottom:18px; background:var(--beige-suave); padding:14px; border-radius:var(--radius); border:1px solid var(--linea);">
          <div>
            <label class="form-label">Clase</label>
            <select class="form-control" data-on-change="actualizarFiltro('asistenciaClaseId', this.value)">
              ${store.clases.map(cl => {
                const m = getMateria(cl.materiaId);
                const p = getPromocion(cl.promocionId);
                return `<option value="${esc(cl.id)}" ${cl.id === claseActual.id ? 'selected' : ''}>${esc(cl.codigoClase)} - ${esc(m.nombre)} (${esc(p.codigo)})</option>`;
              }).join('')}
            </select>
          </div>
          <div>
            <label class="form-label">Fecha</label>
            <input type="date" class="form-control" value="${esc(fecha)}"
              data-on-change="actualizarFiltro('asistenciaFecha', this.value)">
          </div>
          <div>
            <label class="form-label">Tema</label>
            <input type="text" class="form-control" value="${esc(sesion.tema)}"
              ${appState.currentRole === 'ESTUDIANTE' ? 'disabled' : ''}
              data-on-change="actualizarTemaAsistencia('${esc(sesion.id)}', this.value)">
          </div>
        </div>

        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Estudiante / Grado</th>
                <th>Estado</th>
                <th>Observaciones</th>
                <th>Asistencia</th>
              </tr>
            </thead>
            <tbody>
              ${rows || `<tr><td colspan="5" style="text-align:center; padding:20px;">No hay estudiantes en esta promoción.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function setEstadoAsistencia(sesionId, estudianteId, estado) {
  const sesion = store.asistencias.find(s => s.id === sesionId);
  if (!sesion) return;
  const reg = sesion.registros.find(r => r.estudianteId === estudianteId);
  if (reg) {
    reg.estado = estado;
    saveStore(store);
    renderMainView();
  }
}

function setObservacionAsistencia(sesionId, estudianteId, texto) {
  const sesion = store.asistencias.find(s => s.id === sesionId);
  if (!sesion) return;
  const reg = sesion.registros.find(r => r.estudianteId === estudianteId);
  if (reg) {
    reg.observacion = texto;
    saveStore(store);
  }
}

function actualizarTemaAsistencia(sesionId, tema) {
  const sesion = store.asistencias.find(s => s.id === sesionId);
  if (sesion) {
    sesion.tema = tema;
    saveStore(store);
  }
}

function marcarTodosPresentes(sesionId) {
  const sesion = store.asistencias.find(s => s.id === sesionId);
  if (!sesion) return;
  sesion.registros.forEach(r => { r.estado = 'PRESENTE'; });
  saveStore(store);
  renderMainView();
  showToast('Todos los alumnos marcados como presentes');
}

function guardarSesionAsistencia() {
  saveStore(store);
  showToast('Acta de asistencia de clase guardada correctamente');
}

// ==========================================================================
// VISTA 7: LIBRO DE CALIFICACIONES (0% - 100%, APROBACION >= 70%)
// ==========================================================================

function renderCalificacionesView() {
  if (!store.clases.length) return emptyState('Aún no hay clases registradas.');
  const claseId = appState.filters.notasClaseId || store.clases[0]?.id;
  const claseActual = store.clases.find(c => c.id === claseId) || store.clases[0];

  const mat = getMateria(claseActual.materiaId);
  const prom = getPromocion(claseActual.promocionId);
  const cat = getCatedratico(claseActual.catedraticoId);

  const alumnosSeccion = store.estudiantes.filter(e => e.promocionId === claseActual.promocionId);

  const rows = alumnosSeccion.map(est => {
    const cal = obtenerCalificacion(claseActual.id, est.id);
    const notaFinal = calcularNotaFinal(cal);
    const aprobado = notaFinal >= 70;

    return `
      <tr>
        <td><strong style="font-family:monospace;">${esc(est.codigoAlumno)}</strong></td>
        <td>
          <strong>${esc(est.apellidos)}, ${esc(est.nombres)}</strong>
          <small style="display:block; color:var(--piedra);">${esc(est.condicion === 'MILITAR' ? est.grado : 'Civil')}</small>
        </td>
        <td>
          <input type="number" min="0" max="100" class="grade-input" value="${esc(cal.parcial1)}"
            data-on-change="actualizarNota('${esc(claseActual.id)}', '${esc(est.id)}', 'parcial1', this.value)"> %
        </td>
        <td>
          <input type="number" min="0" max="100" class="grade-input" value="${esc(cal.parcial2)}"
            data-on-change="actualizarNota('${esc(claseActual.id)}', '${esc(est.id)}', 'parcial2', this.value)"> %
        </td>
        <td>
          <input type="number" min="0" max="100" class="grade-input" value="${esc(cal.parcial3)}"
            data-on-change="actualizarNota('${esc(claseActual.id)}', '${esc(est.id)}', 'parcial3', this.value)"> %
        </td>
        <td>
          <input type="number" min="0" max="100" class="grade-input" value="${esc(cal.acumulativo)}"
            data-on-change="actualizarNota('${esc(claseActual.id)}', '${esc(est.id)}', 'acumulativo', this.value)"> %
        </td>
        <td>
          <strong style="font-size:var(--fs-base); color:var(--texto);">${notaFinal}%</strong>
        </td>
        <td>
          <span class="badge ${aprobado ? 'badge-olive' : 'badge-rust'}">
            ${aprobado ? 'Aprobado' : 'Reprobado'}
          </span>
        </td>
      </tr>
    `;
  }).join('');

  return `
    <div class="panel">
      <div class="panel-header">
        <div class="panel-title">
          <h2>Libro de notas</h2>
          <p>Escala de 0% a 100% | Nota mínima aprobatoria: <strong>70%</strong> | Catedrático: <strong>${esc(formatNombreConGrado(cat))}</strong></p>
        </div>
        <button class="btn btn-primary" data-on-click="confirmarActaCalificaciones()">
          ${ICONS.check} Guardar
        </button>
      </div>
      <div class="panel-body">
        <div class="toolbar">
          <div class="toolbar-filters">
            <label class="form-label" style="margin-bottom:0;">Clase:</label>
            <select class="form-control" style="max-width:460px;" data-on-change="actualizarFiltro('notasClaseId', this.value)">
              ${store.clases.map(cl => {
                const m = getMateria(cl.materiaId);
                const p = getPromocion(cl.promocionId);
                return `<option value="${esc(cl.id)}" ${cl.id === claseActual.id ? 'selected' : ''}>${esc(cl.codigoClase)} — ${esc(m.nombre)} (${esc(p.codigo)})</option>`;
              }).join('')}
            </select>
          </div>
        </div>

        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Alumno / Grado</th>
                <th>I Parcial</th>
                <th>II Parcial</th>
                <th>III Parcial</th>
                <th>Acumulativo</th>
                <th>Final</th>
                <th>Resultado</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function actualizarNota(claseId, estudianteId, campo, valor) {
  let num = Number(valor);
  if (isNaN(num) || num < 0) num = 0;
  if (num > 100) num = 100;

  const cal = obtenerCalificacion(claseId, estudianteId);
  cal[campo] = num;
  saveStore(store);
  renderMainView();
}

// ==========================================================================
// VISTA 8: BOLETIN OFICIAL DE CALIFICACIONES Y EXPEDIENTE DEL ALUMNO
// ==========================================================================

function renderBoletinView() {
  if (!store.estudiantes.length) return emptyState('Aún no hay estudiantes registrados.');
  const estId = appState.currentRole === 'ESTUDIANTE'
    ? appState.selectedEstudianteId
    : (appState.filters.boletinEstudianteId || store.estudiantes[0]?.id);

  const est = getEstudiante(estId) || store.estudiantes[0];
  const prom = getPromocion(est.promocionId);

  const clasesAlumno = store.clases.filter(cl => cl.promocionId === est.promocionId);

  let sumaNotas = 0;
  const filasMaterias = clasesAlumno.map(cl => {
    const mat = getMateria(cl.materiaId);
    const cat = getCatedratico(cl.catedraticoId);
    const per = getPeriodo(cl.periodoId);
    const cal = obtenerCalificacion(cl.id, est.id);
    const final = calcularNotaFinal(cal);
    sumaNotas += final;
    const aprobado = final >= 70;
    const pctAsis = calcularPorcentajeAsistencia(cl.id, est.id);

    return `
      <tr>
        <td><strong>${esc(mat.codigo)}</strong></td>
        <td>
          <strong>${esc(mat.nombre)}</strong>
          <small style="display:block; color:var(--piedra);">${esc(per.nombre)} (${esc(per.modalidad)})</small>
        </td>
        <td>${esc(formatNombreConGrado(cat))}</td>
        <td>${esc(cal.parcial1)}%</td>
        <td>${esc(cal.parcial2)}%</td>
        <td>${esc(cal.parcial3)}%</td>
        <td>${esc(cal.acumulativo)}%</td>
        <td><strong style="font-size:var(--fs-base);">${final}%</strong></td>
        <td>${pctAsis}%</td>
        <td>
          <span class="badge ${aprobado ? 'badge-olive' : 'badge-rust'}">
            ${aprobado ? 'Aprobado' : 'Reprobado'}
          </span>
        </td>
      </tr>
    `;
  }).join('');

  const promedioGeneral = clasesAlumno.length > 0
    ? Math.round((sumaNotas / clasesAlumno.length) * 10) / 10
    : 0;

  return `
    ${appState.currentRole !== 'ESTUDIANTE' ? `
      <div class="toolbar" style="background:var(--papel); padding:14px 18px; border-radius:var(--radius); border:1px solid var(--linea);">
        <div class="toolbar-filters">
          <label class="form-label" style="margin-bottom:0;">Estudiante:</label>
          <select class="form-control" style="max-width:420px;" data-on-change="actualizarFiltro('boletinEstudianteId', this.value)">
            ${store.estudiantes.map(e => `<option value="${esc(e.id)}" ${e.id === est.id ? 'selected' : ''}>[${esc(e.codigoAlumno)}] ${esc(e.apellidos)}, ${esc(e.nombres)} (${esc(e.grado)})</option>`).join('')}
          </select>
        </div>
        <button class="btn btn-outline" data-on-click="imprimirPagina()">${ICONS.print} Imprimir</button>
      </div>
    ` : ''}

    <div class="panel">
      <div class="panel-header">
        <div class="panel-title">
          <h2>Boletín</h2>
          <p>Escuela de Suboficiales del Ejército | Escala Oficial 0% a 100% (Aprobación mínima: 70%)</p>
        </div>
        <span class="badge ${promedioGeneral >= 70 ? 'badge-olive' : 'badge-rust'}" style="font-size:var(--fs-sm); padding:6px 12px;">
          Promedio General: ${promedioGeneral}%
        </span>
      </div>
      <div class="panel-body">
        <div class="form-grid-3" style="background:var(--beige-suave); padding:16px; border-radius:var(--radius); border:1px solid var(--linea); margin-bottom:20px;">
          <div>
            <small style="color:var(--piedra); text-transform:uppercase; font-weight:700; font-size:var(--fs-meta);">Nombre Completo y Grado</small>
            <strong style="display:block; font-size:var(--fs-base); color:var(--texto);">${esc(formatNombreConGrado(est))}</strong>
            <span style="font-size:var(--fs-sm); color:var(--piedra);">Condición: ${esc(est.condicion)}</span>
          </div>
          <div>
            <small style="color:var(--piedra); text-transform:uppercase; font-weight:700; font-size:var(--fs-meta);">Identificación Oficial</small>
            <strong style="display:block; font-size:var(--fs-base); font-family:monospace;">Código: ${esc(est.codigoAlumno)}</strong>
            <span style="font-size:var(--fs-sm); color:var(--piedra);">DNI: ${esc(est.dni)} | Sangre: ${esc(est.tipoSangre)}</span>
          </div>
          <div>
            <small style="color:var(--piedra); text-transform:uppercase; font-weight:700; font-size:var(--fs-meta);">Ubicación Académica</small>
            <strong style="display:block; font-size:var(--fs-base); color:var(--texto);">${esc(prom.nombre)}</strong>
          </div>
        </div>

        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Asignatura / Periodo</th>
                <th>Catedrático</th>
                <th>I Parcial</th>
                <th>II Parcial</th>
                <th>III Parcial</th>
                <th>Acum.</th>
                <th>Nota Final</th>
                <th>Asistencia</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              ${filasMaterias || `<tr><td colspan="10" style="text-align:center; padding:20px;">No hay asignaturas para esta promoción.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

// ==========================================================================
// VENTANAS MODALES DE CREACION Y DETALLE
// ==========================================================================

function openModal(titulo, bodyHtml) {
  document.getElementById('modal-title').textContent = titulo;
  document.getElementById('modal-body-content').innerHTML = bodyHtml;
  document.getElementById('modal-backdrop').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal-backdrop').classList.add('hidden');
}

function verExpedienteEstudiante(id) {
  const est = getEstudiante(id);
  if (!est) return;
  const prom = getPromocion(est.promocionId);

  openModal(`Expediente Institucional — Código: ${esc(est.codigoAlumno)}`, `
    <div class="form-grid-2">
      <div class="form-group">
        <label class="form-label">Código del Alumno (Nivel FFAA)</label>
        <input class="form-control" value="${esc(est.codigoAlumno)}" disabled>
      </div>
      <div class="form-group">
        <label class="form-label">DNI / Identidad</label>
        <input class="form-control" value="${esc(est.dni)}" disabled>
      </div>
      <div class="form-group">
        <label class="form-label">Nombres</label>
        <input class="form-control" value="${esc(est.nombres)}" disabled>
      </div>
      <div class="form-group">
        <label class="form-label">Apellidos</label>
        <input class="form-control" value="${esc(est.apellidos)}" disabled>
      </div>
      <div class="form-group">
        <label class="form-label">Condición y Grado Militar</label>
        <input class="form-control" value="${esc(est.condicion)} — ${esc(est.grado)}" disabled>
      </div>
      <div class="form-group">
        <label class="form-label">Promoción</label>
        <input class="form-control" value="${esc(prom.nombre)}" disabled>
      </div>
      <div class="form-group">
        <label class="form-label">Fecha de Nacimiento y Tipo de Sangre</label>
        <input class="form-control" value="${esc(est.fechaNacimiento)} | Grupo: ${esc(est.tipoSangre)}" disabled>
      </div>
      <div class="form-group">
        <label class="form-label">Lugar de Procedencia</label>
        <input class="form-control" value="${esc(est.procedencia)}" disabled>
      </div>
      <div class="form-group">
        <label class="form-label">Teléfono y Correo</label>
        <input class="form-control" value="${esc(est.telefono)} | ${esc(est.correo)}" disabled>
      </div>
      <div class="form-group">
        <label class="form-label">Contacto de Emergencia</label>
        <input class="form-control" value="${esc(est.contactoEmergencia)}" disabled>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Dirección Domiciliaria</label>
      <input class="form-control" value="${esc(est.direccion)}" disabled>
    </div>
    <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:16px;">
      <button class="btn btn-outline" data-on-click="closeModal()">Cerrar</button>
      <button class="btn btn-primary" data-on-click="closeModal(); verBoletinDeEstudiante('${esc(est.id)}')">Ver Boletín de Calificaciones</button>
    </div>
  `);
}

function openModalNuevoEstudiante() {
  if (!store.promociones.length) { showToast('Primero registre una promoción'); return; }
  openModal('Registrar Nuevo Estudiante en la ESOE', `
    <form data-on-submit="guardarNuevoEstudiante(event)">
      <div class="form-grid-2">
        <div class="form-group">
          <label class="form-label">Código del Alumno (Numérico FFAA) *</label>
          <input type="text" id="est-codigo" class="form-control" required pattern="[0-9]+" title="Ingrese un código numérico de FFAA">
        </div>
        <div class="form-group">
          <label class="form-label">DNI / Identidad *</label>
          <input type="text" id="est-dni" class="form-control" required>
        </div>
        <div class="form-group">
          <label class="form-label">Nombres *</label>
          <input type="text" id="est-nombres" class="form-control" required>
        </div>
        <div class="form-group">
          <label class="form-label">Apellidos *</label>
          <input type="text" id="est-apellidos" class="form-control" required>
        </div>
        <div class="form-group">
          <label class="form-label">Condición *</label>
          <select id="est-condicion" class="form-control" data-on-change="toggleGradoEstudiante(this.value)">
            <option value="MILITAR">Militar</option>
            <option value="CIVIL">Civil</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Grado Militar (Si es militar) *</label>
          <input type="text" id="est-grado" class="form-control">
        </div>
        <div class="form-group">
          <label class="form-label">Promoción *</label>
          <select id="est-promocion" class="form-control">
            ${store.promociones.map(p => `<option value="${esc(p.id)}">${esc(p.nombre)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Fecha de Nacimiento *</label>
          <input type="date" id="est-nacimiento" class="form-control" required>
        </div>
        <div class="form-group">
          <label class="form-label">Tipo de Sangre</label>
          <select id="est-sangre" class="form-control">
            <option value="O+">O+</option>
            <option value="O-">O-</option>
            <option value="A+">A+</option>
            <option value="A-">A-</option>
            <option value="B+">B+</option>
            <option value="AB+">AB+</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Teléfono</label>
          <input type="text" id="est-telefono" class="form-control" required>
        </div>
        <div class="form-group">
          <label class="form-label">Lugar de Procedencia</label>
          <input type="text" id="est-procedencia" class="form-control" required>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Contacto de Emergencia (Nombre y Teléfono)</label>
        <input type="text" id="est-emergencia" class="form-control" required>
      </div>
      <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:16px;">
        <button type="button" class="btn btn-outline" data-on-click="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn-primary">Guardar Expediente</button>
      </div>
    </form>
  `);
}

function toggleGradoEstudiante(condicion) {
  const g = document.getElementById('est-grado');
  g.disabled = condicion === 'CIVIL';
  if (g.disabled) g.value = '';
}

function guardarNuevoEstudiante(e) {
  e.preventDefault();
  const condicion = document.getElementById('est-condicion').value;
  const nuevo = {
    id: 'est-' + Date.now(),
    codigoAlumno: document.getElementById('est-codigo').value.trim(),
    dni: document.getElementById('est-dni').value.trim(),
    nombres: document.getElementById('est-nombres').value.trim(),
    apellidos: document.getElementById('est-apellidos').value.trim(),
    condicion,
    grado: condicion === 'MILITAR' ? document.getElementById('est-grado').value.trim() : '',
    promocionId: document.getElementById('est-promocion').value,
    fechaNacimiento: document.getElementById('est-nacimiento').value,
    tipoSangre: document.getElementById('est-sangre').value,
    telefono: document.getElementById('est-telefono').value.trim(),
    correo: '',
    procedencia: document.getElementById('est-procedencia').value.trim(),
    contactoEmergencia: document.getElementById('est-emergencia').value.trim(),
    direccion: '',
    estado: 'ACTIVO'
  };

  store.estudiantes.push(nuevo);
  saveStore(store);
  closeModal();
  renderMainView();
  showToast(`Estudiante ${nuevo.nombres} ${nuevo.apellidos} registrado exitosamente`);
}

function openModalNuevoCatedratico() {
  openModal('Registrar Nuevo Catedrático', `
    <form data-on-submit="guardarNuevoCatedratico(event)">
      <div class="form-grid-2">
        <div class="form-group">
          <label class="form-label">Nombres *</label>
          <input type="text" id="cat-nombres" class="form-control" required>
        </div>
        <div class="form-group">
          <label class="form-label">Apellidos *</label>
          <input type="text" id="cat-apellidos" class="form-control" required>
        </div>
        <div class="form-group">
          <label class="form-label">DNI / Identidad *</label>
          <input type="text" id="cat-dni" class="form-control" required>
        </div>
        <div class="form-group">
          <label class="form-label">Teléfono</label>
          <input type="text" id="cat-telefono" class="form-control" required>
        </div>
        <div class="form-group">
          <label class="form-label">Condición *</label>
          <select id="cat-condicion" class="form-control" data-on-change="toggleGradoCatedratico(this.value)">
            <option value="MILITAR">Militar</option>
            <option value="CIVIL">Civil</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Grado Militar (En caso de ser militar) *</label>
          <input type="text" id="cat-grado" class="form-control">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Título Académico / Especialidad *</label>
        <input type="text" id="cat-titulo" class="form-control" required>
      </div>
      <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:16px;">
        <button type="button" class="btn btn-outline" data-on-click="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn-primary">Nuevo catedrático</button>
      </div>
    </form>
  `);
}

function toggleGradoCatedratico(condicion) {
  const g = document.getElementById('cat-grado');
  g.disabled = condicion === 'CIVIL';
  if (g.disabled) g.value = '';
}

function guardarNuevoCatedratico(e) {
  e.preventDefault();
  const condicion = document.getElementById('cat-condicion').value;
  const nuevo = {
    id: 'cat-' + Date.now(),
    dni: document.getElementById('cat-dni').value.trim(),
    nombres: document.getElementById('cat-nombres').value.trim(),
    apellidos: document.getElementById('cat-apellidos').value.trim(),
    titulo: document.getElementById('cat-titulo').value.trim(),
    condicion,
    grado: condicion === 'MILITAR' ? document.getElementById('cat-grado').value.trim() : '',
    telefono: document.getElementById('cat-telefono').value.trim(),
    correo: '',
    activo: true
  };

  store.catedraticos.push(nuevo);
  saveStore(store);
  closeModal();
  renderMainView();
  showToast(`Catedrático ${formatNombreConGrado(nuevo)} registrado correctamente`);
}

function openModalNuevoPeriodo() {
  openModal('Crear Nuevo periodo', `
    <form data-on-submit="guardarNuevoPeriodo(event)">
      <div class="form-grid-2">
        <div class="form-group">
          <label class="form-label">Código del Periodo *</label>
          <input type="text" id="per-codigo" class="form-control" required>
        </div>
        <div class="form-group">
          <label class="form-label">Modalidad del Periodo (4 opciones) *</label>
          <select id="per-modalidad" class="form-control">
            ${MODALIDADES_PERIODO.map(m => `<option value="${esc(m.codigo)}">${esc(m.etiqueta)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Nombre Descriptivo *</label>
        <input type="text" id="per-nombre" class="form-control" required>
      </div>
      <div class="form-grid-2">
        <div class="form-group">
          <label class="form-label">Fecha de Inicio *</label>
          <input type="date" id="per-inicio" class="form-control" required>
        </div>
        <div class="form-group">
          <label class="form-label">Fecha de Finalización *</label>
          <input type="date" id="per-fin" class="form-control" required>
        </div>
      </div>
      <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:16px;">
        <button type="button" class="btn btn-outline" data-on-click="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn-primary">Crear Periodo</button>
      </div>
    </form>
  `);
}

function guardarNuevoPeriodo(e) {
  e.preventDefault();
  store.periodos.push({
    id: 'per-' + Date.now(),
    codigo: document.getElementById('per-codigo').value.trim(),
    nombre: document.getElementById('per-nombre').value.trim(),
    modalidad: document.getElementById('per-modalidad').value,
    fechaInicio: document.getElementById('per-inicio').value,
    fechaFin: document.getElementById('per-fin').value,
    activo: true
  });
  saveStore(store);
  closeModal();
  renderMainView();
  showToast('Nuevo periodo lectivo habilitado');
}

function openModalNuevaPromocion() {
  openModal('Registrar Nueva Promoción ESOE', `
    <form data-on-submit="guardarNuevaPromocion(event)">
      <div class="form-grid-2">
        <div class="form-group">
          <label class="form-label">Código de Promoción *</label>
          <input type="text" id="prom-codigo" class="form-control" required>
        </div>
        <div class="form-group">
          <label class="form-label">Nombre Oficial *</label>
          <input type="text" id="prom-nombre" class="form-control" required>
        </div>
        <div class="form-group">
          <label class="form-label">Año de Ingreso *</label>
          <input type="number" id="prom-ingreso" class="form-control" required>
        </div>
        <div class="form-group">
          <label class="form-label">Año de Egreso *</label>
          <input type="number" id="prom-egreso" class="form-control" required>
        </div>
      </div>
      <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:16px;">
        <button type="button" class="btn btn-outline" data-on-click="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn-primary">Crear Promoción</button>
      </div>
    </form>
  `);
}

function guardarNuevaPromocion(e) {
  e.preventDefault();
  const promId = 'prom-' + Date.now();
  store.promociones.push({
    id: promId,
    codigo: document.getElementById('prom-codigo').value.trim(),
    nombre: document.getElementById('prom-nombre').value.trim(),
    anioIngreso: Number(document.getElementById('prom-ingreso').value),
    anioEgreso: Number(document.getElementById('prom-egreso').value),
    activa: true
  });
  saveStore(store);
  closeModal();
  renderMainView();
  showToast('Promoción creada');
}

function openModalNuevaMateria() {
  openModal('Registrar Nueva Materia en el Catálogo', `
    <form data-on-submit="guardarNuevaMateria(event)">
      <div class="form-grid-2">
        <div class="form-group">
          <label class="form-label">Código de Materia *</label>
          <input type="text" id="mat-codigo" class="form-control" required>
        </div>
        <div class="form-group">
          <label class="form-label">Unidades Valorativas (UV) *</label>
          <input type="number" id="mat-uv" class="form-control" min="1" max="10" required>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Nombre de la Asignatura *</label>
        <input type="text" id="mat-nombre" class="form-control" required>
      </div>
      <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:16px;">
        <button type="button" class="btn btn-outline" data-on-click="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn-primary">Guardar Materia</button>
      </div>
    </form>
  `);
}

function guardarNuevaMateria(e) {
  e.preventDefault();
  store.materias.push({
    id: 'mat-' + Date.now(),
    codigo: document.getElementById('mat-codigo').value.trim(),
    nombre: document.getElementById('mat-nombre').value.trim(),
    uv: Number(document.getElementById('mat-uv').value),
    horasSemanales: 4
  });
  saveStore(store);
  closeModal();
  renderMainView();
  showToast('Materia agregada al catálogo institucional');
}

function openModalNuevaClase() {
  if (!store.periodos.length || !store.promociones.length || !store.materias.length || !store.catedraticos.length) { showToast('Primero registre periodo, promoción, materia y catedrático'); return; }
  openModal('Nueva clase (1 Catedrático por Clase)', `
    <form data-on-submit="guardarNuevaClase(event)">
      <div class="form-grid-2">
        <div class="form-group">
          <label class="form-label">Código de Clase *</label>
          <input type="text" id="cls-codigo" class="form-control" required>
        </div>
        <div class="form-group">
          <label class="form-label">Periodo Lectivo *</label>
          <select id="cls-periodo" class="form-control">
            ${store.periodos.map(p => `<option value="${esc(p.id)}">${esc(p.nombre)} (${esc(p.modalidad)})</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Promoción *</label>
          <select id="cls-promocion" class="form-control">
            ${store.promociones.map(p => `<option value="${esc(p.id)}">${esc(p.nombre)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Materia a Impartir *</label>
          <select id="cls-materia" class="form-control">
            ${store.materias.map(m => `<option value="${esc(m.id)}">${esc(m.codigo)} - ${esc(m.nombre)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Catedrático (1 por Clase) *</label>
          <select id="cls-catedratico" class="form-control">
            ${store.catedraticos.map(c => `<option value="${esc(c.id)}">${esc(formatNombreConGrado(c))}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Horario de Clase *</label>
          <input type="text" id="cls-horario" class="form-control" required>
        </div>
        <div class="form-group">
          <label class="form-label">Aula *</label>
          <input type="text" id="cls-aula" class="form-control" required>
        </div>
      </div>
      <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:16px;">
        <button type="button" class="btn btn-outline" data-on-click="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn-primary">Asignar Clase</button>
      </div>
    </form>
  `);
}

function guardarNuevaClase(e) {
  e.preventDefault();
  store.clases.push({
    id: 'cls-' + Date.now(),
    codigoClase: document.getElementById('cls-codigo').value.trim(),
    periodoId: document.getElementById('cls-periodo').value,
    promocionId: document.getElementById('cls-promocion').value,
    materiaId: document.getElementById('cls-materia').value,
    catedraticoId: document.getElementById('cls-catedratico').value,
    horario: document.getElementById('cls-horario').value.trim(),
    aula: document.getElementById('cls-aula').value.trim()
  });
  saveStore(store);
  closeModal();
  renderMainView();
  showToast('Clase registrada');
}