'use client';

import React, { useState, useCallback } from 'react';
import { usePolling } from '@/hooks/usePolling';
import { fetchHospitals, fetchAllLatest } from '@/lib/api';
import type { Hospital, HospitalSummary, PlantRow } from '@/types/plant';
import { buildAlerts } from '@/components/AlertBanner';
import { getHospitalCoords, getZone, ZONE_COLORS } from '@/lib/paraguay';
import dynamic from 'next/dynamic';
import Link from 'next/link';

const ParaguayMap = dynamic(() => import('@/components/ParaguayMap'), { ssr: false });

export default function MapaPage() {
  const [summaries, setSummaries] = useState<HospitalSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selected, setSelected] = useState<Hospital | null>(null);
  const [filterZone, setFilterZone] = useState<string>('all');

  const load = useCallback(async () => {
    const [{ hospitals }, latestRes] = await Promise.all([fetchHospitals(), fetchAllLatest()]);
    const latestMap: Record<string, PlantRow | null> = {};
    (latestRes.rows ?? []).forEach((r: PlantRow) => { latestMap[r.hospital_id] = r; });
    const refMs = latestRes.now ? new Date(latestRes.now).getTime() : Date.now();

    const results = hospitals.map((h: Hospital) => {
      const latest = latestMap[h.id] ?? null;
      let isOnline = false;
      if (latest?.timestamp) {
        const ageMs = refMs - new Date(latest.timestamp).getTime();
        isOnline = ageMs < 60_000 && ageMs > -60_000;
      }
      return { hospital: h, latest, isOnline, activeAlerts: latest ? buildAlerts(latest, h).length : 0 };
    }) as HospitalSummary[];

    setSummaries(results);
    setIsLoading(false);
  }, []);

  usePolling(load, 15_000);

  const byZone = summaries.reduce<Record<string, HospitalSummary[]>>((acc, s) => {
    const z = getZone(s.hospital.ciudad);
    acc[z] = [...(acc[z] ?? []), s];
    return acc;
  }, {});

  const displayed = filterZone === 'all'
    ? summaries
    : summaries.filter(s => getZone(s.hospital.ciudad) === filterZone);

  const selectedSummary = selected ? summaries.find(s => s.hospital.id === selected.id) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-100 tracking-tight">Mapa de Plantas</h1>
          <p className="text-sm text-slate-500 mt-0.5">Paraguay — distribución geográfica de plantas de gases medicinales</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={filterZone}
            onChange={e => setFilterZone(e.target.value)}
            className="bg-slate-800 border border-slate-700 text-slate-300 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-sky-500"
          >
            <option value="all">Todas las zonas</option>
            {Object.keys(byZone).sort().map(z => (
              <option key={z} value={z}>{z} ({byZone[z].length})</option>
            ))}
          </select>
        </div>
      </div>

      {!isLoading && Object.keys(byZone).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(byZone).map(([zone, list]) => {
            const online = list.filter(s => s.isOnline).length;
            const alerts = list.reduce((a, s) => a + s.activeAlerts, 0);
            const color = ZONE_COLORS[zone] ?? ZONE_COLORS['Desconocido'];
            return (
              <button
                key={zone}
                onClick={() => setFilterZone(filterZone === zone ? 'all' : zone)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-bold transition-all ${
                  filterZone === zone ? 'bg-opacity-30' : 'bg-slate-800/60 opacity-80 hover:opacity-100'
                }`}
                style={{ borderColor: `${color}50`, color, background: filterZone === zone ? `${color}20` : undefined }}
              >
                <span className="w-2 h-2 rounded-full" style={{ background: color }} />
                {zone}
                <span className="font-normal text-slate-400">{online}/{list.length} online</span>
                {alerts > 0 && <span className="text-red-400">{alerts}⚠</span>}
              </button>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          {isLoading ? (
            <div className="rounded-xl bg-slate-800 border border-slate-700 h-[420px] animate-pulse" />
          ) : (
            <ParaguayMap
              summaries={displayed}
              onSelect={h => setSelected(h.id === selected?.id ? null : h)}
            />
          )}
        </div>

        <div className="space-y-3 overflow-y-auto max-h-[480px] pr-1">
          {selected && selectedSummary ? (
            <SelectedPanel summary={selectedSummary} onClose={() => setSelected(null)} />
          ) : (
            <>
              <p className="text-xs text-slate-500 font-semibold uppercase tracking-widest">Plantas — {filterZone === 'all' ? 'Todas las zonas' : filterZone}</p>
              {displayed.length === 0 && (
                <p className="text-slate-600 text-sm">Sin plantas para mostrar.</p>
              )}
              {displayed.map(s => {
                const coords = getHospitalCoords(s.hospital);
                const zona = coords?.zona ?? 'Desconocido';
                const color = ZONE_COLORS[zona] ?? ZONE_COLORS['Desconocido'];
                return (
                  <button
                    key={s.hospital.id}
                    onClick={() => setSelected(s.hospital)}
                    className="w-full text-left rounded-xl bg-slate-800/80 border border-slate-700 p-3 hover:border-sky-500/50 transition-all group"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-bold text-slate-200 group-hover:text-sky-400 transition-colors">{s.hospital.nombre}</p>
                        <p className="text-[10px] text-slate-500">{s.hospital.ciudad}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                          s.isOnline ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                        }`}>
                          {s.isOnline ? 'ONLINE' : 'OFFLINE'}
                        </span>
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: `${color}20`, color }}>
                          {zona}
                        </span>
                      </div>
                    </div>
                    {s.activeAlerts > 0 && (
                      <p className="text-[10px] text-red-400 mt-1 font-bold">{s.activeAlerts} alerta(s) activa(s)</p>
                    )}
                    {!coords && (
                      <p className="text-[10px] text-amber-500 mt-1">⚠ Sin ubicación — fíjala en Admin → Configurar</p>
                    )}
                  </button>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SelectedPanel({ summary, onClose }: { summary: HospitalSummary; onClose: () => void }) {
  const { hospital, latest, isOnline, activeAlerts } = summary;
  const coords = getHospitalCoords(hospital);
  const zona = coords?.zona ?? 'Desconocido';
  const color = ZONE_COLORS[zona] ?? ZONE_COLORS['Desconocido'];

  return (
    <div className="rounded-xl bg-slate-800 border border-sky-500/40 p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div>
          <p className="font-bold text-slate-100">{hospital.nombre}</p>
          <p className="text-xs text-slate-400">{hospital.ciudad} · {hospital.direccion}</p>
        </div>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-200 text-lg leading-none">×</button>
      </div>

      <div className="flex items-center gap-2">
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${isOnline ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
          {isOnline ? 'En línea' : 'Sin señal'}
        </span>
        <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: `${color}20`, color }}>
          {zona}
        </span>
        {activeAlerts > 0 && <span className="text-xs text-red-400 font-bold">{activeAlerts}⚠</span>}
      </div>

      {latest && isOnline && (
        <div className="grid grid-cols-2 gap-2">
          {[
            ['Pureza O₂', `${latest.o2_purity_pct.toFixed(1)}%`],
            ['Caudal', `${latest.o2_flow_m3h.toFixed(1)} m³/h`],
            ['Presión Tanque', `${latest.o2_tank_pressure_bar.toFixed(1)} bar`],
            ['Vacío', `${latest.vacuum_level_mmhg.toFixed(0)} mmHg`],
          ].map(([l, v]) => (
            <div key={l} className="rounded-lg bg-slate-900/60 p-2">
              <p className="text-[9px] text-slate-500 uppercase">{l}</p>
              <p className="text-xs font-bold text-sky-400 mt-0.5">{v}</p>
            </div>
          ))}
        </div>
      )}

      <Link
        href={`/hospital/${hospital.id}`}
        className="block text-center text-xs font-bold bg-sky-600 hover:bg-sky-500 text-white rounded-lg py-1.5 transition-colors"
      >
        Ver detalles →
      </Link>
    </div>
  );
}
