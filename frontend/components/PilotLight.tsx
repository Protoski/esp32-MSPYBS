'use client';

/**
 * PilotLight — Luz piloto virtual para estado de equipos.
 * ON → verde pulsante  |  OFF → gris  |  FAULT → rojo parpadeante
 */

import React from 'react';
import type { DeviceStatus } from '@/types/plant';

interface PilotLightProps {
  label:  string;
  status: DeviceStatus;
  /** Texto descriptivo opcional (ej: "1234 h acumuladas") */
  detail?: string;
}

const config: Record<DeviceStatus, { dot: string; label: string; ring: string }> = {
  ON:    {
    dot:   'bg-green-400 shadow-[0_0_12px_3px_rgba(74,222,128,0.6)]',
    ring:  'ring-green-500/30',
    label: 'OPERATIVO',
  },
  OFF:   {
    dot:   'bg-slate-600',
    ring:  'ring-slate-600/20',
    label: 'APAGADO',
  },
  FAULT: {
    dot:   'bg-red-500 shadow-[0_0_14px_4px_rgba(239,68,68,0.7)] animate-pulse',
    ring:  'ring-red-500/40',
    label: 'FALLA',
  },
};

export default function PilotLight({ label, status, detail }: PilotLightProps) {
  const { dot, ring, label: statusLabel } = config[status] ?? config.OFF;

  return (
    <div className={`flex items-center gap-4 rounded-xl bg-slate-800 border border-slate-700 p-4 ring-2 ${ring}`}>
      {/* Luz piloto */}
      <div className="relative flex-shrink-0">
        <div className={`w-5 h-5 rounded-full ${dot}`} />
      </div>

      {/* Texto */}
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-200 truncate">{label}</p>
        <p className={`text-xs font-bold tracking-widest uppercase ${
          status === 'ON'    ? 'text-green-400' :
          status === 'FAULT' ? 'text-red-400 animate-pulse' :
                               'text-slate-500'
        }`}>
          {statusLabel}
        </p>
        {detail && (
          <p className="text-xs text-slate-500 mt-0.5">{detail}</p>
        )}
      </div>
    </div>
  );
}
