(function (raiz) {
  'use strict';

  const TIPOS = ['click', 'change', 'input', 'submit'];
  const NOMBRE = /^[A-Za-z_$][\w$]*$/;
  const PROHIBIDAS = new Set([
    'eval', 'Function', 'setTimeout', 'setInterval', 'setImmediate', 'fetch', 'open', 'alert', 'confirm',
    'prompt', 'importScripts', 'XMLHttpRequest', 'WebSocket', 'require', 'import'
  ]);

  function dividir(texto, separador) {
    const partes = [];
    let actual = '';
    let enTexto = false;
    for (let i = 0; i < texto.length; i += 1) {
      const c = texto[i];
      if (enTexto && c === '\\' && i + 1 < texto.length) {
        actual += c + texto[i + 1];
        i += 1;
        continue;
      }
      if (c === "'") enTexto = !enTexto;
      if (c === separador && !enTexto) {
        partes.push(actual);
        actual = '';
      } else {
        actual += c;
      }
    }
    if (enTexto) throw new Error('Comillas sin cerrar.');
    partes.push(actual);
    return partes;
  }

  function leerArgumento(token) {
    const t = token.trim();
    if (/^'(?:[^'\\]|\\.)*'$/.test(t)) return { tipo: 'texto', valor: t.slice(1, -1).replace(/\\(.)/g, '$1') };
    if (/^-?\d+(\.\d+)?$/.test(t)) return { tipo: 'texto', valor: Number(t) };
    if (t === 'true') return { tipo: 'texto', valor: true };
    if (t === 'false') return { tipo: 'texto', valor: false };
    if (t === 'null') return { tipo: 'texto', valor: null };
    if (t === 'event' || t === 'this' || t === 'this.value') return { tipo: t };
    const dato = /^this\.dataset\.([A-Za-z_]\w*)$/.exec(t);
    if (dato) return { tipo: 'dataset', campo: dato[1] };
    throw new Error(`Argumento no permitido: ${t}`);
  }

  function analizar(texto) {
    return dividir(String(texto), ';')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((sentencia) => {
        const m = /^([A-Za-z_$][\w$]*)\(([\s\S]*)\)$/.exec(sentencia);
        if (!m || !NOMBRE.test(m[1]) || PROHIBIDAS.has(m[1])) throw new Error(`Llamada no permitida: ${sentencia}`);
        const crudo = m[2].trim();
        return { nombre: m[1], argumentos: crudo === '' ? [] : dividir(crudo, ',').map(leerArgumento) };
      });
  }

  function crearDespachador(global) {
    const cache = new Map();

    function ejecutar(texto, elemento, evento) {
      let llamadas = cache.get(texto);
      if (!llamadas) {
        llamadas = analizar(texto);
        cache.set(texto, llamadas);
      }
      llamadas.forEach(({ nombre, argumentos }) => {
        const funcion = global[nombre];
        if (typeof funcion !== 'function') throw new Error(`No existe la funcion ${nombre}.`);
        const valores = argumentos.map((a) => {
          if (a.tipo === 'texto') return a.valor;
          if (a.tipo === 'event') return evento;
          if (a.tipo === 'this') return elemento;
          if (a.tipo === 'this.value') return elemento.value;
          return elemento.dataset ? elemento.dataset[a.campo] : undefined;
        });
        funcion.apply(global, valores);
      });
    }

    function alEvento(tipo, evento) {
      const atributo = `data-on-${tipo}`;
      let elemento = evento.target && evento.target.nodeType === 1 ? evento.target : null;
      while (elemento && elemento.getAttribute) {
        const texto = elemento.getAttribute(atributo);
        if (texto) {
          try {
            ejecutar(texto, elemento, evento);
          } catch (error) {
            console.error('[ESOE-SMS] Evento no ejecutado:', error.message);
          }
          if (evento.cancelBubble) break;
        }
        elemento = elemento.parentElement;
      }
    }

    function instalar(documento) {
      TIPOS.forEach((tipo) => documento.addEventListener(tipo, (evento) => alEvento(tipo, evento)));
    }

    return { ejecutar, instalar };
  }

  const exportado = { analizar, crearDespachador, TIPOS };
  if (typeof module !== 'undefined' && module.exports) module.exports = exportado;
  if (typeof document !== 'undefined') crearDespachador(raiz).instalar(document);
})(typeof window !== 'undefined' ? window : globalThis);
