import {
  Scene, PerspectiveCamera, WebGLRenderer, Color, Fog, Vector3, Shape, ExtrudeGeometry, ShapeGeometry,
  BoxGeometry, CylinderGeometry, ConeGeometry, IcosahedronGeometry, PlaneGeometry, RingGeometry, SphereGeometry,
  BufferGeometry, Float32BufferAttribute, MeshStandardMaterial, MeshBasicMaterial, Mesh, Group, InstancedMesh,
  Object3D, HemisphereLight, DirectionalLight, PointLight, CatmullRomCurve3, PCFShadowMap, AdditiveBlending,
  DoubleSide, SRGBColorSpace, MathUtils, ACESFilmicToneMapping, CapsuleGeometry
} from 'three';
import { contorno, EDIFICIOS, PLAZA, TORRE, ASTA, MUELLE, ISLA, ANILLO, anclas, arboles } from './plano.js';

const leerColor = (estilos, nombre, porDefecto) => {
  const valor = estilos.getPropertyValue(nombre).trim();
  return new Color(valor || porDefecto);
};

function materiales(raiz) {
  const e = getComputedStyle(raiz);
  const c = (n, d) => leerColor(e, n, d);
  return {
    papel: () => leerColor(getComputedStyle(raiz), '--papel', '#F6FAFB'),
    mar: c('--campus-mar', '#0287A8'),
    marClaro: c('--campus-mar-claro', '#00BFDC'),
    sol: c('--campus-sol', '#FFE9C7'),
    espuma: c('--campus-espuma', '#F6FAFB'),
    cadete: new MeshStandardMaterial({ color: c('--campus-cadete', '#0A2A35'), roughness: 0.8 }),
    gorra: new MeshStandardMaterial({ color: c('--campus-cadete-gorra', '#F28805'), roughness: 0.7 }),
    marHondo: c('--campus-mar-hondo', '#0A2A35'),
    marNoche: c('--campus-mar-noche', '#06222B'),
    arena: new MeshStandardMaterial({ color: c('--campus-arena', '#F6E7C8'), roughness: 0.95 }),
    tierra: new MeshStandardMaterial({ color: c('--campus-tierra', '#DDF0F4'), roughness: 0.9, side: DoubleSide }),
    pasto: new MeshStandardMaterial({ color: c('--campus-pasto', '#BFE3EA'), roughness: 0.95, side: DoubleSide }),
    acantilado: new MeshStandardMaterial({ color: c('--campus-acantilado', '#8FC3D1'), roughness: 0.9, flatShading: true }),
    camino: new MeshStandardMaterial({ color: c('--campus-camino', '#2C4A55'), roughness: 0.8, side: DoubleSide }),
    raya: new MeshBasicMaterial({ color: c('--campus-raya', '#E6F6FA') }),
    muro: new MeshStandardMaterial({ color: c('--campus-muro', '#F6FAFB'), roughness: 0.75 }),
    ventana: new MeshStandardMaterial({
      color: c('--campus-ventana', '#0A2A35'), emissive: c('--campus-ventana-luz', '#F19F05'), emissiveIntensity: 0, roughness: 0.4
    }),
    arbol: c('--campus-arbol', '#026F8A'),
    arbolClaro: c('--campus-arbol-claro', '#0287A8'),
    tronco: new MeshStandardMaterial({ color: c('--estructura', '#0A2A35'), roughness: 1 }),
    techo: (variable) => new MeshStandardMaterial({ color: c(variable, '#F28805'), roughness: 0.7, flatShading: true }),
    naranja: new MeshStandardMaterial({ color: c('--marca-5', '#F28805'), roughness: 0.6 }),
    ambar: c('--marca-4', '#F19F05'),
    blanco: new MeshStandardMaterial({ color: c('--campus-muro', '#F6FAFB'), roughness: 0.6 }),
    oscuro: new MeshStandardMaterial({ color: c('--estructura', '#0A2A35'), roughness: 0.7 })
  };
}

const enMundo = (x, y, z = 0) => new Vector3(x, z, y);

function forma(puntos) {
  const s = new Shape();
  puntos.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  return s;
}

