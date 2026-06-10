'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import React, { useEffect, useRef } from 'react';
import { getCityCoords } from '@/lib/paraguay';
import { loadLeaflet, createBaseMap } from '@/lib/leafletMaps';

interface Props {
  lat?: number | null;
  lon?: number | null;
  ciudad?: string;
  onChange: (lat: number | null, lon: number | null) => void;
}

export default function LeafletMapPicker({ lat, lon, ciudad, onChange }: Props) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const hasCustom = typeof lat === 'number' && typeof lon === 'number';
  const cityCoords = ciudad ? getCityCoords(ciudad) : null;

  // Crear el mapa una sola vez; clic fija la ubicación
  useEffect(() => {
    let cancelled = false;
    loadLeaflet().then(L => {
      if (cancelled || !divRef.current || mapRef.current) return;
      mapRef.current = createBaseMap(L, divRef.current);
      mapRef.current.getContainer().style.cursor = 'crosshair';
      mapRef.current.on('click', (e: any) => {
        onChangeRef.current(+e.latlng.lat.toFixed(6), +e.latlng.lng.toFixed(6));
      });
    }).catch(() => {});
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // Sincronizar el marcador con lat/lon (o referencia de ciudad)
  useEffect(() => {
    loadLeaflet().then(L => {
      if (!mapRef.current) return;
      const pos: [number, number] | null = hasCustom
        ? [lat as number, lon as number]
        : cityCoords ? [cityCoords.lat, cityCoords.lon] : null;

      if (!pos) { markerRef.current?.remove(); markerRef.current = null; return; }

      if (!markerRef.current) {
        markerRef.current = L.marker(pos, { draggable: true }).addTo(mapRef.current);
        markerRef.current.on('dragend', (e: any) => {
          const p = e.target.getLatLng();
          onChangeRef.current(+p.lat.toFixed(6), +p.lng.toFixed(6));
        });
      }
      markerRef.current.setLatLng(pos);
      markerRef.current.setOpacity(hasCustom ? 1 : 0.55);
      if (hasCustom && mapRef.current.getZoom() < 9) {
        mapRef.current.panTo(pos);
      }
    }).catch(() => {});
  }, [lat, lon, hasCustom, cityCoords, ciudad]);

  return (
    <div className="space-y-2">
      <div className="relative rounded-xl border border-slate-700 overflow-hidden">
        <div ref={divRef} style={{ width: '100%', height: 320, background: '#0f172a' }} />
        <p className="absolute bottom-2 left-3 z-[500] text-[10px] text-slate-400 bg-slate-900/80 px-2 py-0.5 rounded pointer-events-none">
          Haz clic en el mapa (o arrastra el marcador) para fijar la ubicación exacta
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-500">Lat:</span>
          <input
            type="number" step="0.000001"
            value={lat ?? ''}
            placeholder={cityCoords ? String(cityCoords.lat) : '—'}
            onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value), lon ?? null)}
            className="w-28 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-sky-500"
          />
          <span className="text-slate-500">Lon:</span>
          <input
            type="number" step="0.000001"
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
