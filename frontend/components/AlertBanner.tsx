'use client';

import React from 'react';
import type { PlantRow, Hospital } from '@/types/plant';
import { purityEvaluable, plcFaults, unitsOf, unitHasType, unitLabel, isRowOnline } from '@/lib/plc';

interface Alert { level: 'critical' | 'warning'; message: string; }

// Alertas de un solo equipo, limitadas a su tipo (o2/air/vacuum) y a los
// equipos configurados en el hospital: si no existen, sus campos llegan en 0.
function unitAlerts(u: PlantRow, hospital: Hospital, prefix: string): Alert[] {
  const t = hospital.thresholds;
  const eq = hospital.equipment;
  const alerts: Alert[] = [];
  const push = (level: Alert['level'], message: string) => alerts.push({ level, message: prefix + message });
  if (u.plc_online === false)
    push('warning', 'Sin comunicación con el PLC: se muestra el último dato válido.');
  if (eq?.psa_enabled !== false && unitHasType(u, 'o2')) {
    if (purityEvaluable(u)) {
      if (u.o2_purity_pct < t.o2_purity_critical)
        push('critical', `⚠ Pureza O₂ CRÍTICA: ${u.o2_purity_pct.toFixed(1)}% (límite: ${t.o2_purity_critical}%)`);
      else if (u.o2_purity_pct < t.o2_purity_warn)
        push('warning', `Pureza O₂ baja: ${u.o2_purity_pct.toFixed(1)}% (umbral: ${t.o2_purity_warn}%)`);
    }
    for (const f of plcFaults(u))
      push(f.level, `${f.level === 'critical' ? '⚠ ' : ''}${f.text} (PLC)`);
  }
  if (eq?.compressor_enabled !== false && unitHasType(u, 'air')) {
    // Con PLC, el fallo del compresor ya sale en la lista de fallos del PLC
    if (u.compressor_status === 'FAULT' && u.plc_faults == null)
      push('critical', '⚠ FALLA detectada en Compresor de Aire');
    if (u.air_line_pressure_bar < t.air_pressure_min)
      push('warning', `Presión de aire baja: ${u.air_line_pressure_bar.toFixed(2)} bar (mín: ${t.air_pressure_min} bar)`);
  }
  if (eq?.vacuum_enabled !== false && unitHasType(u, 'vacuum')) {
    if (u.vacuum_pump_status === 'FAULT')
      push('critical', '⚠ FALLA detectada en Bomba de Vacío');
    if (u.vacuum_level_mmhg > t.vacuum_min_mmhg)
      push('warning', `Vacío insuficiente: ${u.vacuum_level_mmhg.toFixed(0)} mmHg (mín: ${t.vacuum_min_mmhg} mmHg)`);
  }
  return alerts;
}

// latest: fila de un hospital; si trae units (varios equipos) se evalúa cada
// uno por separado. Con nowMs, un equipo sin datos recientes genera aviso.
export function buildAlerts(latest: PlantRow, hospital: Hospital, nowMs?: number): Alert[] {
  const units = unitsOf(latest);
  if (units.length === 1) return unitAlerts(units[0], hospital, '');
  const alerts: Alert[] = [];
  for (const u of units) {
    const prefix = `${unitLabel(u)}: `;
    if (nowMs !== undefined && !isRowOnline(u, nowMs)) {
      alerts.push({ level: 'warning', message: `${prefix}sin señal (último dato ${u.timestamp ? new Date(u.timestamp).toLocaleString('es-CO', { hour12: false }) : 'desconocido'})` });
      continue;
    }
    alerts.push(...unitAlerts(u, hospital, prefix));
  }
  return alerts;
}

export default function AlertBanner({ latest, hospital, nowMs }: { latest: PlantRow; hospital: Hospital; nowMs?: number }) {
  const alerts = buildAlerts(latest, hospital, nowMs);
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
