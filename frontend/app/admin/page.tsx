'use client';

import React, { useState, useCallback } from 'react';
import Link from 'next/link';
import { fetchHospitals, fetchPlantData, toggleHospital, deleteHospital } from '@/lib/api';
import { usePolling } from '@/hooks/usePolling';
import type { Hospital, PlantRow } from '@/types/plant';
import { buildAlerts } from '@/components/AlertBanner';

export default function AdminOverview() {
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [latestMap, setLatestMap] = useState<Record<string, PlantRow | null>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { hospitals: hs } = await fetchHospitals();
      setHospitals(hs);
      const entries = await Promise.all(hs.map(async (h: Hospital) => {
        try { const { rows } = await fetchPlantData(h.id); return [h.id, rows[rows.length - 1] ?? null]; }
        catch { return [h.id, null]; }
      }));
      setLatestMap(Object.fromEntries(entries));
      setError(null);
    } catch (err) { setError(err instanceof Error ? err.message : 'Error'); }
    finally { setLoading(false); }
  }, []);

  usePolling(load, 15_000);

  const handleToggle = async (h: Hospital) => { setTogglingId(h.id); try { await toggleHospital(h.id, !h.activo); await load(); } finally { setTogglingId(null); } };
  const handleDelete = async (h: Hospital) => {
    if (!confirm(`¿Eliminar "${h.nombre}"? Esta acción no se puede deshacer.`)) return;
    await deleteHospital(h.id); await load();
  };
  const totalAlerts = Object.entries(latestMap).reduce((acc, [id, latest]) => {
    if (!latest) return acc;
    const h = hospitals.find(x => x.id === id);
    return acc + (h ? buildAlerts(latest, h).length : 0);
  }, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-black text-slate-100">Resumen Administrativo</h1>
        <Link href="/admin/hospitals" className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-sm font-bold transition-colors">+ Agregar hospital</Link>
      </div>
      {error && <div className="rounded-xl bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-400">{error}</div>}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total',     value: hospitals.length,                       color: 'text-sky-400' },
          { label: 'Activos',   value: hospitals.filter(h => h.activo).length, color: 'text-green-400' },
          { label: 'Inactivos', value: hospitals.filter(h => !h.activo).length,color: 'text-slate-400' },
          { label: 'Alertas',   value: totalAlerts, color: totalAlerts > 0 ? 'text-red-400' : 'text-slate-500' },
        ].map(s => (
          <div key={s.label} className="rounded-xl bg-slate-800 border border-slate-700 p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{s.label}</p>
            <p className={`text-3xl font-black mt-1 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>
      {loading ? (
        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="rounded-xl bg-slate-800 border border-slate-700 h-16 animate-pulse" />)}</div>
      ) : (
        <>
          {/* Tarjetas en móvil */}
          <div className="md:hidden space-y-3">
            {hospitals.map(h => {
              const latest = latestMap[h.id];
              const alerts = latest ? buildAlerts(latest, h).length : 0;
              return (
                <div key={h.id} className="rounded-xl border border-slate-700 bg-slate-900/50 p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-slate-200">{h.nombre}</p>
                      <p className="text-xs text-slate-500">{h.ciudad} · {h.direccion}</p>
                    </div>
                    <span className={`flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${h.activo ? 'bg-green-500/20 text-green-400' : 'bg-slate-700 text-slate-500'}`}>
                      {h.activo ? 'Activo' : 'Inactivo'}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-xs">
                    <div>
                      <p className="text-slate-500 text-[10px] uppercase tracking-wider">Pureza O₂</p>
                      {latest
                        ? <span className={`font-bold ${latest.o2_purity_pct >= h.thresholds.o2_purity_warn ? 'text-green-400' : latest.o2_purity_pct >= h.thresholds.o2_purity_critical ? 'text-amber-400' : 'text-red-400'}`}>{latest.o2_purity_pct.toFixed(1)}%</span>
                        : <span className="text-slate-600">—</span>}
                    </div>
                    <div>
                      <p className="text-slate-500 text-[10px] uppercase tracking-wider">Alertas</p>
                      {alerts > 0 ? <span className="text-red-400 font-bold">{alerts} ⚠</span> : <span className="text-slate-600">—</span>}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-800">
                    <Link href={`/hospital/${h.id}`} className="text-xs px-3 py-1.5 rounded-lg bg-sky-500/20 text-sky-400 hover:bg-sky-500/30 transition-colors font-semibold">Ver dashboard</Link>
                    <Link href={`/admin/hospital/${h.id}`} className="text-xs px-3 py-1.5 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors font-semibold">Configurar</Link>
                    <button onClick={() => handleToggle(h)} disabled={togglingId === h.id}
                      className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-colors ${h.activo ? 'bg-amber-500/20 text-amber-400' : 'bg-green-500/20 text-green-400'}`}>
                      {togglingId === h.id ? '…' : h.activo ? 'Desactivar' : 'Activar'}
                    </button>
                    <button onClick={() => handleDelete(h)} className="text-xs px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors font-semibold">Eliminar</button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Tabla en desktop */}
          <div className="hidden md:block rounded-xl border border-slate-700 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-800/80">
                  <tr>{['Hospital','Ciudad','Estado','Pureza O₂','Alertas','Acciones'].map(h => <th key={h} className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-500 whitespace-nowrap">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {hospitals.map(h => {
                    const latest = latestMap[h.id];
                    const alerts = latest ? buildAlerts(latest, h).length : 0;
                    return (
                      <tr key={h.id} className="bg-slate-900/50 hover:bg-slate-800/50 transition-colors">
                        <td className="px-4 py-3"><p className="font-semibold text-slate-200">{h.nombre}</p><p className="text-[10px] text-slate-500">{h.direccion}</p></td>
                        <td className="px-4 py-3 text-slate-400">{h.ciudad}</td>
                        <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${h.activo ? 'bg-green-500/20 text-green-400' : 'bg-slate-700 text-slate-500'}`}>{h.activo ? 'Activo' : 'Inactivo'}</span></td>
                        <td className="px-4 py-3">{latest ? <span className={`font-bold ${latest.o2_purity_pct >= h.thresholds.o2_purity_warn ? 'text-green-400' : latest.o2_purity_pct >= h.thresholds.o2_purity_critical ? 'text-amber-400' : 'text-red-400 animate-pulse'}`}>{latest.o2_purity_pct.toFixed(1)}%</span> : <span className="text-slate-600">—</span>}</td>
                        <td className="px-4 py-3">{alerts > 0 ? <span className="text-red-400 font-bold animate-pulse">{alerts} ⚠</span> : <span className="text-slate-600">—</span>}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Link href={`/hospital/${h.id}`} className="text-[10px] px-2 py-1 rounded-lg bg-sky-500/20 text-sky-400 hover:bg-sky-500/30 transition-colors font-semibold">Ver</Link>
                            <Link href={`/admin/hospital/${h.id}`} className="text-[10px] px-2 py-1 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors font-semibold">Config</Link>
                            <button onClick={() => handleToggle(h)} disabled={togglingId === h.id} className={`text-[10px] px-2 py-1 rounded-lg font-semibold transition-colors ${h.activo ? 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30' : 'bg-green-500/20 text-green-400 hover:bg-green-500/30'}`}>{togglingId === h.id ? '...' : h.activo ? 'Desactivar' : 'Activar'}</button>
                            <button onClick={() => handleDelete(h)} className="text-[10px] px-2 py-1 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors font-semibold">Eliminar</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
