'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import React, { useEffect, useRef } from 'react';
import type { Hospital, HospitalSummary } from '@/types/plant';
import { getHospitalCoords, spreadOverlaps, ZONE_COLORS } from '@/lib/paraguay';
import { loadLeaflet, createBaseMap, markerDivIcon } from '@/lib/leafletMaps';

interface Props {
  summaries: HospitalSummary[];
  onSelect?: (hospital: Hospital) => void;
}

export default function LeafletParaguayMap({ summaries, onSelect }: Props) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // Crear el mapa una sola vez
  useEffect(() => {
    let cancelled = false;
    loadLeaflet().then(L => {
      if (cancelled || !divRef.current || mapRef.current) return;
      const map = createBaseMap(L, divRef.current);
      mapRef.current = map;
      // Etiquetas de nombre visibles solo con zoom cercano (evita amontonamiento)
      const updateLabels = () => {
        map.getContainer().classList.toggle('lf-show-labels', map.getZoom() >= 8);
      };
      map.on('zoomend', updateLabels);
      updateLabels();
    }).catch(() => {});
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // Actualizar marcadores cuando cambian los datos
  useEffect(() => {
    let cancelled = false;
    loadLeaflet().then(L => {
      if (cancelled || !mapRef.current) return;
      markersRef.current.forEach(m => m.remove());
      markersRef.current = [];

      // Separar hospitales que comparten coordenadas (misma ciudad)
      const placed = summaries
        .map(s => ({ s, coords: getHospitalCoords(s.hospital) }))
        .filter(x => x.coords) as { s: HospitalSummary; coords: { lat: number; lon: number; zona: string } }[];
      const spread = spreadOverlaps(placed.map(x => ({ ...x.coords })));

      placed.forEach(({ s, coords }, i) => {
        const color = ZONE_COLORS[coords.zona] ?? '#38bdf8';
        const marker = L.marker([spread[i].lat, spread[i].lon], {
          icon: markerDivIcon(L, color, s.isOnline, s.activeAlerts > 0),
          title: s.hospital.nombre,
        }).addTo(mapRef.current);
        // Etiqueta con el nombre, visible solo al acercar el zoom
        const nombre = s.hospital.nombre.length > 24 ? s.hospital.nombre.slice(0, 22) + '…' : s.hospital.nombre;
        marker.bindTooltip(nombre, {
          permanent: true, direction: 'bottom', offset: [0, 8],
          className: 'lf-hosp-label', opacity: 0.95,
        });

        const html = `
          <div style="font-family:system-ui;min-width:180px">
            <p style="margin:0;font-weight:700">${esc(s.hospital.nombre)}</p>
            <p style="margin:2px 0 6px;font-size:11px;color:#64748b">${esc(s.hospital.ciudad)} · ${esc(coords.zona)}</p>
            <p style="margin:0;font-size:11px;font-weight:700;color:${s.isOnline ? '#16a34a' : '#dc2626'}">
              ● ${s.isOnline ? 'En línea' : 'Sin señal'}${s.activeAlerts > 0 ? ` · ${s.activeAlerts} alerta(s)` : ''}
            </p>
            ${s.latest && s.isOnline ? `<p style="margin:6px 0 0;font-size:11px;color:#334155">Pureza O₂: <b>${Number(s.latest.o2_purity_pct).toFixed(1)}%</b> · Caudal: <b>${Number(s.latest.o2_flow_m3h).toFixed(1)} m³/h</b></p>` : ''}
          </div>`;
        marker.bindPopup(html, { closeButton: false });
        marker.on('mouseover', () => marker.openPopup());
        marker.on('mouseout', () => marker.closePopup());
        marker.on('click', () => onSelectRef.current?.(s.hospital));
        markersRef.current.push(marker);
      });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [summaries]);

  return (
    <div className="relative w-full rounded-xl border border-slate-700 overflow-hidden">
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[500] flex flex-wrap gap-1.5 justify-center pointer-events-none">
        {Object.entries(ZONE_COLORS).slice(0, 8).map(([z, c]) => (
          <span key={z} className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-slate-900/80"
            style={{ color: c, border: `1px solid ${c}40` }}>
            <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: c }} />
            {z}
          </span>
        ))}
      </div>
      <div ref={divRef} style={{ width: '100%', height: 480, background: '#0f172a' }} />
      <style>{`
        .lf-hosp-label {
          display: none;
          background: rgba(15, 23, 42, 0.85);
          border: 1px solid #334155;
          border-radius: 6px;
          color: #e2e8f0;
          font-size: 10px;
          font-weight: 600;
          padding: 1px 6px;
          box-shadow: 0 1px 4px rgba(0,0,0,.5);
        }
        .lf-hosp-label::before { display: none; }
        .lf-show-labels .lf-hosp-label { display: block; }
      `}</style>
    </div>
  );
}

function esc(s: string) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
