'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import React, { useEffect, useRef } from 'react';
import type { Hospital, HospitalSummary } from '@/types/plant';
import { getHospitalCoords, spreadOverlaps, ZONE_COLORS } from '@/lib/paraguay';
import { loadGoogleMaps, DARK_MAP_STYLE, PY_CENTER, PY_ZOOM, markerIcon } from '@/lib/googleMaps';

interface Props {
  summaries: HospitalSummary[];
  onSelect?: (hospital: Hospital) => void;
}

export default function GoogleParaguayMap({ summaries, onSelect }: Props) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const infoRef = useRef<any>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // Crear el mapa una sola vez
  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps().then(maps => {
      if (cancelled || !divRef.current || mapRef.current) return;
      mapRef.current = new maps.Map(divRef.current, {
        center: PY_CENTER,
        zoom: PY_ZOOM,
        styles: DARK_MAP_STYLE,
        backgroundColor: '#0f172a',
        mapTypeControl: true,
        mapTypeControlOptions: { style: maps.MapTypeControlStyle.DROPDOWN_MENU },
        streetViewControl: false,
        fullscreenControl: true,
        restriction: { latLngBounds: { north: -17.5, south: -29.0, west: -64.5, east: -52.5 }, strictBounds: false },
      });
      infoRef.current = new maps.InfoWindow();
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Actualizar marcadores cuando cambian los datos
  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps().then(maps => {
      if (cancelled || !mapRef.current) return;
      markersRef.current.forEach(m => m.setMap(null));
      markersRef.current = [];

      // Separar hospitales que comparten coordenadas (misma ciudad)
      const placed = summaries
        .map(s => ({ s, coords: getHospitalCoords(s.hospital) }))
        .filter(x => x.coords) as { s: HospitalSummary; coords: { lat: number; lon: number; zona: string } }[];
      const spread = spreadOverlaps(placed.map(x => ({ ...x.coords })));

      placed.forEach(({ s, coords }, i) => {
        const color = ZONE_COLORS[coords.zona] ?? '#38bdf8';
        const marker = new maps.Marker({
          map: mapRef.current,
          position: { lat: spread[i].lat, lng: spread[i].lon },
          title: s.hospital.nombre,
          icon: markerIcon(maps, color, s.isOnline, s.activeAlerts > 0),
          animation: s.activeAlerts > 0 ? maps.Animation.BOUNCE : undefined,
        });
        const html = `
          <div style="font-family:system-ui;min-width:180px">
            <p style="margin:0;font-weight:700;color:#0f172a">${esc(s.hospital.nombre)}</p>
            <p style="margin:2px 0 6px;font-size:11px;color:#64748b">${esc(s.hospital.ciudad)} · ${esc(coords.zona)}</p>
            <p style="margin:0;font-size:11px;font-weight:700;color:${s.isOnline ? '#16a34a' : '#dc2626'}">
              ● ${s.isOnline ? 'En línea' : 'Sin señal'}${s.activeAlerts > 0 ? ` · ${s.activeAlerts} alerta(s)` : ''}
            </p>
            ${s.latest && s.isOnline ? `<p style="margin:6px 0 0;font-size:11px;color:#334155">Pureza O₂: <b>${Number(s.latest.o2_purity_pct).toFixed(1)}%</b> · Caudal: <b>${Number(s.latest.o2_flow_m3h).toFixed(1)} m³/h</b></p>` : ''}
          </div>`;
        marker.addListener('mouseover', () => { infoRef.current.setContent(html); infoRef.current.open({ map: mapRef.current, anchor: marker }); });
        marker.addListener('mouseout', () => infoRef.current.close());
        marker.addListener('click', () => onSelectRef.current?.(s.hospital));
        markersRef.current.push(marker);
      });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [summaries]);

  return (
    <div className="relative w-full rounded-xl border border-slate-700 overflow-hidden">
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex flex-wrap gap-1.5 justify-center pointer-events-none">
        {Object.entries(ZONE_COLORS).slice(0, 8).map(([z, c]) => (
          <span key={z} className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-slate-900/80"
            style={{ color: c, border: `1px solid ${c}40` }}>
            <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: c }} />
            {z}
          </span>
        ))}
      </div>
      <div ref={divRef} style={{ width: '100%', height: 480, background: '#0f172a' }} />
    </div>
  );
}

function esc(s: string) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
