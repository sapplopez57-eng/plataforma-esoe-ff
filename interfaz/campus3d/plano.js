export function azar(semilla) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function contorno(rx, ry, { cx = 0, cy = 0, n = 72, amp = 0.09, semilla = 3 } = {}) {
  const r = azar(semilla);
  const fases = [r() * 6.28, r() * 6.28, r() * 6.28];
  const puntos = [];
  for (let i = 0; i < n; i += 1) {
    const t = (2 * Math.PI * i) / n;
    const k = 1 + amp * (Math.sin(3 * t + fases[0]) + 0.6 * Math.sin(5 * t + fases[1]) + 0.4 * Math.sin(7 * t + fases[2]));
    puntos.push([cx + rx * k * Math.cos(t), cy + ry * k * Math.sin(t)]);
  }
  return puntos;
}

export const EDIFICIOS = {
  direccion: { x: -4, y: -8.5, w: 5, d: 2.6, h: 2.6, techo: '--marca-5' },
  aulas: { x: 4.5, y: -6.5, w: 2.6, d: 6, h: 2.2, techo: '--marca-1' },
  biblioteca: { x: -9, y: -2.5, w: 2.8, d: 4.2, h: 1.9, techo: '--marca-4' },
  comedor: { x: 4.6, y: 3.2, w: 3.4, d: 2.6, h: 1.5, techo: '--marca-5' },
  alojamiento: { x: -7.5, y: 3.6, w: 4.6, d: 2.4, h: 2.0, techo: '--marca-1' },
  enfermeria: { x: -1.5, y: 4.8, w: 2.4, d: 2, h: 1.3, techo: '--marca-4' }
};

export const PLAZA = { x: -3.5, y: -2.5, w: 7, d: 5 };
export const TORRE = { x: 11.6, y: -3.1, h: 4.4 };
export const ASTA = { x: 0, y: -3.2, h: 4.2 };
export const MUELLE = { x: 14.6, y: -0.6, w: 3.2, d: 1.2 };
export const ISLA = { rx: 15.5, ry: 13.2, alto: 1.1 };
export const ANILLO = { rx: 10.2, ry: 8.6, ancho: 0.75 };

export function anclas() {
  const res = {};
  for (const [clave, e] of Object.entries(EDIFICIOS)) {
    res[clave] = [e.x + e.w / 2, e.h + 1.3, e.y + e.d / 2];
  }
  res.plaza = [0, 0.3, -1.2];
  res.torre = [TORRE.x, TORRE.h + 0.6, TORRE.y];
  return res;
}

export function arboles(cantidad = 72) {
  const r = azar(4);
  const ocupado = Object.values(EDIFICIOS).map((e) => [e.x, e.y, e.w, e.d])
    .concat([[PLAZA.x - 0.3, PLAZA.y - 0.3, PLAZA.w + 0.6, PLAZA.d + 0.6], [TORRE.x - 0.8, TORRE.y - 0.8, 1.6, 1.6]]);
  const lista = [];
  let intentos = 0;
  while (lista.length < cantidad && intentos < 20000) {
    intentos += 1;
    const x = r() * 28 - 14;
    const y = r() * 24 - 12;
    if ((x / 13.6) ** 2 + (y / 11.4) ** 2 > 0.86) continue;
    const d = Math.hypot(x / ANILLO.rx, y / ANILLO.ry);
    if (d > 0.9 && d < 1.1) continue;
    if (ocupado.some(([a, b, w, dd]) => x > a - 0.6 && x < a + w + 0.6 && y > b - 0.6 && y < b + dd + 0.6)) continue;
    if (Math.abs(x) < 0.8 && y > 8) continue;
    if (Math.abs(y) < 0.8 && x > 9) continue;
    lista.push({ x, y, escala: 0.75 + r() * 0.45, tono: r() });
  }
  return lista;
}
