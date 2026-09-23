'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import React, { useEffect, useRef } from 'react';
import { getCityCoords } from '@/lib/paraguay';
import { loadGoogleMaps, DARK_MAP_STYLE, PY_CENTER, PY_ZOOM } from '@/lib/googleMaps';

interface Props {
  lat?: number | null;
  lon?: number | null;
  ciudad?: string;
  onChange: (lat: number | null, lon: number | null) => void;
}

export default function GoogleMapPicker({ lat, lon, ciudad, onChange }: Props) {
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
    loadGoogleMaps().then(maps => {
      if (cancelled || !divRef.current || mapRef.current) return;
      mapRef.current = new maps.Map(divRef.current, {
        center: PY_CENTER,
        zoom: PY_ZOOM,
        styles: DARK_MAP_STYLE,
        backgroundColor: '#0f172a',
        streetViewControl: false,
        mapTypeControl: true,
        mapTypeControlOptions: { style: maps.MapTypeControlStyle.DROPDOWN_MENU },
        fullscreenControl: false,
        draggableCursor: 'crosshair',
      });
      mapRef.current.addListener('click', (e: any) => {
        onChangeRef.current(+e.latLng.lat().toFixed(6), +e.latLng.lng().toFixed(6));
      });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Sincronizar el marcador con lat/lon (o referencia de ciudad)
  useEffect(() => {
    loadGoogleMaps().then(maps => {
      if (!mapRef.current) return;
      const pos = hasCustom
        ? { lat: lat as number, lng: lon as number }
        : cityCoords ? { lat: cityCoords.lat, lng: cityCoords.lon } : null;

      if (!pos) { markerRef.current?.setMap(null); markerRef.current = null; return; }

      if (!markerRef.current) {
        markerRef.current = new maps.Marker({ map: mapRef.current, draggable: true });
        markerRef.current.addListener('dragend', (e: any) => {
          onChangeRef.current(+e.latLng.lat().toFixed(6), +e.latLng.lng().toFixed(6));
        });
      }
      markerRef.current.setPosition(pos);
      markerRef.current.setOpacity(hasCustom ? 1 : 0.55);
      markerRef.current.setTitle(hasCustom ? 'Ubicación fijada (arrástrame)' : `${ciudad ?? ''} (posición automática)`);
      if (hasCustom && mapRef.current.getZoom() < 9) {
        mapRef.current.panTo(pos);
      }
    }).catch(() => {});
  }, [lat, lon, hasCustom, cityCoords, ciudad]);

  return (
    <div className="space-y-2">
      <div className="relative rounded-xl border border-slate-700 overflow-hidden">
        <div ref={divRef} style={{ width: '100%', height: 320, background: '#0f172a' }} />
        <p className="absolute bottom-2 left-3 text-[10px] text-slate-400 bg-slate-900/80 px-2 py-0.5 rounded pointer-events-none">
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
