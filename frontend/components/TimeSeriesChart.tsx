'use client';

/**
 * TimeSeriesChart — Gráfico de líneas temporales interactivo.
 * Reutilizable: acepta múltiples series con colores configurables.
 * Usa Chart.js v4 vía react-chartjs-2.
 */

import React, { useMemo } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  TimeScale,
} from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  TimeScale,
);

export interface ChartSeries {
  label:       string;
  data:        number[];
  borderColor: string;
  bgColor:     string;
}

interface TimeSeriesChartProps {
  title:     string;
  labels:    string[];   // etiquetas del eje X (timestamps formateados)
  series:    ChartSeries[];
  yUnit?:    string;
  yMin?:     number;
  yMax?:     number;
  /** Línea de referencia horizontal (ej: umbral de pureza) */
  threshold?: { value: number; label: string; color: string };
}

export default function TimeSeriesChart({
  title,
  labels,
  series,
  yUnit = '',
  yMin,
  yMax,
  threshold,
}: TimeSeriesChartProps) {

  const datasets = useMemo(() =>
    series.map((s) => ({
      label:           s.label,
      data:            s.data,
      borderColor:     s.borderColor,
      backgroundColor: s.bgColor,
      borderWidth:     2,
      pointRadius:     2,
      pointHoverRadius:5,
      tension:         0.4,
      fill:            false,
    })),
    [series],
  );

  const options = useMemo(() => ({
    responsive:          true,
    maintainAspectRatio: false,
    interaction: { mode: 'index' as const, intersect: false },
    plugins: {
      legend: {
        position: 'top' as const,
        labels:   { color: '#94a3b8', font: { size: 11 }, boxWidth: 12 },
      },
      title: {
        display:  true,
        text:     title,
        color:    '#e2e8f0',
        font:     { size: 13, weight: 'bold' as const },
        padding:  { bottom: 10 },
      },
      tooltip: {
        backgroundColor: '#1e293b',
        borderColor:     '#334155',
        borderWidth:     1,
        titleColor:      '#94a3b8',
        bodyColor:       '#e2e8f0',
        callbacks: {
          label: (ctx: { dataset: { label?: string }; parsed: { y: number } }) =>
            ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(2)} ${yUnit}`,
        },
      },
      // Línea de umbral como anotación manual en datasets
    },
    scales: {
      x: {
        ticks: {
          color:    '#64748b',
          maxTicksLimit: 8,
          font:     { size: 10 },
        },
        grid: { color: '#1e293b' },
      },
      y: {
        min:  yMin,
        max:  yMax,
        ticks: {
          color:    '#64748b',
          font:     { size: 10 },
          callback: (v: number | string) => `${v} ${yUnit}`,
        },
        grid: { color: '#1e293b' },
      },
    },
  }), [title, yUnit, yMin, yMax]);

  // Añade el umbral como dataset de línea punteada
  const thresholdDataset = threshold
    ? [{
        label:           threshold.label,
        data:            labels.map(() => threshold.value),
        borderColor:     threshold.color,
        backgroundColor: 'transparent',
        borderWidth:     1.5,
        borderDash:      [6, 4],
        pointRadius:     0,
        tension:         0,
        fill:            false,
      }]
    : [];

  return (
    <div className="rounded-xl bg-slate-800 border border-slate-700 p-4">
      <div className="h-64">
        <Line
          data={{ labels, datasets: [...datasets, ...thresholdDataset] }}
          options={options}
        />
      </div>
    </div>
  );
}
