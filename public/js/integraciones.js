const integraciones = { cargando: false, error: '', plataformas: [], cursos: [], catalogo: [] };

function renderIntegracionesView() {
  if (!sesionReal.activa) {
    return emptyState('La conexión con otras plataformas requiere iniciar sesión en el servidor de la escuela. No está disponible en el modo demostración.');
  }
  if (!sesionReal.integraciones) {
    return emptyState('La conexión con otras plataformas aún no está configurada en este servidor.');
  }
  if (!integraciones.cargando) cargarIntegraciones();
  return '<div id="integraciones-contenido"></div>';
}

function pintarIntegraciones() {
  const contenedor = document.getElementById('integraciones-contenido');
  if (!contenedor) return;
  const esAdmin = appState.currentRole === 'ADMIN';

  if (integraciones.cargando) {
    contenedor.innerHTML = emptyState('Cargando…');
    return;
  }
  if (integraciones.error) {
    contenedor.innerHTML = `${emptyState(esc(integraciones.error))}
      <div class="toolbar" style="margin-top:16px;"><button type="button" class="btn btn-outline" data-on-click="cargarIntegraciones()">Reintentar</button></div>`;
    return;
  }

  const registradas = new Set(integraciones.plataformas.map((p) => p.urlBase));
  const sugeridas = integraciones.catalogo.filter((p) => !registradas.has(p.urlBase));

  const filas = integraciones.plataformas.map((p) => `
    <tr>
      <td><strong>${esc(p.nombre)}</strong><br><small>${esc(p.urlBase)}</small></td>
      <td>${p.vinculada
        ? `<span class="badge badge-olive">Vinculada</span><br><small>${esc(p.cuenta)}</small>`
        : '<span class="badge badge-neutral">Sin vincular</span>'}</td>
      <td style="text-align:right;">
        ${p.vinculada
          ? `<button type="button" class="btn btn-outline btn-sm" data-id="${esc(p.id)}" data-on-click="desvincularCuentaExterna(this.dataset.id)">Desvincular</button>`
          : `<button type="button" class="btn btn-primary btn-sm" data-id="${esc(p.id)}" data-on-click="abrirVinculacion(this.dataset.id)">Vincular mi cuenta</button>`}
        ${esAdmin ? `<button type="button" class="btn btn-outline btn-sm" data-id="${esc(p.id)}" data-on-click="probarPlataforma(this.dataset.id)">Probar</button>
          <button type="button" class="btn btn-outline btn-sm" data-id="${esc(p.id)}" data-on-click="eliminarPlataforma(this.dataset.id)">Eliminar</button>` : ''}
      </td>
    </tr>`).join('');

  const bloqueCursos = integraciones.cursos.map((grupo) => {
    if (grupo.estado === 'REVINCULAR') {
      return `<h3 class="section-title">${esc(grupo.nombre)}</h3>${emptyState('La plataforma dejó de aceptar la conexión. Vuelva a vincular su cuenta.')}`;
    }
    if (grupo.estado !== 'OK') {
      return `<h3 class="section-title">${esc(grupo.nombre)}</h3>${emptyState('La plataforma no responde en este momento.')}`;
    }
    if (grupo.cursos.length === 0) {
      return `<h3 class="section-title">${esc(grupo.nombre)}</h3>${emptyState('No tiene cursos en esta plataforma.')}`;
    }
    const cursos = grupo.cursos.map((c) => `
      <tr>
        <td><strong>${esc(c.nombre)}</strong><br><small>${esc(c.codigo)}</small></td>
        <td>${c.avance === null ? '—' : `${esc(c.avance)} %`}</td>
        <td>${c.calificacion === null ? '—' : esc(c.calificacion)}</td>
        <td>${c.completado ? '<span class="badge badge-olive">Completado</span>' : '<span class="badge badge-neutral">En curso</span>'}</td>
        <td style="text-align:right;"><a class="btn btn-outline btn-sm" href="${esc(c.enlace)}" target="_blank" rel="noopener noreferrer">Abrir</a></td>
      </tr>`).join('');
    return `<h3 class="section-title">${esc(grupo.nombre)}</h3>
      <table class="data-table">
        <thead><tr><th>Curso</th><th>Avance</th><th>Calificación</th><th>Estado</th><th></th></tr></thead>
        <tbody>${cursos}</tbody>
      </table>`;
  }).join('');

  contenedor.innerHTML = `
    <div class="toolbar">
      <p>Vincule su cuenta de otras plataformas para ver aquí sus cursos, su avance y sus calificaciones.</p>
      ${esAdmin ? `<button type="button" class="btn btn-primary" data-on-click="abrirNuevaPlataforma()">${ICONS.plus}<span>Agregar plataforma</span></button>` : ''}
    </div>
    ${integraciones.plataformas.length === 0
      ? emptyState(esAdmin ? 'Aún no hay plataformas registradas.' : 'La administración aún no ha registrado plataformas.')
      : `<table class="data-table">
          <thead><tr><th>Plataforma</th><th>Mi cuenta</th><th></th></tr></thead>
          <tbody>${filas}</tbody>
        </table>`}
    ${esAdmin && sugeridas.length > 0 ? `
      <h3 class="section-title">Plataformas sugeridas</h3>
      <table class="data-table"><tbody>${sugeridas.map((p) => `
        <tr>
          <td><strong>${esc(p.nombre)}</strong><br><small>${esc(p.descripcion)}</small></td>
          <td style="text-align:right;"><button type="button" class="btn btn-outline btn-sm" data-clave="${esc(p.clave)}" data-on-click="agregarSugerida(this.dataset.clave)">Agregar</button></td>
        </tr>`).join('')}</tbody></table>` : ''}
    ${bloqueCursos ? `<h2 class="section-title" style="margin-top:32px;">Mis cursos en otras plataformas</h2>${bloqueCursos}` : ''}
  `;
}

