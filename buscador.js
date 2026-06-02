/**
 * Buscador interno · Educación Cívica
 * Sin dependencias externas. JS puro.
 *
 * - Carga el índice JSON (busqueda-indice.json) una sola vez en memoria
 * - Tokeniza el query y los documentos
 * - Score multi-campo: título > h1 > eyebrow > descripción > sección H2 > snippet
 * - Soporte para coincidencia exacta, prefijo y substring
 * - Filtros por categoría
 * - Debounce de 150ms
 * - Highlighting con <mark>
 * - Lectura de query param ?q= al cargar
 * - Atajos: Esc para limpiar, Enter para abrir primer resultado
 * - Persistencia mínima del filtro de categoría en sessionStorage
 */

(function() {
  'use strict';

  // ============================================================
  // ESTADO GLOBAL
  // ============================================================
  const STATE = {
    indice: null,         // Datos del índice JSON
    cargando: true,       // Mientras se descarga el índice
    error: null,          // Si fallo la carga
    query: '',            // Query actual
    catFiltro: '',        // Categoría activa ('' = todo)
    debounceTimer: null,  // Timer del debounce
    ultimaBusqueda: 0,    // Timestamp última búsqueda (para evitar races)
    resultados: [],       // Últimos resultados
  };

  // Labels para categorías
  const CAT_LABELS = {
    'fundamentos': 'Fundamentos',
    'elecciones': 'Elecciones',
    'historia': 'Historia',
    'caba': 'CABA',
    'buenos-aires': 'Buenos Aires',
    'cordoba': 'Córdoba',
    'santa-fe': 'Santa Fe',
    'mendoza': 'Mendoza',
    'provincias': 'Provincias',
    'inicio': 'Inicio'
  };

  // ============================================================
  // REFERENCIAS DOM
  // ============================================================
  const $input = document.getElementById('busqueda-input');
  const $clear = document.getElementById('busqueda-clear');
  const $filtros = document.getElementById('filtros-cat');
  const $resultadosContainer = document.getElementById('resultados-container');
  const $resultadosMeta = document.getElementById('resultados-meta');
  const $resultadosCount = document.getElementById('resultados-count');
  const $resultadosTiempo = document.getElementById('resultados-tiempo');
  const $estadoInicial = document.getElementById('estado-inicial');

  // ============================================================
  // UTILS · NORMALIZACIÓN Y TOKENIZACIÓN
  // ============================================================

  /**
   * Normaliza texto: lowercase + sin diacríticos + sin caracteres especiales
   * "Córdoba" → "cordoba"
   * "D'Hondt" → "dhondt"  (apóstrofe eliminado)
   */
  function normalizar(s) {
    if (!s) return '';
    return s.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quita acentos
      .replace(/[''"`´]/g, '')  // quita apóstrofes y comillas
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Tokeniza un texto: lo divide en palabras significativas
   * Ignora palabras muy cortas (1 char) y conectores comunes
   */
  const STOPWORDS = new Set([
    'a', 'al', 'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas',
    'de', 'del', 'en', 'y', 'o', 'u', 'pero', 'que', 'se', 'su', 'sus',
    'lo', 'le', 'les', 'no', 'es', 'son', 'fue', 'fueron', 'ser', 'sido',
    'con', 'por', 'para', 'sin', 'sobre', 'entre', 'ante', 'hacia',
    'hasta', 'durante', 'mediante', 'según', 'tras', 'desde'
  ]);

  function tokenizar(s, mantenerCortas) {
    const norm = normalizar(s);
    return norm.split(/[^a-z0-9]+/).filter(t => {
      if (!t) return false;
      if (!mantenerCortas && t.length < 2) return false;
      if (STOPWORDS.has(t)) return false;
      return true;
    });
  }

  // ============================================================
  // CARGA DEL ÍNDICE
  // ============================================================

  async function cargarIndice() {
    try {
      const resp = await fetch('busqueda-indice.json');
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const datos = await resp.json();
      STATE.indice = datos;
      STATE.cargando = false;

      // Cachear texto normalizado de cada doc para no recalcular cada keystroke
      datos.docs.forEach(d => {
        d._norm = {
          t: normalizar(d.t),
          h: normalizar(d.h),
          e: normalizar(d.e),
          d: normalizar(d.d),
          u: normalizar(d.u.replace('.html', '').replace(/-/g, ' '))
        };
        // Pre-normalizar las secs
        if (d.secs) {
          d.secs.forEach(sec => {
            sec._normT = normalizar(sec.t);
            sec._normS = normalizar(sec.s);
          });
        }
      });

      // Actualizar contadores en filtros
      actualizarContadoresFiltros();

      // Si llegamos con ?q=algo en la URL, ejecutar la búsqueda
      const urlParams = new URLSearchParams(window.location.search);
      const qInicial = urlParams.get('q');
      if (qInicial) {
        $input.value = qInicial;
        STATE.query = qInicial;
        $clear.classList.add('visible');
        buscarYRender();
      }

      // Si había un filtro de categoría guardado, restaurarlo
      try {
        const catGuardada = sessionStorage.getItem('busqueda-cat');
        if (catGuardada && CAT_LABELS[catGuardada]) {
          activarFiltro(catGuardada);
        }
      } catch(e) { /* sessionStorage puede fallar en private */ }

      // Focus en el input al cargar (mejora UX)
      if (!qInicial) {
        $input.focus();
      }
    } catch (err) {
      console.error('Error cargando índice:', err);
      STATE.cargando = false;
      STATE.error = err;
      mostrarError();
    }
  }

  function actualizarContadoresFiltros() {
    if (!STATE.indice) return;
    const cats = STATE.indice.categorias || {};
    document.querySelectorAll('[data-count]').forEach(span => {
      const cat = span.dataset.count;
      const n = cats[cat] || 0;
      if (n > 0) {
        span.textContent = ' · ' + n;
      }
    });
  }

  function mostrarError() {
    $resultadosContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">⚠</div>
        <div class="empty-state-titulo">No se pudo cargar el índice</div>
        <p class="empty-state-desc">Hubo un problema al descargar el índice de búsqueda. Probá recargar la página o navegar directamente a las secciones del sitio.</p>
      </div>
    `;
    $estadoInicial.style.display = 'none';
  }

  // ============================================================
  // SCORING · cómo se calcula la relevancia de un doc para un query
  // ============================================================

  /**
   * Calcula score de un documento contra los tokens del query.
   * Devuelve { score, matches: { campo, posicion, longitud } }
   *
   * Reglas:
   * - Coincidencia exacta del query completo en título: +500
   * - Coincidencia exacta en H1: +400
   * - Coincidencia exacta en sección H2: +350 (devuelve la sección)
   * - Cada token encontrado en título: +100 (+50 si es prefijo de palabra)
   * - Cada token encontrado en H1: +80
   * - Cada token encontrado en eyebrow: +60
   * - Cada token encontrado en descripción: +40
   * - Cada token encontrado en título de sección: +50
   * - Cada token encontrado en snippet de sección: +20
   * - Cada token encontrado en URL slug: +30
   * - Bonus: si TODOS los tokens están en el mismo doc: +100
   * - Bonus: si los tokens aparecen contiguos: +200
   */
  function calcularScore(doc, queryNorm, tokens) {
    let score = 0;
    let matchedTokens = 0;
    let seccionMatch = null; // La sección H2 que mejor matchea (si hay)
    let mejorScoreSeccion = 0;

    // 1. Coincidencia exacta del query completo
    if (queryNorm.length >= 2) {
      if (doc._norm.t.includes(queryNorm)) score += 500;
      if (doc._norm.h.includes(queryNorm)) score += 400;

      // Búsqueda en secciones H2
      if (doc.secs) {
        for (const sec of doc.secs) {
          let scoreSec = 0;
          if (sec._normT.includes(queryNorm)) scoreSec += 350;
          if (sec._normS.includes(queryNorm)) scoreSec += 150;

          // Por cada token también
          for (const tok of tokens) {
            if (sec._normT.includes(tok)) {
              scoreSec += 50;
              if (sec._normT.split(/\s+/).some(w => w.startsWith(tok))) {
                scoreSec += 30; // bonus prefijo
              }
            }
            if (sec._normS.includes(tok)) scoreSec += 20;
          }

          if (scoreSec > mejorScoreSeccion) {
            mejorScoreSeccion = scoreSec;
            seccionMatch = sec;
          }
          score += scoreSec;
        }
      }

      // Si el query exacto está en descripción: +200
      if (doc._norm.d.includes(queryNorm)) score += 200;
      // En URL: +150 (para búsquedas tipo "cordoba" o "mendoza")
      if (doc._norm.u.includes(queryNorm)) score += 150;
    }

    // 2. Score por token
    for (const tok of tokens) {
      let tokenEncontrado = false;

      // Token en título
      if (doc._norm.t.includes(tok)) {
        score += 100;
        tokenEncontrado = true;
        // Bonus si es prefijo de palabra (no en medio de otra)
        if (doc._norm.t.split(/\s+/).some(w => w.startsWith(tok))) {
          score += 50;
        }
      }
      // Token en H1
      if (doc._norm.h.includes(tok)) {
        score += 80;
        tokenEncontrado = true;
      }
      // Token en eyebrow
      if (doc._norm.e.includes(tok)) {
        score += 60;
        tokenEncontrado = true;
      }
      // Token en descripción
      if (doc._norm.d.includes(tok)) {
        score += 40;
        tokenEncontrado = true;
      }
      // Token en URL slug
      if (doc._norm.u.includes(tok)) {
        score += 30;
        tokenEncontrado = true;
      }

      if (tokenEncontrado) matchedTokens++;
    }

    // 3. Bonus si todos los tokens fueron encontrados
    if (tokens.length > 1 && matchedTokens === tokens.length) {
      score += 100;
    }

    // 4. Bonus si los tokens aparecen contiguos en algún campo (frase)
    if (tokens.length > 1) {
      const fraseEsperada = tokens.join(' ');
      if (doc._norm.t.includes(fraseEsperada)) score += 200;
      else if (doc._norm.h.includes(fraseEsperada)) score += 150;
      else if (doc._norm.d.includes(fraseEsperada)) score += 100;
    }

    return { score, matchedTokens, seccionMatch };
  }

  // ============================================================
  // BÚSQUEDA · función principal
  // ============================================================

  function buscar(query, catFiltro) {
    const queryNorm = normalizar(query);
    if (!queryNorm) return [];

    const tokens = tokenizar(query, true);
    if (tokens.length === 0) return [];

    const inicio = performance.now();

    const candidatos = [];
    for (const doc of STATE.indice.docs) {
      // Filtro por categoría si está activo
      if (catFiltro && doc.c !== catFiltro) continue;

      const r = calcularScore(doc, queryNorm, tokens);
      if (r.score > 0) {
        candidatos.push({
          doc,
          score: r.score,
          seccion: r.seccionMatch
        });
      }
    }

    // Ordenar por score descendente
    candidatos.sort((a, b) => b.score - a.score);

    const fin = performance.now();
    STATE.tiempoBusqueda = (fin - inicio).toFixed(1);

    // Limitar a primeros 50 resultados (más sería overload visual)
    return candidatos.slice(0, 50);
  }

  // ============================================================
  // RENDER · pintar los resultados
  // ============================================================

  /**
   * Escapa HTML peligroso del texto del índice
   */
  function escapeHTML(s) {
    if (!s) return '';
    return s.replace(/[&<>"']/g, c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[c]);
  }

  /**
   * Resalta los matches del query en un texto usando <mark>
   * Función case/diacritic-insensitive (busca normalizando pero conserva original)
   */
  function highlight(texto, queryNorm, tokens) {
    if (!texto) return '';
    if (!queryNorm) return escapeHTML(texto);

    // Estrategia: vamos a marcar:
    // 1. La frase completa del query (si aparece)
    // 2. Cada token individual
    // Construimos un patrón regex con todos los términos a marcar

    const terminos = [...tokens];
    // Agregar el query completo como primer término (prioridad)
    if (queryNorm.length > 3 && !terminos.includes(queryNorm)) {
      terminos.unshift(queryNorm);
    }

    // Construir un regex que matchee versiones con o sin acentos del texto original
    // Estrategia: por cada caracter del término, generar [variantes]
    function termRegex(t) {
      // No usamos boundaries porque queremos matchear partes de palabras también
      // (ej: "elec" debe encontrar "electoral")
      const variantes = {
        'a': '[aáàäâ]', 'e': '[eéèëê]', 'i': '[iíìïî]',
        'o': '[oóòöô]', 'u': '[uúùüû]', 'n': '[nñ]',
        'c': '[cç]'
      };
      let r = '';
      for (const ch of t) {
        if (variantes[ch]) r += variantes[ch];
        else if (/[a-z0-9]/i.test(ch)) r += ch;
        else r += '\\' + ch;
      }
      return r;
    }

    // Ordenar por longitud descendente para que matchee primero los términos más largos
    terminos.sort((a, b) => b.length - a.length);

    const pattern = '(' + terminos.map(termRegex).join('|') + ')';
    const re = new RegExp(pattern, 'gi');

    // Reemplazar con <mark> pero respetando el escape
    const partes = [];
    let lastIdx = 0;
    let match;
    re.lastIndex = 0;
    while ((match = re.exec(texto)) !== null) {
      // Texto antes del match
      partes.push(escapeHTML(texto.slice(lastIdx, match.index)));
      partes.push('<mark>' + escapeHTML(match[0]) + '</mark>');
      lastIdx = match.index + match[0].length;
      // Protección contra loops infinitos en regex con grupo opcional
      if (match[0].length === 0) re.lastIndex++;
    }
    partes.push(escapeHTML(texto.slice(lastIdx)));
    return partes.join('');
  }

  /**
   * Trunca un snippet centrándolo en la primera coincidencia
   */
  function snippetCentrado(texto, queryNorm, tokens, maxLen = 220) {
    if (!texto) return '';
    if (texto.length <= maxLen) return texto;

    // Buscar primera coincidencia (normalizada)
    const textoNorm = normalizar(texto);
    let idx = -1;
    if (queryNorm && (idx = textoNorm.indexOf(queryNorm)) !== -1) {
      // OK, tenemos posición
    } else {
      // Probar con cada token
      for (const tok of tokens) {
        const i = textoNorm.indexOf(tok);
        if (i !== -1) { idx = i; break; }
      }
    }

    if (idx === -1) {
      return texto.slice(0, maxLen) + '…';
    }

    // Centrar en la coincidencia con un margen previo de ~60 chars
    const margenPrev = Math.min(60, idx);
    const inicio = Math.max(0, idx - margenPrev);
    const fin = Math.min(texto.length, inicio + maxLen);
    let snippet = texto.slice(inicio, fin);
    if (inicio > 0) snippet = '…' + snippet;
    if (fin < texto.length) snippet = snippet + '…';
    return snippet;
  }

  function renderResultado(item, queryNorm, tokens) {
    const d = item.doc;
    const sec = item.seccion;
    const cat = d.c;
    const catLabel = CAT_LABELS[cat] || cat;

    let html = `<a href="${escapeHTML(d.u)}" class="resultado" data-cat="${escapeHTML(cat)}">`;
    html += '<div class="resultado-header">';
    html += `<span class="resultado-cat">${escapeHTML(catLabel)}</span>`;
    if (d.e) {
      html += `<span class="resultado-eyebrow">${highlight(d.e, queryNorm, tokens)}</span>`;
    }
    html += '</div>';

    html += `<div class="resultado-titulo">${highlight(d.t, queryNorm, tokens)}</div>`;

    if (d.d) {
      const descCorto = snippetCentrado(d.d, queryNorm, tokens, 260);
      html += `<div class="resultado-desc">${highlight(descCorto, queryNorm, tokens)}</div>`;
    }

    // Si la mejor coincidencia es en una sección H2 específica, mostrarla
    if (sec) {
      const snip = snippetCentrado(sec.s, queryNorm, tokens, 200);
      html += '<div class="resultado-seccion">';
      html += '<div class="resultado-seccion-label">— Sección que coincide</div>';
      html += `<div class="resultado-seccion-titulo">${highlight(sec.t, queryNorm, tokens)}</div>`;
      html += `<div class="resultado-seccion-snippet">${highlight(snip, queryNorm, tokens)}</div>`;
      html += '</div>';
    }

    html += '<div class="resultado-footer">';
    html += `<span class="resultado-url">${escapeHTML(d.u)}</span>`;
    html += '<span class="resultado-arrow">Abrir →</span>';
    html += '</div>';
    html += '</a>';
    return html;
  }

  function buscarYRender() {
    if (!STATE.indice) return;

    const query = STATE.query;
    if (!query || query.length < 2) {
      // Volvemos al estado inicial
      $resultadosMeta.style.display = 'none';
      $resultadosContainer.innerHTML = '';
      $estadoInicial.style.display = 'block';
      return;
    }

    $estadoInicial.style.display = 'none';

    const queryNorm = normalizar(query);
    const tokens = tokenizar(query, true);

    STATE.resultados = buscar(query, STATE.catFiltro);

    // Render meta
    $resultadosMeta.style.display = 'flex';
    const n = STATE.resultados.length;
    const catText = STATE.catFiltro ? ` en ${CAT_LABELS[STATE.catFiltro]}` : '';
    if (n === 0) {
      $resultadosCount.innerHTML = `Sin resultados para <strong>"${escapeHTML(query)}"</strong>${catText}`;
    } else if (n === 1) {
      $resultadosCount.innerHTML = `<strong>1</strong> resultado para "${escapeHTML(query)}"${catText}`;
    } else if (n >= 50) {
      $resultadosCount.innerHTML = `<strong>50+</strong> resultados para "${escapeHTML(query)}"${catText}`;
    } else {
      $resultadosCount.innerHTML = `<strong>${n}</strong> resultados para "${escapeHTML(query)}"${catText}`;
    }
    $resultadosTiempo.textContent = STATE.tiempoBusqueda ? `${STATE.tiempoBusqueda} ms` : '';

    // Render resultados
    if (n === 0) {
      let html = `
        <div class="empty-state">
          <div class="empty-state-icon">∅</div>
          <div class="empty-state-titulo">No hay <em>coincidencias</em></div>
          <p class="empty-state-desc">No encontramos resultados para tu búsqueda${catText ? ' con el filtro de categoría aplicado' : ''}. Probá con otras palabras clave, sinónimos o nombres alternativos.</p>
          <div class="empty-state-sugerencias">
            <span class="sugerencia" data-q="boleta única">Boleta única</span>
            <span class="sugerencia" data-q="reelección">Reelección</span>
            <span class="sugerencia" data-q="autonomía">Autonomía municipal</span>
            <span class="sugerencia" data-q="paridad">Paridad de género</span>
            <span class="sugerencia" data-q="coparticipación">Coparticipación</span>
          </div>
        </div>
      `;
      $resultadosContainer.innerHTML = html;
      // Re-bind sugerencias
      $resultadosContainer.querySelectorAll('.sugerencia').forEach(s => {
        s.addEventListener('click', () => onSugerenciaClick(s));
      });
    } else {
      const html = STATE.resultados.map(item => renderResultado(item, queryNorm, tokens)).join('');
      $resultadosContainer.innerHTML = html;
    }

    // Actualizar URL con query (sin recargar)
    const newUrl = new URL(window.location);
    newUrl.searchParams.set('q', query);
    if (STATE.catFiltro) newUrl.searchParams.set('cat', STATE.catFiltro);
    else newUrl.searchParams.delete('cat');
    window.history.replaceState(null, '', newUrl);
  }

  // ============================================================
  // EVENT HANDLERS
  // ============================================================

  function onInput() {
    const v = $input.value;
    STATE.query = v;

    // Mostrar/ocultar botón limpiar
    if (v.length > 0) {
      $clear.classList.add('visible');
    } else {
      $clear.classList.remove('visible');
    }

    // Debounce
    clearTimeout(STATE.debounceTimer);
    STATE.debounceTimer = setTimeout(() => {
      buscarYRender();
    }, 150);
  }

  function onKeydown(e) {
    if (e.key === 'Escape') {
      if ($input.value) {
        e.preventDefault();
        limpiarBusqueda();
      } else {
        $input.blur();
      }
    } else if (e.key === 'Enter') {
      // Abrir el primer resultado si hay alguno
      if (STATE.resultados.length > 0) {
        e.preventDefault();
        const primer = $resultadosContainer.querySelector('.resultado');
        if (primer) {
          window.location.href = primer.getAttribute('href');
        }
      }
    }
  }

  function limpiarBusqueda() {
    $input.value = '';
    STATE.query = '';
    $clear.classList.remove('visible');
    buscarYRender();
    $input.focus();
  }

  function onSugerenciaClick(el) {
    const q = el.dataset.q;
    if (q) {
      $input.value = q;
      STATE.query = q;
      $clear.classList.add('visible');
      buscarYRender();
      $input.focus();
    }
  }

  function activarFiltro(cat) {
    STATE.catFiltro = cat || '';
    $filtros.querySelectorAll('.filtro-chip').forEach(chip => {
      if (chip.dataset.cat === STATE.catFiltro) {
        chip.classList.add('activa');
      } else {
        chip.classList.remove('activa');
      }
    });
    try {
      if (STATE.catFiltro) sessionStorage.setItem('busqueda-cat', STATE.catFiltro);
      else sessionStorage.removeItem('busqueda-cat');
    } catch(e) { /* sessionStorage puede fallar en private */ }
    // Re-buscar si hay query activa
    if (STATE.query) buscarYRender();
  }

  function onFiltroClick(e) {
    const chip = e.target.closest('.filtro-chip');
    if (chip) {
      activarFiltro(chip.dataset.cat);
    }
  }

  // ============================================================
  // INIT
  // ============================================================

  function init() {
    // Bind eventos
    $input.addEventListener('input', onInput);
    $input.addEventListener('keydown', onKeydown);
    $clear.addEventListener('click', limpiarBusqueda);
    $filtros.addEventListener('click', onFiltroClick);

    // Bind sugerencias del estado inicial
    document.querySelectorAll('#estado-inicial .sugerencia').forEach(s => {
      s.addEventListener('click', () => onSugerenciaClick(s));
    });

    // Atajo global: / o Ctrl+K para focusear el input desde cualquier scroll
    document.addEventListener('keydown', e => {
      // No interferir si está escribiendo en otro input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        $input.focus();
        $input.select();
      } else if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        $input.focus();
      }
    });

    // Cargar índice
    cargarIndice();
  }

  // Esperar a DOMContentLoaded si el script se carga antes
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
