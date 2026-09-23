// ── Cargador de Leaflet (OpenStreetMap) ───────────────────────
// Alternativa 100% gratuita a Google Maps: sin API key ni facturación.
// Se carga desde CDN para no agregar dependencias al bundle.

/* eslint-disable @typescript-eslint/no-explicit-any */

const LEAFLET_JS  = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';

let loadPromise: Promise<any> | null = null;

export function loadLeaflet(): Promise<any> {
  if (typeof window === 'undefined') return Promise.reject(new Error('SSR'));
  const w = window as any;
  if (w.L) return Promise.resolve(w.L);
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = LEAFLET_CSS;
      document.head.appendChild(css);
    }
    const script = document.createElement('script');
    script.src = LEAFLET_JS;
    script.async = true;
    script.onload = () => w.L ? resolve(w.L) : reject(new Error('Leaflet no disponible'));
    script.onerror = () => { loadPromise = null; reject(new Error('No se pudo cargar Leaflet')); };
    document.head.appendChild(script);
  });
  return loadPromise;
}

export const PY_CENTER: [number, number] = [-23.5, -58.4];
export const PY_ZOOM = 6;

// Capas de mosaicos gratuitas
export const TILE_DARK = {
  url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
};
export const TILE_STREETS = {
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
};
export const TILE_SATELLITE = {
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  attribution: 'Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics',
};

// Crea el mapa con las 3 capas (Oscuro / Calles / Satélite) y control de capas
export function createBaseMap(L: any, el: HTMLElement, opts: any = {}) {
  const dark      = L.tileLayer(TILE_DARK.url,      { attribution: TILE_DARK.attribution, maxZoom: 20 });
  const streets   = L.tileLayer(TILE_STREETS.url,   { attribution: TILE_STREETS.attribution, maxZoom: 19 });
  const satellite = L.tileLayer(TILE_SATELLITE.url, { attribution: TILE_SATELLITE.attribution, maxZoom: 19 });
  const map = L.map(el, {
    center: PY_CENTER,
    zoom: PY_ZOOM,
    layers: [dark],
    maxBounds: [[-29.5, -65.5], [-17.0, -51.5]],
    maxBoundsViscosity: 0.6,
    ...opts,
  });
  L.control.layers({ 'Oscuro': dark, 'Calles': streets, 'Satélite': satellite }).addTo(map);
  return map;
}

// Icono circular HTML para marcadores (color = estado de conexión)
export function markerDivIcon(L: any, color: string, online: boolean, hasAlert: boolean) {
  const fill = color;
  const stroke = online ? '#fff' : '#fecaca';
  const size = online ? 18 : 14;
  const glow = `box-shadow:0 0 10px 3px ${fill}80;`;
  const pulse = hasAlert || !online ? 'animation:lf-pulse 1s infinite;' : '';
  return L.divIcon({
    className: '',
    html: `<style>@keyframes lf-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.25)}}</style>
      <div style="width:${size}px;height:${size}px;border-radius:50%;background:${fill};border:2px solid ${stroke};${glow}${pulse}display:flex;align-items:center;justify-content:center;color:#fff;font-weight:bold;font-size:10px;font-family:system-ui">${hasAlert ? '!' : ''}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}