async function cargarIntegraciones() {
  integraciones.cargando = true;
  integraciones.error = '';
  pintarIntegraciones();
  try {
    const esAdmin = appState.currentRole === 'ADMIN';
    const [plataformas, cursos, catalogo] = await Promise.all([
      api('/integraciones/plataformas'),
      api('/integraciones/mis-cursos'),
      esAdmin ? api('/integraciones/catalogo') : Promise.resolve({ plataformas: [] })
    ]);
    integraciones.plataformas = plataformas.plataformas;
    integraciones.cursos = cursos.plataformas;
    integraciones.catalogo = catalogo.plataformas;
  } catch (error) {
    integraciones.error = error.message;
  }
  integraciones.cargando = false;
  pintarIntegraciones();
}

async function operarIntegracion(accion, mensajeDeExito) {
  try {
    await accion();
    if (mensajeDeExito) showToast(mensajeDeExito);
    closeModal();
    await cargarIntegraciones();
  } catch (error) {
    showToast(error.message);
  }
}

function abrirNuevaPlataforma() {
  openModal('Agregar plataforma', `
    <form data-on-submit="guardarNuevaPlataforma(event)">
      <div class="form-group">
        <label class="form-label" for="plataforma-nombre">Nombre</label>
        <input type="text" id="plataforma-nombre" class="form-control" maxlength="120" required>
      </div>
      <div class="form-group">
        <label class="form-label" for="plataforma-url">Dirección del sitio Moodle</label>
        <input type="url" id="plataforma-url" class="form-control" placeholder="https://campus.ejemplo.hn" required>
      </div>
      <button type="submit" class="btn btn-primary">Verificar y agregar</button>
    </form>`);
}

function guardarNuevaPlataforma(evento) {
  evento.preventDefault();
  const cuerpo = {
    nombre: document.getElementById('plataforma-nombre').value,
    tipo: 'MOODLE',
    urlBase: document.getElementById('plataforma-url').value
  };
  operarIntegracion(() => api('/integraciones/plataformas', { metodo: 'POST', cuerpo }), 'Plataforma agregada');
}

function agregarSugerida(clave) {
  const sugerida = integraciones.catalogo.find((p) => p.clave === clave);
  if (!sugerida) return;
  const cuerpo = { nombre: sugerida.nombre, tipo: sugerida.tipo, urlBase: sugerida.urlBase };
  operarIntegracion(() => api('/integraciones/plataformas', { metodo: 'POST', cuerpo }), 'Plataforma agregada');
}

async function probarPlataforma(id) {
  try {
    const resultado = await api(`/integraciones/plataformas/${encodeURIComponent(id)}/probar`, { metodo: 'POST', cuerpo: {} });
    showToast(resultado.disponible ? 'La plataforma responde correctamente' : 'La plataforma está en mantenimiento o sin servicios web');
  } catch (error) {
    showToast(error.message);
  }
}

function eliminarPlataforma(id) {
  if (!window.confirm('Se eliminará la plataforma y las cuentas que los usuarios hayan vinculado a ella. ¿Continuar?')) return;
  operarIntegracion(() => api(`/integraciones/plataformas/${encodeURIComponent(id)}`, { metodo: 'DELETE' }), 'Plataforma eliminada');
}

function abrirVinculacion(id) {
  const plataforma = integraciones.plataformas.find((p) => p.id === id);
  if (!plataforma) return;
  openModal(`Vincular cuenta — ${plataforma.nombre}`, `
    <form data-id="${esc(plataforma.id)}" data-on-submit="guardarVinculacion(event)" autocomplete="off">
      <p style="margin-bottom:16px;">Escriba el usuario y la contraseña que usa en <strong>${esc(plataforma.nombre)}</strong>.
      La contraseña se usa una sola vez para pedir una llave de acceso y no se guarda.</p>
      <div class="form-group">
        <label class="form-label" for="vinculo-usuario">Usuario en esa plataforma</label>
        <input type="text" id="vinculo-usuario" class="form-control" maxlength="150" autocomplete="off" required>
      </div>
      <div class="form-group">
        <label class="form-label" for="vinculo-clave">Contraseña en esa plataforma</label>
        <input type="password" id="vinculo-clave" class="form-control" maxlength="300" autocomplete="off" required>
      </div>
      <button type="submit" class="btn btn-primary">Vincular</button>
    </form>`);
}

function guardarVinculacion(evento) {
  evento.preventDefault();
  const id = evento.target.dataset.id;
  const cuerpo = {
    usuario: document.getElementById('vinculo-usuario').value,
    clave: document.getElementById('vinculo-clave').value
  };
  operarIntegracion(() => api(`/integraciones/plataformas/${encodeURIComponent(id)}/cuenta`, { metodo: 'POST', cuerpo }), 'Cuenta vinculada');
}

function desvincularCuentaExterna(id) {
  operarIntegracion(() => api(`/integraciones/plataformas/${encodeURIComponent(id)}/cuenta`, { metodo: 'DELETE' }), 'Cuenta desvinculada');
}
