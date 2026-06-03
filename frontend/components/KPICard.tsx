'use client';

import React from 'react';
import type { StatusLevel } from '@/types/plant';

interface KPICardProps {
  label:     string;
  value:     string | number;
  unit?:     string;
  status:    StatusLevel;
  sublabel?: string;
  icon?:     React.ReactNode;
  trend?:    'up' | 'down' | 'stable';
}

const border: Record<StatusLevel, string> = {
  ok:      'border-green-500',
  warn:    'border-amber-500',
  danger:  'border-red-500',
  info:    'border-sky-500',
  neutral: 'border-slate-600',
};

const glow: Record<StatusLevel, string> = {
  ok:      'shadow-[0_0_18px_-4px_rgba(34,197,94,0.4)]',
  warn:    'shadow-[0_0_18px_-4px_rgba(245,158,11,0.4)]',
  danger:  'shadow-[0_0_18px_-4px_rgba(239,68,68,0.5)] animate-pulse',
  info:    'shadow-[0_0_18px_-4px_rgba(56,189,248,0.4)]',
  neutral: '',
};

const valueColor: Record<StatusLevel, string> = {
  ok:      'text-green-400',
  warn:    'text-amber-400',
  danger:  'text-red-400',
  info:    'text-sky-400',
  neutral: 'text-slate-300',
};

const trendIcon = { up: '↑', down: '↓', stable: '→' };
const trendColor = { up: 'text-green-400', down: 'text-red-400', stable: 'text-slate-400' };

export default function KPICard({ label, value, unit, status, sublabel, icon, trend }: KPICardProps) {
  return (
    <div className={`relative rounded-xl border-l-4 bg-slate-800/80 backdrop-blur p-4 flex flex-col gap-1 transition-all duration-300 ${border[status]} ${glow[status]}`}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{label}</span>
        {icon && <span className="text-slate-500 text-sm">{icon}</span>}
      </div>
      <div className="flex items-baseline gap-1.5 mt-1">
        <span className={`text-3xl font-black tabular-nums tracking-tight ${valueColor[status]}`}>
          {value}
        </span>
        {unit && <span className="text-xs font-semibold text-slate-500">{unit}</span>}
        {trend && (
          <span className={`text-xs font-bold ml-auto ${trendColor[trend]}`}>
            {trendIcon[trend]}
          </span>
        )}
      </div>
      {sublabel && (
        <span className={`text-[10px] font-medium mt-0.5 ${
          status === 'danger' ? 'text-red-400 font-bold' :
          status === 'warn'   ? 'text-amber-400' :
                                'text-slate-500'
        }`}>
          {sublabel}
        </span>
      )}
      <div className={`absolute bottom-0 left-0 right-0 h-0.5 rounded-b-xl transition-all ${
        status === 'ok'     ? 'bg-green-500/50' :
        status === 'warn'   ? 'bg-amber-500/50' :
        status === 'danger' ? 'bg-red-500/60 animate-pulse' :
        status === 'info'   ? 'bg-sky-500/50' : 'bg-slate-700'
      }`} />
    </div>
  );
}

export function o2PurityStatus(pct: number, warn = 93, critical = 90): StatusLevel {
  if (pct >= warn)     return 'ok';
  if (pct >= critical) return 'warn';
  return 'danger';
}

export function rangeStatus(
  value: number,
  okMin: number, okMax: number,
  warnMin?: number, warnMax?: number,
): StatusLevel {
  if (value >= okMin && value <= okMax) return 'ok';
  if (warnMin !== undefined && warnMax !== undefined &&
      value >= warnMin && value <= warnMax) return 'warn';
  return 'danger';
}
