'use client';

import React, { useState, useEffect } from 'react';
import { ComposableMap, Geographies, Geography, Marker, ZoomableGroup } from 'react-simple-maps';
import type { Hospital } from '@/types/plant';
import type { HospitalSummary } from '@/types/plant';
import { getHospitalCoords, ZONE_COLORS } from '@/lib/paraguay';
import { hasGoogleMaps } from '@/lib/googleMaps';
import GoogleParaguayMap from './GoogleParaguayMap';
import LeafletParaguayMap from './LeafletParaguayMap';

interface Props {
  summaries: HospitalSummary[];
  onSelect?: (hospital: Hospital) => void;
}

interface MarkerData {
  hospital: Hospital;
  lat: number;
  lon: number;
  zona: string;
  isOnline: boolean;
  activeAlerts: number;
}

export default function ParaguayMap(props: Props) {
  // Google Maps solo si hay API key; por defecto OpenStreetMap (gratis, sin key)
  if (hasGoogleMaps) return <GoogleParaguayMap {...props} />;
  return <LeafletParaguayMap {...props} />;
}

function SvgParaguayMap({ summaries, onSelect }: Props) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; data: MarkerData } | null>(null);

  const markers: MarkerData[] = summaries
    .map(s => {
      const coords = getHospitalCoords(s.hospital);
      if (!coords) return null;
      const zona = coords.zona;
      return {
        hospital: s.hospital,
        lat: coords.lat,
        lon: coords.lon,
        zona,
        isOnline: s.isOnline,
        activeAlerts: s.activeAlerts,
      };
    })
    .filter(Boolean) as MarkerData[];

  return (
    <div className="relative w-full rounded-xl bg-slate-800/80 border border-slate-700 overflow-hidden">
      <div className="absolute top-3 left-3 z-10 text-xs text-slate-400 font-semibold">
        Paraguay — Plantas por Zona
      </div>
      <div className="absolute top-3 right-3 z-10 flex flex-wrap gap-1.5 max-w-[200px] justify-end">
        {Object.entries(ZONE_COLORS).slice(0, 7).map(([z, c]) => (
          <span key={z} className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-slate-900/60"
            style={{ color: c, border: `1px solid ${c}40` }}>
            <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: c }} />
            {z}
          </span>
        ))}
      </div>

      <ComposableMap
        projection="geoMercator"
        projectionConfig={{ scale: 1800, center: [-58.4, -23.5] }}
        style={{ width: '100%', height: 420 }}
      >
        <ZoomableGroup zoom={1} minZoom={0.8} maxZoom={6}>
          <ParaguayGeo />
          {markers.map(m => (
            <Marker
              key={m.hospital.id}
              coordinates={[m.lon, m.lat]}
              onMouseEnter={(evt) => {
                const el = evt.target as SVGElement;
                const rect = el.closest('svg')?.getBoundingClientRect();
                const pt = el.getBoundingClientRect();
                setTooltip({
                  x: pt.left - (rect?.left ?? 0) + pt.width / 2,
                  y: pt.top - (rect?.top ?? 0) - 8,
                  data: m,
                });
              }}
              onMouseLeave={() => setTooltip(null)}
              onClick={() => onSelect?.(m.hospital)}
            >
              <circle
                r={m.isOnline ? 9 : 7}
                fill={m.activeAlerts > 0 ? '#ef4444' : m.isOnline ? ZONE_COLORS[m.zona] ?? '#38bdf8' : '#475569'}
                stroke={m.isOnline ? '#fff' : '#64748b'}
                strokeWidth={m.isOnline ? 2 : 1}
                style={{ cursor: 'pointer', filter: m.isOnline ? `drop-shadow(0 0 6px ${ZONE_COLORS[m.zona] ?? '#38bdf8'})` : 'none' }}
                className={m.isOnline ? 'animate-pulse' : ''}
              />
              {m.activeAlerts > 0 && (
                <text textAnchor="middle" dy=".3em" fontSize={7} fill="#fff" style={{ pointerEvents: 'none', fontWeight: 'bold' }}>
                  !
                </text>
              )}
              <text
                textAnchor="middle"
                y={-14}
                fontSize={8}
                fill="#e2e8f0"
                style={{ pointerEvents: 'none', textShadow: '0 1px 2px #000' }}
              >
                {m.hospital.nombre.length > 18 ? m.hospital.nombre.slice(0, 16) + '…' : m.hospital.nombre}
              </text>
            </Marker>
          ))}
        </ZoomableGroup>
      </ComposableMap>

      {tooltip && (
        <div
          className="absolute z-20 pointer-events-none bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 shadow-xl text-xs"
          style={{ left: tooltip.x, top: tooltip.y, transform: 'translate(-50%, -100%)' }}
        >
          <p className="font-bold text-slate-100">{tooltip.data.hospital.nombre}</p>
          <p className="text-slate-400">{tooltip.data.hospital.ciudad} · {tooltip.data.zona}</p>
          <div className="flex items-center gap-1.5 mt-1">
            <span className={`w-2 h-2 rounded-full ${tooltip.data.isOnline ? 'bg-green-400' : 'bg-red-400'}`} />
            <span className={tooltip.data.isOnline ? 'text-green-400' : 'text-red-400'}>
              {tooltip.data.isOnline ? 'En línea' : 'Sin señal'}
            </span>
            {tooltip.data.activeAlerts > 0 && (
              <span className="text-red-400 font-bold">· {tooltip.data.activeAlerts} alerta(s)</span>
            )}
          </div>
        </div>
      )}

      {markers.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <p className="text-slate-500 text-sm">No hay hospitales con coordenadas conocidas</p>
        </div>
      )}
    </div>
  );
}

function ParaguayGeo() {
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

  if (!geo) {
    return (
      <Geographies geography="https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json">
        {({ geographies }) =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (geographies as any[])
            .filter((g: any) => g.properties?.name === 'Paraguay')
            .map((g: any) => (
              <Geography
                key={g.rsmKey}
                geography={g}
                fill="#1e293b"
                stroke="#334155"
                strokeWidth={1}
              />
            ))
        }
      </Geographies>
    );
  }

  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <Geographies geography={geo as any}>
      {({ geographies }) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (geographies as any[]).map((g: any) => (
          <Geography
            key={g.rsmKey}
            geography={g}
            fill="#1e293b"
            stroke="#334155"
            strokeWidth={1}
          />
        ))
      }
    </Geographies>
  );
}
