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
  const R  = 50;
  const cx = 70;
  const cy = 65;

  const clamp = Math.min(Math.max(value, min), max);
  const pct   = (clamp - min) / (max - min);

  const pointOnArc = (p: number, radius = R) => {
    const ang = Math.PI * (1 - p);
    return { x: cx + radius * Math.cos(ang), y: cy - radius * Math.sin(ang) };
  };

  const start = pointOnArc(0);
  const end   = pointOnArc(1);
  const arcPath = `M ${start.x} ${start.y} A ${R} ${R} 0 0 1 ${end.x} ${end.y}`;

  const circumference = Math.PI * R;
  const dashOffset    = circumference * (1 - pct);

  const needleTip = pointOnArc(pct);

  const color = strokeColor[status];

  return (
    <div className="flex flex-col items-center rounded-xl bg-slate-800/80 border border-slate-700 p-3 gap-1 overflow-hidden">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 truncate w-full text-center">{label}</p>

      <svg viewBox="0 0 140 95" className="w-full max-w-[9rem]">
        <path d={arcPath} fill="none" stroke="#1e293b" strokeWidth="9" strokeLinecap="round" />

        <path d={arcPath}
          fill="none" stroke={color} strokeWidth="9" strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(.4,0,.2,1), stroke 0.4s' }}
        />

        {marks?.map((m, i) => {
          const p = (Math.min(Math.max(m.value, min), max) - min) / (max - min);
          const outer = pointOnArc(p, R + 4);
          const inner = pointOnArc(p, R - 8);
          return <line key={i} x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y}
            stroke={m.color} strokeWidth="2.5" strokeLinecap="round" />;
        })}

        <line x1={cx} y1={cy} x2={needleTip.x} y2={needleTip.y}
          stroke={color} strokeWidth="2.5" strokeLinecap="round"
          style={{ transition: 'all 0.8s cubic-bezier(.4,0,.2,1)' }} />
        <circle cx={cx} cy={cy} r="4" fill={color} />

        <text x={cx} y={cy + 16} textAnchor="middle" fontSize="14" fill={color} fontWeight="900">
          {typeof value === 'number' ? value.toFixed(1) : value}
        </text>
        <text x={cx} y={cy + 25} textAnchor="middle" fontSize="6.5" fill="#64748b">{unit}</text>

        <text x={start.x} y={cy + 12} textAnchor="middle" fontSize="7" fill="#475569">{min}</text>
        <text x={end.x}   y={cy + 12} textAnchor="middle" fontSize="7" fill="#475569">{max}</text>
      </svg>
    </div>
  );
}