function lamina(puntos, material, altura) {
  const g = new ShapeGeometry(forma(puntos));
  g.rotateX(Math.PI / 2);
  const m = new Mesh(g, material);
  m.position.y = altura;
  m.receiveShadow = true;
  return m;
}

function construirIsla(grupo, mat) {
  const borde = contorno(ISLA.rx, ISLA.ry);
  const roca = new ExtrudeGeometry(forma(borde), { depth: ISLA.alto + 2, bevelEnabled: true, bevelThickness: 0.4, bevelSize: 0.5, bevelSegments: 2 });
  roca.rotateX(Math.PI / 2);
  const isla = new Mesh(roca, [mat.arena, mat.acantilado]);
  isla.position.y = -0.4;
  isla.receiveShadow = true;
  grupo.add(isla);
  grupo.add(lamina(borde.map(([x, y]) => [x * 0.93, y * 0.93]), mat.tierra, 0.02));
  for (const [cx, cy, rx, ry, semilla] of [[-7, -5, 4, 3, 11], [6, -7, 4.5, 3, 12], [-8, 6, 3.5, 3, 13], [8, 7, 3, 2.6, 14], [0, 9, 4, 2, 15]]) {
    grupo.add(lamina(contorno(rx, ry, { cx, cy, n: 40, amp: 0.12, semilla }), mat.pasto, 0.03));
  }
}

