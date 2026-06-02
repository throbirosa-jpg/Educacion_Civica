/**
 * Buscador Global · Educación Cívica
 * Overlay tipo Cmd+K que se carga en TODAS las páginas del sitio.
 * Sin dependencias externas. JS puro.
 *
 * Funcionamiento:
 * - Click en la barra del nav o atajos (⌘K, Ctrl+K, /) abren el overlay
 * - Fetch del índice JSON la primera vez que se abre (lazy)
 * - Búsqueda en tiempo real con debounce
 * - Navegación con ↑↓ Enter, cierre con Esc
 * - Resultados linkean a las páginas (mismo doc que buscar.html, versión simplificada)
 * - Backdrop blur, animación suave
 *
 * Comparte el índice con buscar.html pero NO requiere estar en esa página.
 */

(function() {
  'use strict';

  // No correr en buscar.html (esa página ya tiene su propio buscador completo)
  if (window.location.pathname.endsWith('buscar.html') ||
      window.location.pathname.endsWith('/buscar')) {
    return;
  }

  // ============================================================
  // ESTADO
  // ============================================================
  const STATE = {
    overlay: null,
    input: null,
    resultados: null,
    indice: null,
    cargando: false,
    cargado: false,
    debounceTimer: null,
    query: '',
    seleccionado: -1,
    abierto: false
  };

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
  // CSS · se inyecta una sola vez
  // ============================================================
  function inyectarCSS() {
    if (document.getElementById('busqueda-global-css')) return;
    const style = document.createElement('style');
    style.id = 'busqueda-global-css';
    style.textContent = `
      /* Barra del nav · trigger del overlay */
      .nav-search-trigger {
        display: inline-flex;
        align-items: center;
        gap: 0.6rem;
        background: var(--crema-warm, #F4ECDB);
        border: 1px solid var(--linea, #DDD7CB);
        padding: 0.45rem 0.9rem;
        font-family: 'JetBrains Mono', monospace;
        font-size: 0.78rem;
        color: var(--tinta-soft, #545465);
        cursor: pointer;
        transition: all 0.2s;
        border-radius: 0;
        min-width: 200px;
        text-align: left;
        font-weight: 500;
      }
      .nav-search-trigger:hover {
        background: white;
        border-color: var(--premium, #6B4F8C);
        color: var(--tinta, #1A1A2E);
      }
      .nav-search-trigger:focus-visible {
        outline: 2px solid var(--premium, #6B4F8C);
        outline-offset: 2px;
      }
      .nav-search-trigger .nst-icon {
        width: 14px;
        height: 14px;
        flex-shrink: 0;
        opacity: 0.7;
      }
      .nav-search-trigger .nst-text {
        flex: 1;
      }
      .nav-search-trigger .nst-kbd {
        display: inline-flex;
        align-items: center;
        gap: 0.15rem;
        padding: 0.12rem 0.4rem;
        background: white;
        border: 1px solid var(--linea, #DDD7CB);
        font-family: 'JetBrains Mono', monospace;
        font-size: 0.7rem;
        font-weight: 600;
        color: var(--tinta-soft, #545465);
      }
      @media (max-width: 700px) {
        .nav-search-trigger { min-width: 0; padding: 0.45rem 0.65rem; }
        .nav-search-trigger .nst-text { display: none; }
        .nav-search-trigger .nst-kbd { display: none; }
      }

      /* Overlay · contenedor */
      .bg-overlay {
        position: fixed;
        inset: 0;
        z-index: 9999;
        background: rgba(26, 26, 46, 0.4);
        backdrop-filter: blur(6px);
        -webkit-backdrop-filter: blur(6px);
        display: flex;
        align-items: flex-start;
        justify-content: center;
        padding: 8vh 1rem 1rem;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.18s ease;
        font-family: 'Fraunces', Georgia, serif;
      }
      .bg-overlay.visible {
        opacity: 1;
        pointer-events: auto;
      }

      /* Modal · contenedor blanco */
      .bg-modal {
        background: white;
        width: 100%;
        max-width: 720px;
        max-height: 80vh;
        display: flex;
        flex-direction: column;
        border: 1px solid var(--linea, #DDD7CB);
        box-shadow: 0 20px 60px rgba(26, 26, 46, 0.2);
        transform: translateY(-10px);
        transition: transform 0.18s ease;
      }
      .bg-overlay.visible .bg-modal {
        transform: translateY(0);
      }

      /* Header del modal · input + tags */
      .bg-input-wrap {
        display: flex;
        align-items: center;
        gap: 0.8rem;
        padding: 1.1rem 1.4rem;
        border-bottom: 1px solid var(--linea-soft, #ECE6DA);
      }
      .bg-input-icon {
        width: 20px;
        height: 20px;
        flex-shrink: 0;
        color: var(--tinta-soft, #545465);
      }
      .bg-input {
        flex: 1;
        border: none;
        outline: none;
        font-family: 'Fraunces', Georgia, serif;
        font-size: 1.15rem;
        color: var(--tinta, #1A1A2E);
        background: transparent;
        font-weight: 400;
        padding: 0.2rem 0;
      }
      .bg-input::placeholder {
        color: var(--tinta-soft, #545465);
        opacity: 0.6;
      }
      .bg-close {
        background: var(--crema-warm, #F4ECDB);
        border: 1px solid var(--linea, #DDD7CB);
        font-family: 'JetBrains Mono', monospace;
        font-size: 0.7rem;
        color: var(--tinta-soft, #545465);
        padding: 0.3rem 0.5rem;
        cursor: pointer;
        flex-shrink: 0;
        transition: all 0.2s;
      }
      .bg-close:hover {
        background: white;
        border-color: var(--tinta-soft, #545465);
        color: var(--tinta, #1A1A2E);
      }

      /* Resultados · contenedor scrollable */
      .bg-resultados {
        flex: 1;
        overflow-y: auto;
        padding: 0.5rem 0;
        background: var(--crema, #FBF7F0);
      }
      .bg-resultados::-webkit-scrollbar {
        width: 8px;
      }
      .bg-resultados::-webkit-scrollbar-track {
        background: var(--crema, #FBF7F0);
      }
      .bg-resultados::-webkit-scrollbar-thumb {
        background: var(--linea, #DDD7CB);
      }

      /* Item de resultado */
      .bg-result {
        display: block;
        padding: 0.85rem 1.4rem;
        text-decoration: none;
        color: var(--tinta, #1A1A2E);
        border-left: 3px solid transparent;
        transition: background 0.1s, border-color 0.1s;
        cursor: pointer;
      }
      .bg-result:hover,
      .bg-result.selected {
        background: white;
        border-left-color: var(--premium, #6B4F8C);
      }
      .bg-result-top {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        margin-bottom: 0.3rem;
      }
      .bg-result-cat {
        font-family: 'JetBrains Mono', monospace;
        font-size: 0.65rem;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--premium-dark, #4A3661);
        background: var(--premium-soft, #E8DFF0);
        padding: 0.15rem 0.5rem;
        font-weight: 600;
      }
      .bg-result-eyebrow {
        font-family: 'JetBrains Mono', monospace;
        font-size: 0.7rem;
        color: var(--tinta-soft, #545465);
        letter-spacing: 0.05em;
      }
      .bg-result-titulo {
        font-family: 'Fraunces', serif;
        font-size: 1.02rem;
        font-weight: 500;
        line-height: 1.3;
        color: var(--tinta, #1A1A2E);
        margin-bottom: 0.25rem;
      }
      .bg-result-titulo em {
        font-style: italic;
        color: var(--premium-dark, #4A3661);
      }
      .bg-result-snippet {
        font-family: 'Fraunces', serif;
        font-size: 0.85rem;
        line-height: 1.5;
        color: var(--tinta-soft, #545465);
      }
      .bg-result-seccion {
        margin-top: 0.4rem;
        padding-left: 0.7rem;
        border-left: 2px solid var(--linea, #DDD7CB);
        font-size: 0.82rem;
      }
      .bg-result-seccion-label {
        font-family: 'JetBrains Mono', monospace;
        font-size: 0.62rem;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: var(--premium, #6B4F8C);
        margin-bottom: 0.15rem;
      }
      .bg-result-seccion-titulo {
        font-weight: 500;
        color: var(--tinta, #1A1A2E);
        margin-bottom: 0.15rem;
      }
      .bg-result-seccion-snippet {
        color: var(--tinta-soft, #545465);
        line-height: 1.45;
      }
      .bg-result mark {
        background: var(--sol-soft, #FBE5AA);
        color: var(--tinta, #1A1A2E);
        padding: 0 0.1em;
        font-weight: 600;
        font-style: normal;
      }

      /* Estado inicial · cuando no hay query */
      .bg-vacio {
        padding: 2.5rem 1.4rem;
        text-align: center;
      }
      .bg-vacio-titulo {
        font-family: 'Fraunces', serif;
        font-size: 1.1rem;
        color: var(--tinta, #1A1A2E);
        margin-bottom: 0.5rem;
      }
      .bg-vacio-desc {
        font-family: 'Fraunces', serif;
        font-size: 0.92rem;
        color: var(--tinta-soft, #545465);
        max-width: 420px;
        margin: 0 auto 1.2rem;
        line-height: 1.55;
      }
      .bg-vacio-sugerencias {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
        justify-content: center;
        max-width: 500px;
        margin: 0 auto;
      }
      .bg-vacio-chip {
        font-family: 'JetBrains Mono', monospace;
        font-size: 0.72rem;
        background: white;
        border: 1px solid var(--linea, #DDD7CB);
        padding: 0.35rem 0.7rem;
        cursor: pointer;
        color: var(--tinta-soft, #545465);
        transition: all 0.15s;
      }
      .bg-vacio-chip:hover {
        background: var(--premium-soft, #E8DFF0);
        border-color: var(--premium, #6B4F8C);
        color: var(--premium-dark, #4A3661);
      }

      /* Estado sin resultados */
      .bg-noresult {
        padding: 2.5rem 1.4rem;
        text-align: center;
        font-family: 'Fraunces', serif;
      }
      .bg-noresult-titulo {
        font-size: 1.05rem;
        color: var(--tinta, #1A1A2E);
        margin-bottom: 0.5rem;
      }
      .bg-noresult-desc {
        font-size: 0.9rem;
        color: var(--tinta-soft, #545465);
      }
      .bg-noresult a {
        color: var(--premium-dark, #4A3661);
        font-weight: 600;
      }

      /* Footer */
      .bg-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.65rem 1.4rem;
        border-top: 1px solid var(--linea-soft, #ECE6DA);
        font-family: 'JetBrains Mono', monospace;
        font-size: 0.68rem;
        color: var(--tinta-soft, #545465);
        background: white;
      }
      .bg-footer-shortcuts {
        display: flex;
        gap: 1.1rem;
      }
      .bg-footer-shortcut {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
      }
      .bg-footer-shortcut kbd {
        background: var(--crema-warm, #F4ECDB);
        border: 1px solid var(--linea, #DDD7CB);
        padding: 0.08rem 0.35rem;
        font-family: inherit;
        font-size: 0.65rem;
        color: var(--tinta, #1A1A2E);
        font-weight: 600;
      }
      .bg-footer-link {
        color: var(--premium-dark, #4A3661);
        text-decoration: none;
        font-weight: 600;
      }
      .bg-footer-link:hover {
        text-decoration: underline;
      }
      @media (max-width: 600px) {
        .bg-overlay { padding: 4vh 0.5rem 0.5rem; }
        .bg-input-wrap { padding: 0.9rem 1rem; }
        .bg-input { font-size: 1rem; }
        .bg-result { padding: 0.75rem 1rem; }
        .bg-footer { font-size: 0.62rem; padding: 0.5rem 1rem; }
        .bg-footer-shortcuts { gap: 0.7rem; }
      }
    `;
    document.head.appendChild(style);
  }

  // ============================================================
  // CONSTRUCCIÓN DEL OVERLAY · una sola vez
  // ============================================================
  function construirOverlay() {
    if (STATE.overlay) return;

    inyectarCSS();

    const overlay = document.createElement('div');
    overlay.className = 'bg-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'Buscar en el sitio');
    overlay.innerHTML = `
      <div class="bg-modal">
        <div class="bg-input-wrap">
          <svg class="bg-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="7"></circle>
            <line x1="20" y1="20" x2="16.65" y2="16.65"></line>
          </svg>
          <input type="search" class="bg-input" placeholder="Buscá conceptos, capítulos, provincias..." autocomplete="off" spellcheck="false" aria-label="Texto de búsqueda">
          <button type="button" class="bg-close" aria-label="Cerrar buscador">Esc</button>
        </div>
        <div class="bg-resultados" role="listbox" aria-label="Resultados">
          <div class="bg-vacio">
            <div class="bg-vacio-titulo">Buscá en todo el sitio</div>
            <div class="bg-vacio-desc">Capítulos, secciones, glosario, provincias en profundidad, historia y elecciones. Escribí al menos 2 letras para empezar.</div>
            <div class="bg-vacio-sugerencias">
              <span class="bg-vacio-chip" data-q="boleta única">Boleta única</span>
              <span class="bg-vacio-chip" data-q="reelección">Reelección</span>
              <span class="bg-vacio-chip" data-q="autonomía municipal">Autonomía municipal</span>
              <span class="bg-vacio-chip" data-q="amparo">Amparo</span>
              <span class="bg-vacio-chip" data-q="D'Hondt">D'Hondt</span>
              <span class="bg-vacio-chip" data-q="PASO">PASO</span>
              <span class="bg-vacio-chip" data-q="coparticipación">Coparticipación</span>
              <span class="bg-vacio-chip" data-q="paridad">Paridad</span>
              <span class="bg-vacio-chip" data-q="federalismo">Federalismo</span>
            </div>
          </div>
        </div>
        <div class="bg-footer">
          <div class="bg-footer-shortcuts">
            <span class="bg-footer-shortcut"><kbd>↑↓</kbd> Navegar</span>
            <span class="bg-footer-shortcut"><kbd>↵</kbd> Abrir</span>
            <span class="bg-footer-shortcut"><kbd>Esc</kbd> Cerrar</span>
          </div>
          <a href="buscar.html" class="bg-footer-link">Buscador avanzado →</a>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    STATE.overlay = overlay;
    STATE.input = overlay.querySelector('.bg-input');
    STATE.resultados = overlay.querySelector('.bg-resultados');

    // Eventos
    overlay.addEventListener('click', e => {
      if (e.target === overlay) cerrar();
    });
    overlay.querySelector('.bg-close').addEventListener('click', cerrar);
    STATE.input.addEventListener('input', onInput);
    STATE.input.addEventListener('keydown', onInputKeydown);

    // Chips de sugerencia
    overlay.querySelectorAll('.bg-vacio-chip').forEach(c => {
      c.addEventListener('click', () => {
        STATE.input.value = c.dataset.q;
        STATE.query = c.dataset.q;
        STATE.input.focus();
        buscarYRender();
      });
    });
  }

  // ============================================================
  // CARGA DEL ÍNDICE · lazy, primera vez que se abre
  // ============================================================
  async function cargarIndice() {
    if (STATE.cargado || STATE.cargando) return;
    STATE.cargando = true;
    try {
      const res = await fetch('busqueda-indice.json');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      STATE.indice = data;
      // Pre-normalizar
      data.docs.forEach(d => {
        d._norm = {
          t: normalizar(d.t || ''),
          h: normalizar(d.h || ''),
          e: normalizar(d.e || ''),
          d: normalizar(d.d || ''),
          u: normalizar(d.u || '')
        };
        if (d.secs) {
          d.secs.forEach(sec => {
            sec._normT = normalizar(sec.t || '');
            sec._normS = normalizar(sec.s || '');
          });
        }
      });
      STATE.cargado = true;
      STATE.cargando = false;
      // Si ya hay query mientras estaba cargando, ejecutar la búsqueda
      if (STATE.query) buscarYRender();
    } catch (err) {
      STATE.cargando = false;
      STATE.resultados.innerHTML = `
        <div class="bg-noresult">
          <div class="bg-noresult-titulo">No se pudo cargar el buscador</div>
          <div class="bg-noresult-desc">Probá recargar la página o ir al <a href="buscar.html">buscador avanzado</a>.</div>
        </div>
      `;
    }
  }

  // ============================================================
  // UTILIDADES · normalización, tokenización, escape
  // ============================================================
  function normalizar(s) {
    if (!s) return '';
    return s.toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[''`´]/g, "'")
            .trim();
  }

  function tokenizar(s) {
    return normalizar(s).split(/[\s\-_.,;:()¿?¡!]+/).filter(t => t.length >= 2);
  }

  function escapeHTML(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // ============================================================
  // SEARCH · scoring multi-campo
  // ============================================================
  function calcularScore(doc, queryNorm, tokens) {
    let score = 0;
    let seccionMatch = null;
    let mejorScoreSeccion = 0;

    if (queryNorm.length >= 2) {
      if (doc._norm.t.includes(queryNorm)) score += 500;
      if (doc._norm.h.includes(queryNorm)) score += 400;
      if (doc._norm.d.includes(queryNorm)) score += 60;
      if (doc._norm.e.includes(queryNorm)) score += 80;

      if (doc.secs) {
        for (const sec of doc.secs) {
          let scoreSec = 0;
          if (sec._normT.includes(queryNorm)) scoreSec += 350;
          if (sec._normS.includes(queryNorm)) scoreSec += 150;
          for (const tok of tokens) {
            if (sec._normT.includes(tok)) scoreSec += 50;
            if (sec._normS.includes(tok)) scoreSec += 20;
          }
          if (scoreSec > mejorScoreSeccion) {
            mejorScoreSeccion = scoreSec;
            seccionMatch = sec;
          }
        }
        score += mejorScoreSeccion;
      }
    }

    let tokensMatcheados = 0;
    for (const tok of tokens) {
      let tokScore = 0;
      if (doc._norm.t.includes(tok)) {
        tokScore += 100;
        if (doc._norm.t.split(/\s+/).some(w => w.startsWith(tok))) tokScore += 50;
      }
      if (doc._norm.h.includes(tok)) tokScore += 80;
      if (doc._norm.e.includes(tok)) tokScore += 60;
      if (doc._norm.d.includes(tok)) tokScore += 40;
      if (doc._norm.u.includes(tok)) tokScore += 30;
      if (tokScore > 0) tokensMatcheados++;
      score += tokScore;
    }

    // Bonus: todos los tokens están en el doc
    if (tokens.length > 1 && tokensMatcheados === tokens.length) {
      score += 100;
    }

    return { score, seccionMatch };
  }

  function buscar(query) {
    if (!STATE.indice || !query || query.length < 2) return [];
    const queryNorm = normalizar(query);
    const tokens = tokenizar(query);
    const resultados = [];

    for (const doc of STATE.indice.docs) {
      const { score, seccionMatch } = calcularScore(doc, queryNorm, tokens);
      if (score > 0) {
        resultados.push({ doc, score, seccionMatch });
      }
    }

    resultados.sort((a, b) => b.score - a.score);
    return resultados.slice(0, 20); // tope 20 en el overlay
  }

  // ============================================================
  // RENDER
  // ============================================================
  function highlight(texto, queryNorm, tokens) {
    if (!texto) return '';
    const terminos = [];
    if (queryNorm && queryNorm.length >= 2) terminos.push(queryNorm);
    tokens.forEach(t => { if (!terminos.includes(t)) terminos.push(t); });
    if (!terminos.length) return escapeHTML(texto);

    const textoNorm = normalizar(texto);
    // Build regex sobre texto NORMALIZADO, luego mapeamos al original
    // Simplificación: regex sobre el texto original (con flag i y sin diacritics seguro porque normalizamos via lowercase)
    const pattern = '(' + terminos.map(escapeRegex).join('|') + ')';

    // Workaround: como el texto puede tener tildes pero los tokens no, hacemos matching manual
    // por índices del texto normalizado y mapeamos posiciones de char (asumiendo NFD->NFC 1:1 simple,
    // que es razonable para español de uso común)
    const partes = [];
    let lastIdx = 0;
    const re = new RegExp(pattern, 'gi');
    let m;
    while ((m = re.exec(textoNorm)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      partes.push(escapeHTML(texto.slice(lastIdx, start)));
      partes.push('<mark>' + escapeHTML(texto.slice(start, end)) + '</mark>');
      lastIdx = end;
      if (m[0].length === 0) re.lastIndex++;
    }
    partes.push(escapeHTML(texto.slice(lastIdx)));
    return partes.join('');
  }

  function snippetCentrado(texto, queryNorm, tokens, maxLen = 180) {
    if (!texto) return '';
    if (texto.length <= maxLen) return texto;
    const textoNorm = normalizar(texto);
    let idx = -1;
    if (queryNorm) idx = textoNorm.indexOf(queryNorm);
    if (idx === -1) {
      for (const tok of tokens) {
        const i = textoNorm.indexOf(tok);
        if (i !== -1) { idx = i; break; }
      }
    }
    if (idx === -1) return texto.slice(0, maxLen) + '…';
    const margenPrev = Math.min(40, idx);
    const inicio = Math.max(0, idx - margenPrev);
    const fin = Math.min(texto.length, inicio + maxLen);
    let snip = texto.slice(inicio, fin);
    if (inicio > 0) snip = '…' + snip;
    if (fin < texto.length) snip = snip + '…';
    return snip;
  }

  function renderResultado(item, queryNorm, tokens, idx) {
    const d = item.doc;
    const sec = item.seccionMatch;
    const catLabel = CAT_LABELS[d.c] || d.c;

    let html = `<a href="${escapeHTML(d.u)}" class="bg-result" data-idx="${idx}" role="option">`;
    html += '<div class="bg-result-top">';
    html += `<span class="bg-result-cat">${escapeHTML(catLabel)}</span>`;
    if (d.e) html += `<span class="bg-result-eyebrow">${escapeHTML(d.e)}</span>`;
    html += '</div>';
    html += `<div class="bg-result-titulo">${highlight(d.t, queryNorm, tokens)}</div>`;
    if (d.d) {
      const desc = snippetCentrado(d.d, queryNorm, tokens, 180);
      html += `<div class="bg-result-snippet">${highlight(desc, queryNorm, tokens)}</div>`;
    }
    if (sec) {
      const snip = snippetCentrado(sec.s, queryNorm, tokens, 140);
      html += '<div class="bg-result-seccion">';
      html += '<div class="bg-result-seccion-label">Sección coincidente</div>';
      html += `<div class="bg-result-seccion-titulo">${highlight(sec.t, queryNorm, tokens)}</div>`;
      html += `<div class="bg-result-seccion-snippet">${highlight(snip, queryNorm, tokens)}</div>`;
      html += '</div>';
    }
    html += '</a>';
    return html;
  }

  function renderVacio() {
    // Restaurar el estado inicial (mantenemos el HTML que viene del constructor)
    STATE.resultados.innerHTML = `
      <div class="bg-vacio">
        <div class="bg-vacio-titulo">Buscá en todo el sitio</div>
        <div class="bg-vacio-desc">Capítulos, secciones, glosario, provincias en profundidad, historia y elecciones. Escribí al menos 2 letras para empezar.</div>
        <div class="bg-vacio-sugerencias">
          <span class="bg-vacio-chip" data-q="boleta única">Boleta única</span>
          <span class="bg-vacio-chip" data-q="reelección">Reelección</span>
          <span class="bg-vacio-chip" data-q="autonomía municipal">Autonomía municipal</span>
          <span class="bg-vacio-chip" data-q="amparo">Amparo</span>
          <span class="bg-vacio-chip" data-q="D'Hondt">D'Hondt</span>
          <span class="bg-vacio-chip" data-q="PASO">PASO</span>
          <span class="bg-vacio-chip" data-q="coparticipación">Coparticipación</span>
          <span class="bg-vacio-chip" data-q="paridad">Paridad</span>
          <span class="bg-vacio-chip" data-q="federalismo">Federalismo</span>
        </div>
      </div>
    `;
    // Re-bindear los chips
    STATE.resultados.querySelectorAll('.bg-vacio-chip').forEach(c => {
      c.addEventListener('click', () => {
        STATE.input.value = c.dataset.q;
        STATE.query = c.dataset.q;
        STATE.input.focus();
        buscarYRender();
      });
    });
  }

  function buscarYRender() {
    if (!STATE.cargado) {
      // Mientras carga el índice mostramos un mensaje breve
      STATE.resultados.innerHTML = `<div class="bg-noresult"><div class="bg-noresult-desc">Cargando índice...</div></div>`;
      return;
    }
    if (!STATE.query || STATE.query.length < 2) {
      renderVacio();
      STATE.seleccionado = -1;
      return;
    }

    const queryNorm = normalizar(STATE.query);
    const tokens = tokenizar(STATE.query);
    const resultados = buscar(STATE.query);

    if (resultados.length === 0) {
      STATE.resultados.innerHTML = `
        <div class="bg-noresult">
          <div class="bg-noresult-titulo">Sin resultados para "${escapeHTML(STATE.query)}"</div>
          <div class="bg-noresult-desc">Probá con otras palabras o usá el <a href="buscar.html?q=${encodeURIComponent(STATE.query)}">buscador avanzado</a> para más opciones.</div>
        </div>
      `;
      STATE.seleccionado = -1;
      return;
    }

    const html = resultados.map((r, i) => renderResultado(r, queryNorm, tokens, i)).join('');
    STATE.resultados.innerHTML = html;
    STATE.resultados.scrollTop = 0;
    STATE.seleccionado = -1; // Reset selección
    // Bind hover -> seleccionado (sin recomputar render)
    STATE.resultados.querySelectorAll('.bg-result').forEach(el => {
      el.addEventListener('mouseenter', () => {
        const i = parseInt(el.dataset.idx, 10);
        seleccionar(i);
      });
    });
  }

  function seleccionar(idx) {
    const items = STATE.resultados.querySelectorAll('.bg-result');
    if (!items.length) { STATE.seleccionado = -1; return; }
    if (idx < 0) idx = items.length - 1;
    if (idx >= items.length) idx = 0;
    STATE.seleccionado = idx;
    items.forEach((el, i) => {
      if (i === idx) {
        el.classList.add('selected');
        // Scroll si está fuera del viewport
        const r = el.getBoundingClientRect();
        const cr = STATE.resultados.getBoundingClientRect();
        if (r.top < cr.top) el.scrollIntoView({ block: 'nearest' });
        else if (r.bottom > cr.bottom) el.scrollIntoView({ block: 'nearest' });
      } else {
        el.classList.remove('selected');
      }
    });
  }

  // ============================================================
  // INPUT HANDLERS · debounce, keyboard
  // ============================================================
  function onInput() {
    STATE.query = STATE.input.value.trim();
    clearTimeout(STATE.debounceTimer);
    STATE.debounceTimer = setTimeout(buscarYRender, 120);
  }

  function onInputKeydown(e) {
    const items = STATE.resultados.querySelectorAll('.bg-result');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (items.length) seleccionar(STATE.seleccionado + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (items.length) seleccionar(STATE.seleccionado - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (STATE.seleccionado >= 0 && items[STATE.seleccionado]) {
        window.location.href = items[STATE.seleccionado].href;
      } else if (items[0]) {
        window.location.href = items[0].href;
      } else if (STATE.query) {
        // Sin resultados: ir al buscador avanzado con el query
        window.location.href = 'buscar.html?q=' + encodeURIComponent(STATE.query);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cerrar();
    }
  }

  // ============================================================
  // ABRIR / CERRAR
  // ============================================================
  function abrir() {
    if (STATE.abierto) return;
    construirOverlay();
    STATE.overlay.classList.add('visible');
    STATE.abierto = true;
    document.body.style.overflow = 'hidden';
    setTimeout(() => STATE.input.focus(), 50);
    // Lazy load del índice
    if (!STATE.cargado) cargarIndice();
  }

  function cerrar() {
    if (!STATE.abierto || !STATE.overlay) return;
    STATE.overlay.classList.remove('visible');
    STATE.abierto = false;
    document.body.style.overflow = '';
    STATE.input.blur();
  }

  // ============================================================
  // TRIGGER GLOBAL · barra del nav + atajos globales
  // ============================================================
  function inyectarTrigger() {
    // Caso 1: ya existe un .nav-search-trigger (creado en build o en otra carga) → reusar
    const yaExiste = document.querySelector('.nav-search-trigger');
    if (yaExiste) {
      yaExiste.addEventListener('click', e => { e.preventDefault(); abrir(); });
      return yaExiste;
    }

    // Caso 2: existe un .nav-search estático (HTML del index actual que linkea a buscar.html)
    // → potenciarlo en lugar de inyectar una segunda barra. Mantiene href como fallback no-JS.
    const navSearchExistente = document.querySelector('.nav-search');
    if (navSearchExistente) {
      navSearchExistente.addEventListener('click', e => { e.preventDefault(); abrir(); });
      navSearchExistente.setAttribute('aria-label', 'Abrir buscador (overlay)');
      return navSearchExistente;
    }

    // Caso 3: no hay nada → inyectar la barra
    const navInner = document.querySelector('nav .nav-inner');
    if (!navInner) return null;

    const breadcrumb = navInner.querySelector('.breadcrumb');
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'nav-search-trigger';
    trigger.setAttribute('aria-label', 'Abrir buscador');
    trigger.innerHTML = `
      <svg class="nst-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="7"></circle>
        <line x1="20" y1="20" x2="16.65" y2="16.65"></line>
      </svg>
      <span class="nst-text">Buscar en el sitio...</span>
      <span class="nst-kbd">⌘ K</span>
    `;
    trigger.addEventListener('click', abrir);

    // Insertar antes del breadcrumb (si hay) o al final del nav-inner
    if (breadcrumb) {
      navInner.insertBefore(trigger, breadcrumb);
    } else {
      navInner.appendChild(trigger);
    }
    return trigger;
  }

  function configurarAtajosGlobales() {
    document.addEventListener('keydown', e => {
      // Ctrl+K o Cmd+K → siempre abre
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        if (STATE.abierto) cerrar();
        else abrir();
        return;
      }
      // / → solo abre si NO está escribiendo en un input
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
          return;
        }
        e.preventDefault();
        abrir();
        return;
      }
      // Esc cerrando el overlay (también lo maneja el input keydown, pero por si acaso)
      if (e.key === 'Escape' && STATE.abierto) {
        e.preventDefault();
        cerrar();
      }
    });
  }

  // ============================================================
  // INIT
  // ============================================================
  function init() {
    inyectarTrigger();
    configurarAtajosGlobales();
    // Pre-load del CSS para evitar flash al abrir
    inyectarCSS();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
