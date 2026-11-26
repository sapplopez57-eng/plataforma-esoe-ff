const recorridoGuiado = (function prepararRecorrido() {
  const dialogo = document.createElement('dialog');
  dialogo.className = 'recorrido';
  dialogo.setAttribute('aria-labelledby', 'recorrido-titulo');
  dialogo.setAttribute('aria-describedby', 'recorrido-descripcion');
  dialogo.innerHTML = `
    <header class="recorrido-cabecera"><p class="rotulo">Conozca su plataforma</p><button type="button" class="recorrido-cerrar" aria-label="Cerrar recorrido">×</button></header>
    <p class="rotulo recorrido-progreso" aria-live="polite"></p>
    <h2 id="recorrido-titulo"></h2>
    <p id="recorrido-descripcion"></p>
    <button type="button" class="btn btn-outline recorrido-abrir">Abrir herramienta</button>
    <footer class="recorrido-acciones"><button type="button" class="btn btn-outline recorrido-anterior">Anterior</button><button type="button" class="btn btn-primary recorrido-siguiente">Siguiente</button></footer>`;
  document.body.append(dialogo);
  const titulo = dialogo.querySelector('h2');
  const descripcion = dialogo.querySelector('#recorrido-descripcion');
  const progreso = dialogo.querySelector('.recorrido-progreso');
  const anterior = dialogo.querySelector('.recorrido-anterior');
  const siguiente = dialogo.querySelector('.recorrido-siguiente');
  const herramienta = dialogo.querySelector('.recorrido-abrir');
  let pasos = [];
  let indice = 0;
  let origen = null;
  function pintar() {
    const paso = pasos[indice];
    titulo.textContent = paso.titulo;
    descripcion.textContent = paso.descripcion;
    progreso.textContent = `Paso ${indice + 1} de ${pasos.length}`;
    anterior.disabled = indice === 0;
    siguiente.textContent = indice === pasos.length - 1 ? 'Terminar recorrido' : 'Siguiente';
    herramienta.hidden = !paso.vista;
  }
  dialogo.querySelector('.recorrido-cerrar').addEventListener('click', () => dialogo.close());
  anterior.addEventListener('click', () => { if (indice > 0) { indice -= 1; pintar(); } });
  siguiente.addEventListener('click', () => {
    if (indice === pasos.length - 1) return dialogo.close();
    indice += 1;
    pintar();
  });
  herramienta.addEventListener('click', () => {
    const vista = pasos[indice].vista;
    dialogo.close();
    navigateTo(vista);
    document.getElementById('content-area').focus();
  });
  dialogo.addEventListener('close', () => { if (origen?.isConnected) origen.focus(); });
  return {
    abrir() {
      if (!appState.authenticated || dialogo.open) return;
      origen = document.activeElement;
      const nombre = document.getElementById('sidebar-user-name').textContent || 'Usuario';
      pasos = [
        { titulo: `Bienvenido, ${nombre}`, descripcion: 'Su identidad y su perfil proceden de la sesión institucional. Aquí conocerá las herramientas disponibles para su cuenta.' },
        { titulo: 'Clases', descripcion: 'Consulte las materias, los horarios y las aulas de las clases que le corresponden.', vista: 'clases' },
        { titulo: 'Asistencia', descripcion: appState.currentRole === 'ESTUDIANTE'
          ? 'Consulte las asistencias y ausencias que ha registrado su catedrático.'
          : 'Registre la asistencia de cada sesión en sus clases y revise los registros guardados.', vista: 'asistencia' }
      ];
      pasos.push(appState.currentRole === 'ESTUDIANTE'
        ? { titulo: 'Su boletín', descripcion: 'Revise sus calificaciones y su resultado final en cada clase. Solo puede consultar su propia información.', vista: 'boletin' }
        : { titulo: 'Calificaciones', descripcion: 'Registre y consulte las notas de las clases que su cuenta tiene autorizadas. Los cambios se guardan en el servidor al usar la cuenta institucional.', vista: 'calificaciones' });
      if (appState.currentRole === 'ADMIN') {
        pasos.push({ titulo: 'Gestión académica', descripcion: 'Organice periodos y promociones antes de crear las clases. Los expedientes y los registros pertenecen a su institución.', vista: 'estructura' });
      }
      pasos.push({ titulo: 'Otras plataformas', descripcion: 'Abra los portales oficiales de INFOP, UDH y COPECO. Con la cuenta institucional puede vincular sus propias cuentas cuando la administración habilite sus servicios.', vista: 'integraciones' });
      indice = 0;
      pintar();
      dialogo.showModal();
    }
  };
})();

function abrirRecorrido() {
  recorridoGuiado.abrir();
}
