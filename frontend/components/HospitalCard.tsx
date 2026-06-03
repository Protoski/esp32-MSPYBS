'use client';

import React from 'react';
import Link from 'next/link';
import type { HospitalSummary } from '@/types/plant';
import { o2PurityStatus } from './KPICard';

export default function HospitalCard({ summary }: { summary: HospitalSummary }) {
  const { hospital, latest, isOnline, activeAlerts } = summary;
  const purityStatus = latest ? o2PurityStatus(latest.o2_purity_pct, hospital.thresholds.o2_purity_warn, hospital.thresholds.o2_purity_critical) : 'neutral';

  return (
    <Link href={`/hospital/${hospital.id}`} className="block group">
      <div className={`rounded-xl border bg-slate-800/80 backdrop-blur p-5 transition-all duration-200
        hover:border-sky-500/50 hover:shadow-[0_0_20px_-4px_rgba(56,189,248,0.3)]
        ${!hospital.activo ? 'opacity-50 grayscale' : ''}
        ${activeAlerts > 0 ? 'border-red-500/50' : 'border-slate-700'}`}>
        <div className="flex items-start justify-between gap-2 mb-3">
          <div>
            <h3 className="font-bold text-slate-100 group-hover:text-sky-400 transition-colors">{hospital.nombre}</h3>
            <p className="text-xs text-slate-500">{hospital.ciudad} · {hospital.direccion}</p>
          </div>
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <span className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
              !hospital.activo ? 'bg-slate-700 text-slate-400' :
              isOnline ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${!hospital.activo ? 'bg-slate-500' : isOnline ? 'bg-green-400 animate-pulse' : 'bg-red-400 animate-pulse'}`} />
              {!hospital.activo ? 'Inactivo' : isOnline ? 'En línea' : 'Sin señal'}
            </span>
            {activeAlerts > 0 && (
              <span className="text-[10px] font-bold text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full animate-pulse">
                {activeAlerts} alerta{activeAlerts > 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
        {latest ? (
          <div className="grid grid-cols-3 gap-2">
            {[['Pureza O₂', `${latest.o2_purity_pct.toFixed(1)}%`, purityStatus],
              ['Caudal', `${latest.o2_flow_m3h.toFixed(1)} m³/h`, 'info'],
              ['Vacío', `${latest.vacuum_level_mmhg.toFixed(0)} mmHg`, latest.vacuum_level_mmhg < hospital.thresholds.vacuum_min_mmhg ? 'ok' : 'warn']
            ].map(([l, v, s]) => {
              const c = s === 'ok' ? 'text-green-400' : s === 'warn' ? 'text-amber-400' : s === 'danger' ? 'text-red-400' : s === 'info' ? 'text-sky-400' : 'text-slate-400';
              return (
                <div key={String(l)} className="rounded-lg bg-slate-900/60 p-2">
                  <p className="text-[9px] text-slate-500 uppercase tracking-wider">{l}</p>
                  <p className={`text-xs font-bold mt-0.5 ${c}`}>{v}</p>
                </div>
              );
            })}
          </div>
        ) : <p className="text-xs text-slate-600 text-center py-2">Sin datos disponibles</p>}
        {latest && (
          <div className="flex gap-2 mt-3 pt-3 border-t border-slate-700">
            {[['Compresor', latest.compressor_status], ['Vacío', latest.vacuum_pump_status], ['PSA', hospital.equipment.psa_enabled ? 'ON' : 'OFF']].map(([lbl, st]) => (
              <div key={String(lbl)} className={`flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                st === 'ON' ? 'bg-green-500/10 text-green-400' : st === 'FAULT' ? 'bg-red-500/10 text-red-400' : 'bg-slate-700 text-slate-500'}`}>
                <span className={`w-1 h-1 rounded-full ${st === 'ON' ? 'bg-green-400' : st === 'FAULT' ? 'bg-red-400' : 'bg-slate-500'}`} />
                {lbl}
              </div>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}