function construirCamino(grupo, mat) {
  const ruta = contorno(ANILLO.rx, ANILLO.ry, { n: 90, amp: 0.04, semilla: 5 });
  const curva = new CatmullRomCurve3(ruta.map(([x, y]) => enMundo(x, y, 0.06)), true);
  const n = 240;
  const vertices = [];
  const indices = [];
  for (let i = 0; i <= n; i += 1) {
    const t = i / n;
    const p = curva.getPointAt(t % 1);
    const tg = curva.getTangentAt(t % 1);
    const lado = new Vector3(-tg.z, 0, tg.x).multiplyScalar(ANILLO.ancho / 2);
    vertices.push(p.x + lado.x, p.y, p.z + lado.z, p.x - lado.x, p.y, p.z - lado.z);
    if (i < n) indices.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  const cinta = new Mesh(g, mat.camino);
  cinta.receiveShadow = true;
  grupo.add(cinta);

  const rayas = new InstancedMesh(new BoxGeometry(0.32, 0.02, 0.06), mat.raya, 80);
  const o = new Object3D();
  for (let i = 0; i < 80; i += 1) {
    const t = i / 80;
    o.position.copy(curva.getPointAt(t)).setY(0.08);
    const tg = curva.getTangentAt(t);
    o.rotation.set(0, Math.atan2(-tg.z, tg.x), 0);
    o.updateMatrix();
    rayas.setMatrixAt(i, o.matrix);
  }
  grupo.add(rayas);

  for (const [x, y, w, d] of [[-0.35, 8.6, 0.7, 5], [10.2, -0.35, 4.6, 0.7]]) {
    const tramo = new Mesh(new BoxGeometry(w, 0.05, d), mat.camino);
    tramo.position.copy(enMundo(x + w / 2, y + d / 2, 0.06));
    tramo.receiveShadow = true;
    grupo.add(tramo);
  }
  return curva;
}

function construirPlaza(grupo, mat) {
  const p = new Mesh(new BoxGeometry(PLAZA.w, 0.04, PLAZA.d), mat.pasto);
  p.position.copy(enMundo(PLAZA.x + PLAZA.w / 2, PLAZA.y + PLAZA.d / 2, 0.05));
  p.receiveShadow = true;
  grupo.add(p);
  for (let k = 0; k <= 4; k += 1) {
    const linea = new Mesh(new BoxGeometry(0.05, 0.02, PLAZA.d), mat.raya);
    linea.position.copy(enMundo(PLAZA.x + (k * PLAZA.w) / 4, PLAZA.y + PLAZA.d / 2, 0.08));
    grupo.add(linea);
  }
  const circulo = new Mesh(new RingGeometry(1.0, 1.08, 48), mat.raya);
  circulo.rotation.x = -Math.PI / 2;
  circulo.position.copy(enMundo(0, 0, 0.08));
  grupo.add(circulo);
}

function construirEdificios(grupo, mat) {
  const ventanas = [];
  for (const e of Object.values(EDIFICIOS)) {
    const cuerpo = new Mesh(new BoxGeometry(e.w, e.h, e.d), mat.muro);
    cuerpo.position.copy(enMundo(e.x + e.w / 2, e.y + e.d / 2, e.h / 2));
    cuerpo.castShadow = true;
    cuerpo.receiveShadow = true;
    grupo.add(cuerpo);

    const perfil = new Shape();
    perfil.moveTo(-e.d / 2 - 0.15, 0);
    perfil.lineTo(e.d / 2 + 0.15, 0);
    perfil.lineTo(0, 0.95);
    perfil.closePath();
    const g = new ExtrudeGeometry(perfil, { depth: e.w + 0.3, bevelEnabled: false });
    g.rotateY(-Math.PI / 2);
    const techo = new Mesh(g, mat.techo(e.techo));
    techo.position.copy(enMundo(e.x + e.w + 0.15, e.y + e.d / 2, e.h));
    techo.castShadow = true;
    grupo.add(techo);

    const pisos = e.h > 1.6 ? [e.h * 0.32, e.h * 0.7] : [e.h * 0.5];
    const nFrente = Math.max(2, Math.floor(e.w * 1.3));
    const nLado = Math.max(1, Math.floor(e.d * 1.3));
    for (const z of pisos) {
      for (let i = 0; i < nFrente; i += 1) {
        ventanas.push([e.x + ((i + 0.5) * e.w) / nFrente, e.y + e.d + 0.01, z, 0]);
        ventanas.push([e.x + ((i + 0.5) * e.w) / nFrente, e.y - 0.01, z, 0]);
      }
      for (let i = 0; i < nLado; i += 1) {
        ventanas.push([e.x + e.w + 0.01, e.y + ((i + 0.5) * e.d) / nLado, z, 1]);
        ventanas.push([e.x - 0.01, e.y + ((i + 0.5) * e.d) / nLado, z, 1]);
      }
    }
  }
  const malla = new InstancedMesh(new BoxGeometry(0.34, 0.4, 0.04), mat.ventana, ventanas.length);
  const o = new Object3D();
  ventanas.forEach(([x, y, z, giro], i) => {
    o.position.copy(enMundo(x, y, z));
    o.rotation.set(0, giro ? Math.PI / 2 : 0, 0);
    o.updateMatrix();
    malla.setMatrixAt(i, o.matrix);
  });
  grupo.add(malla);
}

function construirArboles(grupo, mat) {
  const lista = arboles();
  const troncos = new InstancedMesh(new CylinderGeometry(0.06, 0.09, 0.7, 6), mat.tronco, lista.length);
  const copas = new InstancedMesh(new IcosahedronGeometry(0.55, 0), new MeshStandardMaterial({ roughness: 0.8, flatShading: true }), lista.length);
  troncos.castShadow = true;
  copas.castShadow = true;
  const o = new Object3D();
  const color = new Color();
  lista.forEach((a, i) => {
    o.position.copy(enMundo(a.x, a.y, 0.35 * a.escala));
    o.scale.setScalar(a.escala);
    o.rotation.set(0, a.tono * 6, 0);
    o.updateMatrix();
    troncos.setMatrixAt(i, o.matrix);
    o.position.copy(enMundo(a.x, a.y, 0.95 * a.escala));
    o.updateMatrix();
    copas.setMatrixAt(i, o.matrix);
    copas.setColorAt(i, color.copy(mat.arbol).lerp(mat.arbolClaro, a.tono));
  });
  grupo.add(troncos, copas);
}

function construirTorre(grupo, mat) {
  const torre = new Group();
  const tramos = 4;
  for (let i = 0; i < tramos; i += 1) {
    const alto = TORRE.h / tramos;
    const t = new Mesh(new CylinderGeometry(0.42 - i * 0.03, 0.45 - i * 0.03, alto, 16), i % 2 ? mat.naranja : mat.blanco);
    t.position.y = alto * i + alto / 2;
    t.castShadow = true;
    torre.add(t);
  }
  const cupula = new Mesh(new CylinderGeometry(0.5, 0.5, 0.18, 16), mat.oscuro);
  cupula.position.y = TORRE.h + 0.1;
  torre.add(cupula);
  const foco = new Mesh(new SphereGeometry(0.2, 16, 12), new MeshBasicMaterial({ color: mat.ambar }));
  foco.position.y = TORRE.h + 0.38;
  torre.add(foco);
  const haz = new Group();
  const cono = new Mesh(new ConeGeometry(1.2, 13, 24, 1, true), new MeshBasicMaterial({
    color: mat.ambar, transparent: true, opacity: 0.1, blending: AdditiveBlending, depthWrite: false, side: DoubleSide
  }));
  cono.rotation.z = Math.PI / 2 - 0.12;
  cono.position.set(6.5, -0.4, 0);
  haz.add(cono);
  haz.position.y = TORRE.h + 0.38;
  torre.add(haz);
  const luz = new PointLight(mat.ambar, 0, 18, 1.6);
  luz.position.y = TORRE.h + 0.5;
  torre.add(luz);
  torre.position.copy(enMundo(TORRE.x, TORRE.y, 0));
  grupo.add(torre);
  return { haz, cono, luz, foco };
}

function construirBandera(grupo, mat) {
  const asta = new Mesh(new CylinderGeometry(0.04, 0.05, ASTA.h, 8), mat.oscuro);
  asta.position.copy(enMundo(ASTA.x, ASTA.y, ASTA.h / 2));
  asta.castShadow = true;
  grupo.add(asta);
  const tela = new Mesh(new PlaneGeometry(1.5, 0.85, 14, 4), new MeshStandardMaterial({ color: mat.naranja.color, side: DoubleSide, roughness: 0.7 }));
  tela.geometry.translate(0.75, 0, 0);
  tela.position.copy(enMundo(ASTA.x, ASTA.y, ASTA.h - 0.5));
  tela.rotation.y = -Math.PI / 4;
  tela.castShadow = true;
  grupo.add(tela);
  return tela;
}

function construirMuelleYBarco(grupo, mat) {
  const muelle = new Mesh(new BoxGeometry(MUELLE.w, 0.15, MUELLE.d), new MeshStandardMaterial({ color: mat.ambar, roughness: 0.9 }));
  muelle.position.copy(enMundo(MUELLE.x + MUELLE.w / 2, MUELLE.y + MUELLE.d / 2, -0.1));
  muelle.castShadow = true;
  grupo.add(muelle);
  const barco = new Group();
  const casco = new Mesh(new BoxGeometry(1.6, 0.35, 0.6), mat.blanco);
  const cabina = new Mesh(new BoxGeometry(0.5, 0.35, 0.45), mat.naranja);
  cabina.position.set(-0.2, 0.33, 0);
  casco.castShadow = true;
  barco.add(casco, cabina);
  grupo.add(barco);
  return barco;
}

function construirVehiculos(grupo, mat) {
  const colores = [mat.naranja, mat.blanco, mat.techo('--marca-1')];
  const faroMat = new MeshBasicMaterial({ color: mat.ambar });
  return colores.map((material, i) => {
    const v = new Group();
    const cuerpo = new Mesh(new BoxGeometry(0.62, 0.22, 0.32), material);
    cuerpo.position.y = 0.16;
    const cabina = new Mesh(new BoxGeometry(0.3, 0.16, 0.28), mat.oscuro);
    cabina.position.set(-0.04, 0.33, 0);
    const faros = new Mesh(new BoxGeometry(0.03, 0.06, 0.26), faroMat);
    faros.position.set(0.32, 0.18, 0);
    cuerpo.castShadow = true;
    v.add(cuerpo, cabina, faros);
    grupo.add(v);
    return { v, desfase: i / 3, faros };
  });
}

function construirAves(grupo, mat) {
  const ala = new PlaneGeometry(0.45, 0.12);
  ala.translate(0.22, 0, 0);
  const material = new MeshBasicMaterial({ color: mat.raya.color, side: DoubleSide });
  return [0, 1, 2].map((i) => {
    const ave = new Group();
    const izq = new Mesh(ala, material);
    const der = new Mesh(ala, material);
    der.rotation.y = Math.PI;
    ave.add(izq, der);
    grupo.add(ave);
    return { ave, izq, der, fase: i * 2.1 };
  });
}

function construirMar(grupo, mat) {
  const g = new PlaneGeometry(260, 260, 110, 110);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  const colores = new Float32Array(pos.count * 3);
  const c = new Color();
  for (let i = 0; i < pos.count; i += 1) {
    const d = Math.hypot(pos.getX(i) / 1.1, pos.getZ(i));
    const cerca = MathUtils.smoothstep(d, 15, 30);
    c.copy(mat.marClaro).lerp(mat.mar, cerca).lerp(mat.marHondo, MathUtils.smoothstep(d, 30, 80));
    c.toArray(colores, i * 3);
  }
  g.setAttribute('color', new Float32BufferAttribute(colores, 3));
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.15, flatShading: true });
  const mar = new Mesh(g, material);
  mar.position.y = -0.55;
  mar.receiveShadow = true;
  grupo.add(mar);
  return { mar, base: Float32Array.from(pos.array), material };
}

