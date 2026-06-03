'use client';

/**
 * KPICard — Tarjeta de indicador clave de rendimiento.
 * Cambia de color dinámicamente según el estado del valor.
 */

import React from 'react';

type StatusLevel = 'ok' | 'warn' | 'danger' | 'info' | 'neutral';

interface KPICardProps {
  label:    string;
  value:    string | number;
  unit?:    string;
  status:   StatusLevel;
  sublabel?: string;
  icon?:    React.ReactNode;
}

const statusStyles: Record<StatusLevel, string> = {
  ok:      'border-green-500  text-green-400',
  warn:    'border-amber-500  text-amber-400',
  danger:  'border-red-500    text-red-400 animate-pulse',
  info:    'border-sky-500    text-sky-400',
  neutral: 'border-slate-600  text-slate-400',
};

const statusBg: Record<StatusLevel, string> = {
  ok:      'bg-green-500/10',
  warn:    'bg-amber-500/10',
  danger:  'bg-red-500/10',
  info:    'bg-sky-500/10',
  neutral: 'bg-slate-700/30',
};

export default function KPICard({ label, value, unit, status, sublabel, icon }: KPICardProps) {
  return (
    <div
      className={`rounded-xl border-l-4 p-4 flex flex-col gap-1 ${statusStyles[status]} ${statusBg[status]} bg-slate-800`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">
          {label}
        </span>
        {icon && <span className="opacity-60">{icon}</span>}
      </div>

      <div className="flex items-baseline gap-1 mt-1">
        <span className={`text-3xl font-bold tabular-nums ${statusStyles[status]}`}>
          {value}
        </span>
        {unit && (
          <span className="text-sm font-medium text-slate-400">{unit}</span>
        )}
      </div>

      {sublabel && (
        <span className="text-xs text-slate-500 mt-1">{sublabel}</span>
      )}
    </div>
  );
}

// ── Helper para calcular el status de pureza de O2 ─────────
export function o2PurityStatus(pct: number): StatusLevel {
  if (pct >= 93) return 'ok';
  if (pct >= 90) return 'warn';
  return 'danger';
}

// ── Helper genérico de rango ────────────────────────────────
export function rangeStatus(
  value: number,
  okMin: number,
  okMax: number,
  warnMin?: number,
  warnMax?: number,
): StatusLevel {
  if (value >= okMin && value <= okMax) return 'ok';
  if (warnMin !== undefined && warnMax !== undefined) {
    if (value >= warnMin && value <= warnMax) return 'warn';
  }
  return 'danger';
}
