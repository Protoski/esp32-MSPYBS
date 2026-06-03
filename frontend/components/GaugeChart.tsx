'use client';

import React from 'react';
import type { StatusLevel } from '@/types/plant';

interface GaugeProps {
  value:  number;
  min:    number;
  max:    number;
  label:  string;
  unit:   string;
  status: StatusLevel;
  marks?: { value: number; color: string }[];
}

const strokeColor: Record<StatusLevel, string> = {
  ok:      '#22c55e',
  warn:    '#f59e0b',
  danger:  '#ef4444',
  info:    '#38bdf8',
  neutral: '#475569',
};

export default function GaugeChart({ value, min, max, label, unit, status, marks }: GaugeProps) {
  const R  = 54;
  const cx = 64;
  const cy = 72;

  const clamp = Math.min(Math.max(value, min), max);
  const pct   = (clamp - min) / (max - min);

  // Semicírculo: izquierda = min, derecha = max, arco por arriba
  const lx = cx - R;
  const rx = cx + R;

  const circumference = Math.PI * R;
  const dashOffset    = circumference * (1 - pct);

  // Ángulo: π en min (izquierda), 0 en max (derecha)
  const needleAngle = Math.PI * (1 - pct);
  const needleTip   = {
    x: cx + R * Math.cos(needleAngle),
    y: cy - R * Math.sin(needleAngle),
  };

  const markCoords = (v: number) => {
    const p   = (Math.min(Math.max(v, min), max) - min) / (max - min);
    const ang = Math.PI * (1 - p);
    const r2  = R - 14;
    return {
      x1: cx + R  * Math.cos(ang), y1: cy - R  * Math.sin(ang),
      x2: cx + r2 * Math.cos(ang), y2: cy - r2 * Math.sin(ang),
    };
  };

  const color = strokeColor[status];

  return (
    <div className="flex flex-col items-center rounded-xl bg-slate-800/80 border border-slate-700 p-3 gap-1">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{label}</p>

      <svg viewBox="0 0 128 90" className="w-36 overflow-visible">
        {/* Pista de fondo */}
        <path d={`M ${lx} ${cy} A ${R} ${R} 0 0 0 ${rx} ${cy}`}
          fill="none" stroke="#1e293b" strokeWidth="10" strokeLinecap="round" />

        {/* Arco de valor */}
        <path d={`M ${lx} ${cy} A ${R} ${R} 0 0 0 ${rx} ${cy}`}
          fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(.4,0,.2,1), stroke 0.4s' }}
        />

        {/* Marcas de umbral */}
        {marks?.map((m, i) => {
          const c = markCoords(m.value);
          return <line key={i} x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2}
            stroke={m.color} strokeWidth="2.5" strokeLinecap="round" />;
        })}

        {/* Aguja */}
        <line x1={cx} y1={cy} x2={needleTip.x} y2={needleTip.y}
          stroke={color} strokeWidth="2.5" strokeLinecap="round"
          style={{ transition: 'all 0.8s cubic-bezier(.4,0,.2,1)' }} />
        <circle cx={cx} cy={cy} r="4" fill={color} />

        {/* Valor */}
        <text x={cx} y={cy + 13} textAnchor="middle" fontSize="14" fill={color} fontWeight="900">
          {typeof value === 'number' ? value.toFixed(1) : value}
        </text>
        <text x={cx} y={cy + 23} textAnchor="middle" fontSize="7" fill="#64748b">{unit}</text>

        {/* Min / Max */}
        <text x={lx - 3} y={cy + 13} textAnchor="end"   fontSize="7" fill="#475569">{min}</text>
        <text x={rx + 3} y={cy + 13} textAnchor="start" fontSize="7" fill="#475569">{max}</text>
      </svg>
    </div>
  );
}