function construirEspuma(grupo, mat) {
  const borde = contorno(ISLA.rx, ISLA.ry);
  const exterior = forma(borde.map(([x, y]) => [x * 1.07, y * 1.07]));
  exterior.holes.push(forma(borde.map(([x, y]) => [x * 1.005, y * 1.005]).reverse()));
  const g = new ShapeGeometry(exterior);
  g.rotateX(Math.PI / 2);
  const espuma = new Mesh(g, new MeshBasicMaterial({ color: mat.espuma, transparent: true, opacity: 0.55, side: DoubleSide, depthWrite: false }));
  espuma.position.y = -0.38;
  grupo.add(espuma);
  return espuma;
}

function construirCadetes(grupo, mat) {
  const filas = 3;
  const columnas = 6;
  const cuerpos = new InstancedMesh(new CapsuleGeometry(0.11, 0.32, 3, 8), mat.cadete, filas * columnas);
  const gorras = new InstancedMesh(new CylinderGeometry(0.1, 0.1, 0.07, 10), mat.gorra, filas * columnas);
  cuerpos.castShadow = true;
  grupo.add(cuerpos, gorras);
  return { cuerpos, gorras, filas, columnas };
}

function moverCadetes({ cuerpos, gorras, filas, columnas }, t) {
  const o = new Object3D();
  const ciclo = (t / 9) % 2;
  const avance = ciclo < 1 ? ciclo : 2 - ciclo;
  const suave = avance * avance * (3 - 2 * avance);
  const x0 = PLAZA.x + 1.2 + suave * (PLAZA.w - 4.4);
  const sentido = ciclo < 1 ? 0 : Math.PI;
  let i = 0;
  for (let f = 0; f < filas; f += 1) {
    for (let c = 0; c < columnas; c += 1) {
      const paso = Math.abs(Math.sin(t * 6 + c * 0.4)) * 0.05;
      const x = x0 + c * 0.42;
      const y = PLAZA.y + 1.4 + f * 0.75;
      o.position.copy(enMundo(x, y, 0.27 + paso));
      o.rotation.set(0, sentido, 0);
      o.updateMatrix();
      cuerpos.setMatrixAt(i, o.matrix);
      o.position.copy(enMundo(x, y, 0.55 + paso));
      o.updateMatrix();
      gorras.setMatrixAt(i, o.matrix);
      i += 1;
    }
  }
  cuerpos.instanceMatrix.needsUpdate = true;
  gorras.instanceMatrix.needsUpdate = true;
}

