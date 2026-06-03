'use client';

import React from 'react';
import type { StatusLevel } from '@/types/plant';

interface GaugeProps {
  value:   number;
  min:     number;
  max:     number;
  label:   string;
  unit:    string;
  status:  StatusLevel;
  marks?:  { value: number; color: string }[];
}

const strokeColor: Record<StatusLevel, string> = {
  ok: '#22c55e', warn: '#f59e0b', danger: '#ef4444', info: '#38bdf8', neutral: '#475569',
};

export default function GaugeChart({ value, min, max, label, unit, status, marks }: GaugeProps) {
  const R = 54, cx = 64, cy = 70;
  const circumference = R * Math.PI;
  const clamp  = Math.min(Math.max(value, min), max);
  const pct    = (clamp - min) / (max - min);
  const offset = circumference * (1 - pct);
  const color  = strokeColor[status];

  const arcPoint = (deg: number) => {
    const rad = (deg * Math.PI) / 180;
    return { x: cx + R * Math.cos(Math.PI - rad), y: cy - R * Math.sin(rad) };
  };
  const valToAngle = (v: number) => 180 - ((v - min) / (max - min)) * 180;
  const a0 = arcPoint(180), a1 = arcPoint(0);

  return (
    <div className="flex flex-col items-center rounded-xl bg-slate-800/80 border border-slate-700 p-4 gap-1">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{label}</p>
      <svg viewBox="0 0 128 80" className="w-40 overflow-visible">
        <path d={`M ${a0.x} ${a0.y} A ${R} ${R} 0 0 1 ${a1.x} ${a1.y}`} fill="none" stroke="#1e293b" strokeWidth="10" strokeLinecap="round" />
        <path d={`M ${a0.x} ${a0.y} A ${R} ${R} 0 0 1 ${a1.x} ${a1.y}`} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={`${circumference}`} strokeDashoffset={`${offset}`}
          style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(.4,0,.2,1), stroke 0.4s' }} />
        {marks?.map((m, i) => {
          const a = valToAngle(m.value);
          const p1 = arcPoint(a);
          const r2 = R - 14;
          const p2 = { x: cx + r2 * Math.cos(Math.PI - (a * Math.PI) / 180), y: cy - r2 * Math.sin((a * Math.PI) / 180) };
          return <line key={i} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={m.color} strokeWidth="2" strokeLinecap="round" />;
        })}
        {(() => {
          const tip = arcPoint(valToAngle(clamp));
          return <line x1={cx} y1={cy} x2={tip.x} y2={tip.y} stroke={color} strokeWidth="2.5" strokeLinecap="round"
            style={{ transition: 'all 0.8s cubic-bezier(.4,0,.2,1)' }} />;
        })()}
        <circle cx={cx} cy={cy} r="4" fill={color} />
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize="14" fill={color} fontWeight="900">
          {typeof value === 'number' ? value.toFixed(1) : value}
        </text>
        <text x={cx} y={cy + 24} textAnchor="middle" fontSize="7" fill="#64748b">{unit}</text>
        <text x={a0.x - 4} y={cy + 14} textAnchor="end"   fontSize="7" fill="#475569">{min}</text>
        <text x={a1.x + 4} y={cy + 14} textAnchor="start" fontSize="7" fill="#475569">{max}</text>
      </svg>
    </div>
  );
}
