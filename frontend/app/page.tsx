'use client';

import React, { useState, useCallback } from 'react';
import HospitalCard from '@/components/HospitalCard';
import { fetchHospitals, fetchPlantData } from '@/lib/api';
import { usePolling } from '@/hooks/usePolling';
import type { Hospital, HospitalSummary } from '@/types/plant';
import { buildAlerts } from '@/components/AlertBanner';

export default function OverviewPage() {
  const [summaries,  setSummaries]  = useState<HospitalSummary[]>([]);
  const [isLoading,  setIsLoading]  = useState(true);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [error,      setError]      = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { hospitals } = await fetchHospitals();
      const results = await Promise.all(
        hospitals.map(async (h: Hospital) => {
          try {
            const { rows } = await fetchPlantData(h.id);
            const latest   = rows[rows.length - 1] ?? null;
            const isOnline = latest ? Date.now() - new Date(latest.timestamp ?? 0).getTime() < 120_000 : false;
            const activeAlerts = latest ? buildAlerts(latest, h).length : 0;
            return { hospital: h, latest, isOnline, activeAlerts } as HospitalSummary;
          } catch {
            return { hospital: h, latest: null, isOnline: false, activeAlerts: 0 };
          }
        })
      );
      setSummaries(results);
      setLastUpdate(new Date().toLocaleTimeString('es-CO', { hour12: false }));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de conexión');
    } finally {
      setIsLoading(false);
    }
  }, []);

  usePolling(load, 10_000);

  const totalHospitals = summaries.length;
  const online         = summaries.filter(s => s.isOnline).length;
  const totalAlerts    = summaries.reduce((a, s) => a + s.activeAlerts, 0);
  const active         = summaries.filter(s => s.hospital.activo).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-100 tracking-tight">Monitor de Gases Medicinales</h1>
          <p className="text-sm text-slate-500 mt-0.5">Red de hospitales — actualización cada 10 s</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          {lastUpdate ? `Actualizado: ${lastUpdate}` : 'Cargando…'}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Hospitales', value: totalHospitals, color: 'text-sky-400', pulse: false },
          { label: 'Activos',    value: active,         color: 'text-slate-300', pulse: false },
          { label: 'En línea',   value: online,         color: 'text-green-400', pulse: false },
          { label: 'Alertas',    value: totalAlerts,    color: totalAlerts > 0 ? 'text-red-400' : 'text-slate-500', pulse: totalAlerts > 0 },
        ].map(s => (
          <div key={s.label} className="rounded-xl bg-slate-800/80 border border-slate-700 p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{s.label}</p>
            <p className={`text-3xl font-black tabular-nums mt-1 ${s.color} ${s.pulse ? 'animate-pulse' : ''}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {error && <div className="rounded-xl bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-400">{error}</div>}

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1,2,3].map(i => <div key={i} className="rounded-xl bg-slate-800 border border-slate-700 h-44 animate-pulse" />)}
        </div>
      ) : summaries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-700 p-12 text-center">
          <p className="text-4xl mb-3">🏥</p>
          <p className="text-slate-400 font-semibold">No hay hospitales registrados</p>
          <a href="/admin/hospitals" className="inline-block mt-4 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm font-semibold transition-colors">+ Agregar hospital</a>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {summaries.map(s => <HospitalCard key={s.hospital.id} summary={s} />)}
        </div>
      )}
    </div>
  );
}
