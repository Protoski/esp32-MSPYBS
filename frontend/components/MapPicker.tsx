'use client';

import React, { useState, useEffect, useRef } from 'react';
import { ComposableMap, Geographies, Geography, Marker } from 'react-simple-maps';
import { geoMercator } from 'd3-geo';
import { getCityCoords } from '@/lib/paraguay';
import { hasGoogleMaps } from '@/lib/googleMaps';
import GoogleMapPicker from './GoogleMapPicker';
import LeafletMapPicker from './LeafletMapPicker';

// Debe coincidir con el viewBox por defecto de ComposableMap (800x600)
// y con la configuración de proyección usada abajo.
const MAP_W = 800;
const MAP_H = 600;
const PROJ_SCALE = 1800;
const PROJ_CENTER: [number, number] = [-58.4, -23.5];

interface Props {
  lat?: number | null;
  lon?: number | null;
  ciudad?: string;
  onChange: (lat: number | null, lon: number | null) => void;
}

export default function MapPicker(props: Props) {
  // Google Maps solo si hay API key; por defecto OpenStreetMap (gratis, sin key)
  if (hasGoogleMaps) return <GoogleMapPicker {...props} />;
  return <LeafletMapPicker {...props} />;
}

function SvgMapPicker({ lat, lon, ciudad, onChange }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const hasCustom = typeof lat === 'number' && typeof lon === 'number';
  const cityCoords = ciudad ? getCityCoords(ciudad) : null;

  const projection = geoMercator()
    .scale(PROJ_SCALE)
    .center(PROJ_CENTER)
    .translate([MAP_W / 2, MAP_H / 2]);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const svg = wrapRef.current?.querySelector('svg');
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    // Convertir píxeles de pantalla a coordenadas del viewBox del SVG
    const x = ((e.clientX - rect.left) / rect.width) * MAP_W;
    const y = ((e.clientY - rect.top) / rect.height) * MAP_H;
    const inverted = projection.invert([x, y]);
    if (!inverted) return;
    const [lonClick, latClick] = inverted;
    onChange(+latClick.toFixed(4), +lonClick.toFixed(4));
  };

  return (
    <div className="space-y-2">
      <div
        ref={wrapRef}
        onClick={handleClick}
        className="relative rounded-xl bg-slate-900/60 border border-slate-700 overflow-hidden cursor-crosshair"
        title="Haz clic en el mapa para fijar la ubicación"
      >
        <ComposableMap
          projection="geoMercator"
          projectionConfig={{ scale: PROJ_SCALE, center: PROJ_CENTER }}
          style={{ width: '100%', height: 280 }}
        >
          <PickerGeo />
          {/* Posición de la ciudad (referencia, gris) */}
          {cityCoords && !hasCustom && (
            <Marker coordinates={[cityCoords.lon, cityCoords.lat]}>
              <circle r={7} fill="#64748b80" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="3 2" />
              <text textAnchor="middle" y={-12} fontSize={9} fill="#94a3b8" style={{ pointerEvents: 'none' }}>
                {ciudad} (auto)
              </text>
            </Marker>
          )}
          {/* Posición fijada por el admin */}
          {hasCustom && (
            <Marker coordinates={[lon as number, lat as number]}>
              <circle r={8} fill="#38bdf8" stroke="#fff" strokeWidth={2} style={{ filter: 'drop-shadow(0 0 6px #38bdf8)' }} />
              <text textAnchor="middle" y={-13} fontSize={9} fill="#e2e8f0" fontWeight="bold" style={{ pointerEvents: 'none', textShadow: '0 1px 2px #000' }}>
                📍 Ubicación fijada
              </text>
            </Marker>
          )}
        </ComposableMap>
        <p className="absolute bottom-2 left-3 text-[10px] text-slate-500 pointer-events-none">
          Haz clic para fijar la ubicación exacta
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-500">Lat:</span>
          <input
            type="number" step="0.0001"
            value={lat ?? ''}
            placeholder={cityCoords ? String(cityCoords.lat) : '—'}
            onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value), lon ?? null)}
            className="w-28 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-sky-500"
          />
          <span className="text-slate-500">Lon:</span>
          <input
            type="number" step="0.0001"
            value={lon ?? ''}
            placeholder={cityCoords ? String(cityCoords.lon) : '—'}
            onChange={e => onChange(lat ?? null, e.target.value === '' ? null : Number(e.target.value))}
            className="w-28 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-sky-500"
          />
        </div>
        {hasCustom && (
          <button
            type="button"
            onClick={() => onChange(null, null)}
            className="text-xs px-3 py-1.5 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors font-semibold"
          >
            ✕ Quitar ubicación (usar ciudad)
          </button>
        )}
        {!hasCustom && cityCoords && (
          <span className="text-[10px] text-slate-500">Usando posición automática de {ciudad}</span>
        )}
        {!hasCustom && !cityCoords && ciudad && (
          <span className="text-[10px] text-amber-500">⚠ &quot;{ciudad}&quot; no está en el catálogo — fija la ubicación manualmente</span>
        )}
      </div>
    </div>
  );
}

function PickerGeo() {
  const [geo, setGeo] = useState<object | null>(null);

  useEffect(() => {
    fetch('https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson')
      .then(r => r.json())
      .then(d => {
        const pry = (d.features as Array<{ properties: { ADMIN: string } }>)
          .find(f => f.properties.ADMIN === 'Paraguay');
        if (pry) setGeo({ type: 'FeatureCollection', features: [pry] });
      })
      .catch(() => {});
  }, []);

  const source = geo ?? 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';
  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <Geographies geography={source as any}>
      {({ geographies }) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (geographies as any[])
          .filter((g: any) => geo ? true : g.properties?.name === 'Paraguay')
          .map((g: any) => (
            <Geography key={g.rsmKey} geography={g} fill="#1e293b" stroke="#334155" strokeWidth={1} style={{ default: { outline: 'none' }, hover: { outline: 'none', fill: '#243449' }, pressed: { outline: 'none' } } as never} />
          ))
      }
    </Geographies>
  );
}