function ordenarEtiquetas(marcas) {
  const ocupados = [];
  const visibles = [...marcas].sort((a, b) => a.y - b.y);
  for (const m of visibles) {
    const ancho = m.anchoCompleto || 120;
    const caja = { x1: m.x - ancho / 2, x2: m.x + ancho / 2, y1: m.y - 30 - 30, y2: m.y - 30 };
    const choca = ocupados.some((o) => caja.x1 < o.x2 + 6 && caja.x2 > o.x1 - 6 && caja.y1 < o.y2 + 4 && caja.y2 > o.y1 - 4);
    if (choca !== m.compacto) {
      m.compacto = choca;
      m.el.classList.toggle('punto-compacto', choca);
    }
    ocupados.push(choca ? { x1: m.x - 16, x2: m.x + 16, y1: caja.y1, y2: caja.y2 } : caja);
  }
}

export function iniciarCampus3D(contenedor, { raiz = document.documentElement, puntos = [] } = {}) {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.className = 'campus-3d';
  renderer.domElement.setAttribute('aria-hidden', 'true');
  contenedor.appendChild(renderer.domElement);

  const mat = materiales(raiz);
  const escena = new Scene();
  escena.fog = new Fog(mat.papel(), 70, 150);

  const camara = new PerspectiveCamera(26, 1, 1, 400);
  const cielo = new HemisphereLight(0xffffff, mat.acantilado.color, 1.3);
  const sol = new DirectionalLight(mat.sol, 2.6);
  sol.position.set(-22, 38, 14);
  sol.castShadow = true;
  sol.shadow.mapSize.set(2048, 2048);
  Object.assign(sol.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 100 });
  sol.shadow.bias = -0.0008;
  escena.add(cielo, sol);

  if (['localhost', '127.0.0.1'].includes(window.location.hostname)) {
    window.scene = escena;
    window.__renderer__ = renderer;
  }

  const mundo = new Group();
  escena.add(mundo);
  const mar = construirMar(mundo, mat);
  construirIsla(mundo, mat);
  const curva = construirCamino(mundo, mat);
  construirPlaza(mundo, mat);
  construirEdificios(mundo, mat);
  construirArboles(mundo, mat);
  const torre = construirTorre(mundo, mat);
  const bandera = construirBandera(mundo, mat);
  const banderaBase = Float32Array.from(bandera.geometry.attributes.position.array);
  const barco = construirMuelleYBarco(mundo, mat);
  const vehiculos = construirVehiculos(mundo, mat);
  const aves = construirAves(mundo, mat);
  const espuma = construirEspuma(mundo, mat);
  const cadetes = construirCadetes(mundo, mat);

  const anclaje = anclas();
  const marcas = puntos
    .filter((el) => anclaje[el.dataset.punto])
    .map((el) => {
      const [x, altura, y] = anclaje[el.dataset.punto];
      return { el, ancla: enMundo(x, y, altura), anchoCompleto: el.offsetWidth, compacto: false, x: 0, y: 0 };
    });

  const objetivo = new Vector3(0.5, 0, 0.5);
  const puntero = { x: 0, y: 0, ax: 0, ay: 0 };
  contenedor.ownerDocument.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    puntero.x = e.clientX / window.innerWidth - 0.5;
    puntero.y = e.clientY / window.innerHeight - 0.5;
  });

  let ancho = 0;
  let alto = 0;
  const ajustar = () => {
    ancho = contenedor.clientWidth;
    alto = contenedor.clientHeight;
    if (!ancho || !alto) return;
    renderer.setSize(ancho, alto, false);
    camara.aspect = ancho / alto;
    camara.updateProjectionMatrix();
  };
  new ResizeObserver(ajustar).observe(contenedor);
  ajustar();

  let noche = raiz.hasAttribute('data-noche') ? 1 : 0;
  let nocheObjetivo = noche;
  const nieblaDia = mat.papel();
  new MutationObserver(() => {
    nocheObjetivo = raiz.hasAttribute('data-noche') ? 1 : 0;
    escena.fog.color.copy(mat.papel());
    nieblaDia.copy(escena.fog.color);
  }).observe(raiz, { attributes: true, attributeFilter: ['data-noche'] });

  const inicio = performance.now();
  const ancla2d = new Vector3();
  let detenido = false;

  function cuadro(ahora) {
    if (detenido) return;
    requestAnimationFrame(cuadro);
    if (!contenedor.offsetParent || !ancho) return;
    const t = Math.max(0, (ahora - inicio) / 1000);

    noche += (nocheObjetivo - noche) * 0.05;
    cielo.intensity = MathUtils.lerp(1.3, 0.25, noche);
    sol.intensity = MathUtils.lerp(2.6, 0.35, noche);
    sol.color.copy(mat.sol).lerp(mat.arbolClaro, noche * 0.7);
    mat.ventana.emissiveIntensity = MathUtils.lerp(0, 1.8, noche);
    torre.cono.material.opacity = MathUtils.lerp(0.05, 0.22, noche);
    torre.luz.intensity = MathUtils.lerp(0, 40, noche);
    mar.material.color.setRGB(1, 1, 1).lerp(mat.marNoche, noche * 0.75);

    const llegada = 1 - (1 - Math.min(1, t / 3.2)) ** 3;
    puntero.ax += (puntero.x - puntero.ax) * 0.04;
    puntero.ay += (puntero.y - puntero.ay) * 0.04;
    const azimut = MathUtils.degToRad(45 + Math.sin(t * 0.08) * 6 + puntero.ax * 10 - (1 - llegada) * 25);
    const elevacion = MathUtils.degToRad(34 + Math.sin(t * 0.11) * 1.5 - puntero.ay * 5 + (1 - llegada) * 18);
    const distancia = (camara.aspect < 1 ? 80 : 74) * (1 + (1 - llegada) * 0.5);
    camara.position.set(
      objetivo.x + distancia * Math.cos(elevacion) * Math.sin(azimut),
      objetivo.y + distancia * Math.sin(elevacion),
      objetivo.z + distancia * Math.cos(elevacion) * Math.cos(azimut)
    );
    camara.lookAt(objetivo);
    escena.fog.near = distancia + 14;
    escena.fog.far = distancia + 95;

    const pos = mar.mar.geometry.attributes.position;
    for (let i = 0; i < pos.count; i += 1) {
      const x = mar.base[i * 3];
      const z = mar.base[i * 3 + 2];
      pos.setY(i, Math.sin(x * 0.18 + t * 0.9) * 0.16 + Math.cos(z * 0.21 + t * 0.7) * 0.14);
    }
    pos.needsUpdate = true;
    mar.mar.geometry.computeVertexNormals();

    const bp = bandera.geometry.attributes.position;
    for (let i = 0; i < bp.count; i += 1) {
      const x = banderaBase[i * 3];
      bp.setZ(i, Math.sin(x * 4 - t * 6) * 0.12 * x);
    }
    bp.needsUpdate = true;

    torre.haz.rotation.y = 1.4 + Math.sin(t * 0.35) * 1.2;
    espuma.material.opacity = 0.35 + Math.sin(t * 1.1) * 0.2;
    espuma.scale.setScalar(1 + Math.sin(t * 1.1) * 0.006);
    moverCadetes(cadetes, t);

    vehiculos.forEach(({ v, desfase }) => {
      const u = (((t / 30 + desfase) % 1) + 1) % 1;
      v.position.copy(curva.getPointAt(u));
      const tg = curva.getTangentAt(u);
      v.rotation.y = Math.atan2(-tg.z, tg.x);
    });

    const ab = t * 0.05;
    barco.position.set(Math.cos(ab) * 24, -0.35 + Math.sin(t * 1.2) * 0.08, Math.sin(ab) * 20);
    barco.rotation.y = -ab - Math.PI / 2;

    aves.forEach(({ ave, izq, der, fase }) => {
      const a = t * 0.12 + fase;
      ave.position.set(Math.cos(a) * 18, 7 + Math.sin(t * 0.5 + fase) * 0.6, Math.sin(a) * 14);
      ave.rotation.y = -a;
      const aleteo = Math.sin(t * 7 + fase) * 0.6;
      izq.rotation.z = aleteo;
      der.rotation.z = -aleteo;
    });

    renderer.render(escena, camara);

    for (const m of marcas) {
      ancla2d.copy(m.ancla).project(camara);
      m.x = ((ancla2d.x + 1) / 2) * ancho;
      m.y = ((1 - ancla2d.y) / 2) * alto;
      m.el.style.left = `${m.x}px`;
      m.el.style.top = `${m.y}px`;
    }
    ordenarEtiquetas(marcas);
  }
  requestAnimationFrame(cuadro);

  return { detener: () => { detenido = true; renderer.dispose(); } };
}
