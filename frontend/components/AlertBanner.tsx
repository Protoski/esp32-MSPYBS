'use client';

import React from 'react';
import type { PlantRow, Hospital } from '@/types/plant';

interface Alert { level: 'critical' | 'warning'; message: string; }

export function buildAlerts(latest: PlantRow, hospital: Hospital): Alert[] {
  const t = hospital.thresholds;
  const alerts: Alert[] = [];
  if (latest.o2_purity_pct < t.o2_purity_critical)
    alerts.push({ level: 'critical', message: `⚠ Pureza O₂ CRÍTICA: ${latest.o2_purity_pct.toFixed(1)}% (límite: ${t.o2_purity_critical}%)` });
  else if (latest.o2_purity_pct < t.o2_purity_warn)
    alerts.push({ level: 'warning', message: `Pureza O₂ baja: ${latest.o2_purity_pct.toFixed(1)}% (umbral: ${t.o2_purity_warn}%)` });
  if (latest.compressor_status === 'FAULT')
    alerts.push({ level: 'critical', message: '⚠ FALLA detectada en Compresor de Aire' });
  if (latest.vacuum_pump_status === 'FAULT')
    alerts.push({ level: 'critical', message: '⚠ FALLA detectada en Bomba de Vacío' });
  if (latest.air_line_pressure_bar < t.air_pressure_min)
    alerts.push({ level: 'warning', message: `Presión de aire baja: ${latest.air_line_pressure_bar.toFixed(2)} bar (mín: ${t.air_pressure_min} bar)` });
  if (latest.vacuum_level_mmhg > t.vacuum_min_mmhg)
    alerts.push({ level: 'warning', message: `Vacío insuficiente: ${latest.vacuum_level_mmhg.toFixed(0)} mmHg (mín: ${t.vacuum_min_mmhg} mmHg)` });
  return alerts;
}

export default function AlertBanner({ latest, hospital }: { latest: PlantRow; hospital: Hospital }) {
  const alerts = buildAlerts(latest, hospital);
  if (alerts.length === 0) return null;
  return (
    <div className="space-y-2">
      {alerts.map((a, i) => (
        <div key={i} className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium border ${
          a.level === 'critical' ? 'bg-red-500/10 border-red-500/40 text-red-300 animate-pulse' : 'bg-amber-500/10 border-amber-500/40 text-amber-300'}`}>
          <span className="text-lg">{a.level === 'critical' ? '🚨' : '⚠️'}</span>
          <span>{a.message}</span>
        </div>
      ))}
    </div>
  );
}
