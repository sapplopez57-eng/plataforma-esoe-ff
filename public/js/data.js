const STORAGE_KEY = 'esoe_sms_store_v3';

const MODALIDADES_PERIODO = [
  { codigo: 'SEMESTRAL', etiqueta: 'Semestral' },
  { codigo: 'CUATRIMESTRAL', etiqueta: 'Cuatrimestral' },
  { codigo: 'MODULAR', etiqueta: 'Modular' },
  { codigo: 'ANUAL', etiqueta: 'Año lectivo' }
];

const INITIAL_DATA = {
  periodos: [],
  promociones: [],
  catedraticos: [],
  estudiantes: [],
  materias: [],
  clases: [],
  calificaciones: [],
  asistencias: []
};

function emptyStore() {
  return JSON.parse(JSON.stringify(INITIAL_DATA));
}

function loadStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyStore();
    return Object.assign(emptyStore(), JSON.parse(raw));
  } catch (e) {
    return emptyStore();
  }
}

function saveStore(store) {
  if (typeof sesionReal !== 'undefined' && sesionReal.activa) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch (e) {
    console.error('Error guardando estado local:', e);
  }
}

function resetStore() {
  localStorage.removeItem(STORAGE_KEY);
  return emptyStore();
}
