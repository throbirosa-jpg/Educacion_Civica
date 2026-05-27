/**
 * Mapa interactivo de provincias argentinas (GeoJSON oficial Georef + D3.js v7).
 */
(function () {
  const FILL_CELESTE = '#74ACDF';
  const FILL_SOL = '#F6B40E';
  const STROKE_CREMA = '#FBF7F0';
  const CABA_ID = '02';
  const TIERRA_FUEGO_ID = '94';

  /** Marco de Argentina continental (sin Antártida ni Malvinas para el zoom). */
  const MARCO_CONTINENTAL = {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [-74, -22],
          [-53, -22],
          [-53, -56],
          [-74, -56],
          [-74, -22],
        ],
      ],
    },
  };

  /** Caja de la isla Grande de Tierra del Fuego (sin Malvinas ni Antártida). */
  const CAJA_ISLA_TDF = {
    minLon: -70,
    maxLon: -64,
    minLat: -56,
    maxLat: -52.2,
  };

  function esCaba(props) {
    return props.id === CABA_ID || /ciudad autónoma/i.test(props.nombre || '');
  }

  function esTierraDelFuego(props) {
    return props.id === TIERRA_FUEGO_ID || /tierra del fuego/i.test(props.nombre || '');
  }

  function boundsPoligono(coordsAnillo) {
    let minLon = Infinity;
    let maxLon = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    for (const [lon, lat] of coordsAnillo) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
    return { minLon, maxLon, minLat, maxLat };
  }

  function poligonoDentroDeCaja(poly) {
    const { minLon, maxLon, minLat, maxLat } = boundsPoligono(poly[0]);
    return (
      minLon >= CAJA_ISLA_TDF.minLon &&
      maxLon <= CAJA_ISLA_TDF.maxLon &&
      minLat >= CAJA_ISLA_TDF.minLat &&
      maxLat <= CAJA_ISLA_TDF.maxLat
    );
  }

  /**
   * Deja solo polígonos de la isla de Tierra del Fuego (costa sur).
   * El MultiPolygon oficial incluye Antártida, Malvinas e islas del Atlántico (~1500 partes).
   */
  function recortarTierraDelFuego(feature) {
    if (!esTierraDelFuego(feature.properties)) return feature;

    const { geometry } = feature;
    if (geometry.type !== 'MultiPolygon') {
      console.warn(
        '[mapa-argentina] Tierra del Fuego: geometría inesperada',
        geometry.type
      );
      return feature;
    }

    const totalAntes = geometry.coordinates.length;
    const elegidos = geometry.coordinates.filter(poligonoDentroDeCaja);

    console.log(
      `[mapa-argentina] Tierra del Fuego: ${totalAntes} polígonos → ${elegidos.length} después del recorte (caja isla)`
    );

    if (elegidos.length === 0) {
      console.warn(
        '[mapa-argentina] Tierra del Fuego: ningún polígono en la caja isla; provincia omitida del dibujo.'
      );
      return null;
    }

    if (elegidos.length === 1) {
      return {
        ...feature,
        geometry: { type: 'Polygon', coordinates: elegidos[0] },
      };
    }

    return {
      ...feature,
      geometry: { type: 'MultiPolygon', coordinates: elegidos },
    };
  }

  function prepararGeojson(geo) {
    return {
      ...geo,
      features: geo.features.map(recortarTierraDelFuego).filter(Boolean),
    };
  }

  function normalizarNombre(nombre) {
    return nombre
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/,.*/, '')
      .trim();
  }

  function scrollAListado(nombre) {
    const objetivo = normalizarNombre(nombre);
    const cards = document.querySelectorAll('.provincia-card');
    for (const card of cards) {
      const titulo = card.querySelector('.prov-nombre');
      if (!titulo) continue;
      const texto = normalizarNombre(titulo.textContent);
      if (texto === objetivo || texto.startsWith(objetivo) || objetivo.startsWith(texto)) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
    }
  }

  function radioCaba(width, height) {
    return Math.max(3.5, Math.min(width, height) * 0.018);
  }

  function enlazarInteraccion(sel, tooltip, conClick, posicionarTooltip) {
    sel
      .style('cursor', conClick ? 'pointer' : 'default')
      .on('mouseenter', function (evento, d) {
        if (!esCaba(d.properties)) {
          d3.select(this).attr('fill', FILL_SOL);
        }
        if (tooltip) {
          tooltip.textContent = d.properties.nombre;
          tooltip.style.opacity = '1';
        }
        posicionarTooltip(evento);
      })
      .on('mousemove', posicionarTooltip)
      .on('mouseleave', function (evento, d) {
        if (!esCaba(d.properties)) {
          d3.select(this).attr('fill', FILL_CELESTE);
        }
        if (tooltip) tooltip.style.opacity = '0';
      })
      .on('click', function (evento, d) {
        if (!conClick) return;
        evento.preventDefault();
        scrollAListado(d.properties.nombre);
      });
  }

  async function initMapaArgentina(config) {
    const container = document.querySelector(config.container);
    if (!container || typeof d3 === 'undefined') return;

    const tooltip = config.tooltipId ? document.getElementById(config.tooltipId) : null;
    const conClick = config.mode === 'indice';
    const geoUrl = config.geoUrl || 'provincias.geojson';

    let geo;
    try {
      const res = await fetch(geoUrl);
      if (!res.ok) throw new Error(res.statusText);
      geo = prepararGeojson(await res.json());
    } catch (err) {
      console.error('No se pudo cargar provincias.geojson:', err);
      return;
    }

    const provincias = geo.features.filter((f) => !esCaba(f.properties));
    const caba = geo.features.find((f) => esCaba(f.properties));

    container.querySelectorAll('svg.map-svg').forEach((el) => el.remove());

    const svg = d3
      .select(container)
      .append('svg')
      .attr('class', 'map-svg')
      .attr('preserveAspectRatio', 'xMidYMid meet')
      .attr('role', 'img')
      .attr('aria-label', 'Mapa de las provincias de la República Argentina');

    const capaProvincias = svg.append('g').attr('class', 'capa-provincias');
    const capaCaba = svg.append('g').attr('class', 'capa-caba');
    let encuadreLogueado = false;

    function posicionarTooltip(evento) {
      if (!tooltip) return;
      const rect = container.getBoundingClientRect();
      tooltip.style.left = evento.clientX - rect.left + 12 + 'px';
      tooltip.style.top = evento.clientY - rect.top + 12 + 'px';
    }

    function dibujar() {
      const node = svg.node();
      if (!node) return;

      const width = node.clientWidth;
      const height = node.clientHeight;
      if (width < 8 || height < 8) return;

      const padding = Math.max(10, Math.min(width, height) * 0.04);
      svg.attr('viewBox', `0 0 ${width} ${height}`);

      const proyeccion = d3.geoMercator();

      // Solo el marco continental define zoom (no el extent del GeoJSON completo).
      proyeccion.fitExtent(
        [[padding, padding], [width - padding, height - padding]],
        MARCO_CONTINENTAL
      );

      if (!encuadreLogueado) {
        console.log(
          '[mapa-argentina] Encuadre: marco continental (lat -22 a -56, lon -74 a -53), no extent del GeoJSON'
        );
        encuadreLogueado = true;
      }

      const generador = d3.geoPath().projection(proyeccion);

      const trazos = capaProvincias
        .selectAll('path.provincia')
        .data(provincias, (d) => d.properties.id);

      trazos.exit().remove();

      trazos
        .enter()
        .append('path')
        .attr('class', 'provincia')
        .attr('stroke', STROKE_CREMA)
        .attr('stroke-width', 0.8)
        .attr('vector-effect', 'non-scaling-stroke')
        .merge(trazos)
        .attr('d', generador)
        .attr('fill', FILL_CELESTE)
        .attr('data-prov', (d) => d.properties.nombre)
        .call((sel) => enlazarInteraccion(sel, tooltip, conClick, posicionarTooltip));

      if (caba) {
        const centro = d3.geoCentroid(caba);
        const punto = proyeccion(centro);
        const r = radioCaba(width, height);

        const circulo = capaCaba
          .selectAll('circle.caba')
          .data([caba], (d) => d.properties.id);

        circulo.exit().remove();

        circulo
          .enter()
          .append('circle')
          .attr('class', 'caba')
          .attr('stroke', STROKE_CREMA)
          .attr('stroke-width', 1.2)
          .merge(circulo)
          .attr('cx', punto[0])
          .attr('cy', punto[1])
          .attr('r', r)
          .attr('fill', FILL_SOL)
          .attr('data-prov', caba.properties.nombre)
          .call((sel) => enlazarInteraccion(sel, tooltip, conClick, posicionarTooltip));
      }
    }

    dibujar();

    if (typeof ResizeObserver !== 'undefined') {
      const observador = new ResizeObserver(() => dibujar());
      observador.observe(container);
      observador.observe(svg.node());
    } else {
      window.addEventListener('resize', dibujar);
    }
  }

  window.initMapaArgentina = initMapaArgentina;
})();
