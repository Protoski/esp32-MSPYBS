// ── Cargador de Google Maps JS API ────────────────────────────
// Si NEXT_PUBLIC_GOOGLE_MAPS_API_KEY está definida, los mapas usan
// Google Maps; si no, se usa el mapa SVG como respaldo.

/* eslint-disable @typescript-eslint/no-explicit-any */

export const GOOGLE_MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';
export const hasGoogleMaps = GOOGLE_MAPS_KEY.length > 0;

let loadPromise: Promise<any> | null = null;

export function loadGoogleMaps(): Promise<any> {
  if (typeof window === 'undefined') return Promise.reject(new Error('SSR'));
  const w = window as any;
  if (w.google?.maps) return Promise.resolve(w.google.maps);
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_KEY}&v=weekly`;
    script.async = true;
    script.onload = () => w.google?.maps ? resolve(w.google.maps) : reject(new Error('Google Maps no disponible'));
    script.onerror = () => { loadPromise = null; reject(new Error('No se pudo cargar Google Maps')); };
    document.head.appendChild(script);
  });
  return loadPromise;
}

// Centro de Paraguay y zoom inicial
export const PY_CENTER = { lat: -23.5, lng: -58.4 };
export const PY_ZOOM = 6;

// Estilo oscuro a juego con el dashboard (slate)
export const DARK_MAP_STYLE: any[] = [
  { elementType: 'geometry', stylers: [{ color: '#0f172a' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#94a3b8' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0f172a' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#334155' }] },
  { featureType: 'administrative.country', elementType: 'geometry.stroke', stylers: [{ color: '#475569' }, { weight: 1.2 }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.medical', stylers: [{ visibility: 'on' }] },
  { featureType: 'poi.medical', elementType: 'labels.text.fill', stylers: [{ color: '#f87171' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1e293b' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#64748b' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#283548' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0c4a6e' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#38bdf8' }] },
  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#13203a' }] },
];

// Icono SVG circular para marcadores (color por zona)
export function markerIcon(maps: any, color: string, online: boolean, hasAlert: boolean) {
  const fill = hasAlert ? '#ef4444' : online ? color : '#475569';
  const stroke = online ? '#ffffff' : '#64748b';
  const r = online ? 9 : 7;
  const glow = online ? `<circle cx="16" cy="16" r="${r + 4}" fill="${fill}" opacity="0.3"/>` : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">${glow}<circle cx="16" cy="16" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>${hasAlert ? '<text x="16" y="20" text-anchor="middle" font-size="11" font-weight="bold" fill="#fff">!</text>' : ''}</svg>`;
  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
    scaledSize: new maps.Size(32, 32),
    anchor: new maps.Point(16, 16),
  };
}
