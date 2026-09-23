'use client';

import React, { useState, useCallback } from 'react';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, ArcElement, Title, Tooltip, Legend, Filler,
} from 'chart.js';
import { Line, Bar, Doughnut } from 'react-chartjs-2';
import { fetchHospitals, fetchPlantData } from '@/lib/api';
import type { Hospital, PlantRow } from '@/types/plant';
import { getZone, ZONE_COLORS } from '@/lib/paraguay';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Title, Tooltip, Legend, Filler);

const CHART_DEFAULTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { labels: { color: '#94a3b8', font: { size: 11 } } } },
  scales: {
    x: { ticks: { color: '#64748b', maxTicksLimit: 10 }, grid: { color: '#1e293b' } },
    y: { ticks: { color: '#64748b' }, grid: { color: '#1e293b' } },
  },
};

interface HospitalData {
  hospital: Hospital;
  rows: PlantRow[];
  zona: string;
}

interface ZoneSummary {
  zona: string;
  hospitals: HospitalData[];
  avgPurity: number;
  avgFlow: number;
  avgVacuum: number;
  onlineCount: number;
}

export default function InformesPage() {
  const [data, setData] = useState<HospitalData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState<'zona' | 'tendencia' | 'comparativa' | 'consumo'>('zona');
  const [selectedZone, setSelectedZone] = useState<string>('all');
  const [selectedHospital, setSelectedHospital] = useState<string>('all');
  const [hospList, setHospList] = useState<Hospital[]>([]);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const { hospitals: hs } = await fetchHospitals();
      setHospList(hs);
      const results: HospitalData[] = await Promise.all(
        hs.map(async (h: Hospital) => {
          const res = await fetchPlantData(h.id);
          return { hospital: h, rows: res.rows ?? [], zona: getZone(h.ciudad) };
        })
      );
      setData(results);
      setIsLoaded(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const byZone = data.reduce<Record<string, ZoneSummary>>((acc, hd) => {
    const z = hd.zona;
    if (!acc[z]) acc[z] = { zona: z, hospitals: [], avgPurity: 0, avgFlow: 0, avgVacuum: 0, onlineCount: 0 };
    acc[z].hospitals.push(hd);
    return acc;
  }, {});

  Object.values(byZone).forEach(zs => {
    const rows = zs.hospitals.flatMap(h => h.rows);
    if (!rows.length) return;
    zs.avgPurity  = rows.reduce((a, r) => a + r.o2_purity_pct, 0) / rows.length;
    zs.avgFlow    = rows.reduce((a, r) => a + r.o2_flow_m3h, 0) / rows.length;
    zs.avgVacuum  = rows.reduce((a, r) => a + Math.abs(r.vacuum_level_mmhg), 0) / rows.length;
    zs.onlineCount = zs.hospitals.filter(h => {
      const last = h.rows[h.rows.length - 1];
      if (!last?.timestamp) return false;
      return Date.now() - new Date(last.timestamp).getTime() < 120_000;
    }).length;
  });

  const zones = Object.keys(byZone).sort();
  const filteredData = selectedHospital !== 'all'
    ? data.filter(d => d.hospital.id === selectedHospital)
    : selectedZone !== 'all' ? data.filter(d => d.zona === selectedZone) : data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-100 tracking-tight">Informes y Análisis</h1>
          <p className="text-sm text-slate-500 mt-0.5">Consumo, tendencias y comparativas por zona — Paraguay</p>
        </div>
        {!isLoaded ? (
          <button onClick={load} disabled={isLoading} className="px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-bold text-sm rounded-lg transition-colors">
            {isLoading ? 'Cargando datos…' : 'Cargar datos'}
          </button>
        ) : (
          <button onClick={load} disabled={isLoading} className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg transition-colors">
            {isLoading ? 'Actualizando…' : '↺ Actualizar'}
          </button>
        )}
      </div>

      {!isLoaded && !isLoading && (
        <div className="rounded-xl border border-dashed border-slate-700 p-12 text-center">
          <p className="text-4xl mb-3">📊</p>
          <p className="text-slate-400 font-semibold mb-2">Informes con gráficos interactivos</p>
          <p className="text-slate-600 text-sm mb-4">Análisis por zona, tendencias de pureza O₂, consumo y comparativas entre plantas</p>
          <button onClick={load} className="px-5 py-2.5 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded-lg transition-colors">Cargar datos ahora</button>
        </div>
      )}

      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1,2,3,4].map(i => <div key={i} className="h-64 rounded-xl bg-slate-800 border border-slate-700 animate-pulse" />)}
        </div>
      )}

      {isLoaded && !isLoading && (
        <>
          <div className="flex flex-wrap gap-3">
            <select value={selectedZone} onChange={e => { setSelectedZone(e.target.value); setSelectedHospital('all'); }}
              className="bg-slate-800 border border-slate-700 text-slate-300 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-sky-500">
              <option value="all">Todas las zonas</option>
              {zones.map(z => <option key={z} value={z}>{z}</option>)}
            </select>
            <select value={selectedHospital} onChange={e => setSelectedHospital(e.target.value)}
              className="bg-slate-800 border border-slate-700 text-slate-300 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-sky-500">
              <option value="all">Todos los hospitales</option>
              {hospList.filter(h => selectedZone === 'all' || getZone(h.ciudad) === selectedZone)
                .map(h => <option key={h.id} value={h.id}>{h.nombre}</option>)}
            </select>
          </div>

          <div className="flex gap-1 p-1 bg-slate-800/60 rounded-xl w-fit">
            {([
              ['zona',       '🗺 Por Zona'],
              ['tendencia',  '📈 Tendencia'],
              ['comparativa','⚖️ Comparativa'],
              ['consumo',    '⚡ Consumo O₂'],
            ] as const).map(([t, l]) => (
              <button key={t} onClick={() => setActiveTab(t)}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${activeTab === t ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}>
                {l}
              </button>
            ))}
          </div>

          {activeTab === 'zona'        && <ZoneTab byZone={byZone} />}
          {activeTab === 'tendencia'   && <TrendTab data={filteredData} />}
          {activeTab === 'comparativa' && <ComparativeTab data={filteredData} />}
          {activeTab === 'consumo'     && <ConsumptionTab data={filteredData} />}
        </>
      )}
    </div>
  );
}

function ZoneTab({ byZone }: { byZone: Record<string, ZoneSummary> }) {
  const zones = Object.values(byZone).sort((a, b) => b.hospitals.length - a.hospitals.length);
  const purityData = {
    labels: zones.map(z => z.zona),
    datasets: [{ label: 'Pureza O₂ promedio (%)', data: zones.map(z => +z.avgPurity.toFixed(2)),
      backgroundColor: zones.map(z => `${ZONE_COLORS[z.zona] ?? '#38bdf8'}80`),
      borderColor: zones.map(z => ZONE_COLORS[z.zona] ?? '#38bdf8'), borderWidth: 2, borderRadius: 6 }],
  };
  const flowData = {
    labels: zones.map(z => z.zona),
    datasets: [{ label: 'Caudal O₂ promedio (m³/h)', data: zones.map(z => +z.avgFlow.toFixed(2)),
      backgroundColor: zones.map(z => `${ZONE_COLORS[z.zona] ?? '#38bdf8'}60`),
      borderColor: zones.map(z => ZONE_COLORS[z.zona] ?? '#38bdf8'), borderWidth: 2, borderRadius: 6 }],
  };
  const onlineData = {
    labels: zones.map(z => `${z.zona} (${z.onlineCount}/${z.hospitals.length})`),
    datasets: [{ data: zones.map(z => z.hospitals.length),
      backgroundColor: zones.map(z => `${ZONE_COLORS[z.zona] ?? '#38bdf8'}80`),
      borderColor: zones.map(z => ZONE_COLORS[z.zona] ?? '#38bdf8'), borderWidth: 2 }],
  };
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {zones.map(zs => {
          const color = ZONE_COLORS[zs.zona] ?? '#475569';
          return (
            <div key={zs.zona} className="rounded-xl bg-slate-800/80 border border-slate-700 p-4" style={{ borderLeftColor: color, borderLeftWidth: 3 }}>
              <div className="flex items-center justify-between mb-2">
                <p className="font-bold text-slate-200">{zs.zona}</p>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: `${color}20`, color }}>{zs.onlineCount}/{zs.hospitals.length} online</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[['Pureza', `${zs.avgPurity.toFixed(1)}%`], ['Caudal', `${zs.avgFlow.toFixed(1)} m³/h`], ['Vacío', `${zs.avgVacuum.toFixed(0)} mmHg`]].map(([l, v]) => (
                  <div key={l}><p className="text-[9px] text-slate-500 uppercase">{l}</p><p className="text-xs font-bold mt-0.5" style={{ color }}>{v}</p></div>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {zs.hospitals.map(h => <span key={h.hospital.id} className="text-[9px] text-slate-500 bg-slate-900/50 px-1.5 py-0.5 rounded">{h.hospital.nombre}</span>)}
              </div>
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-xl bg-slate-800/80 border border-slate-700 p-4">
          <p className="text-xs font-bold text-slate-400 mb-3">Pureza O₂ por Zona</p>
          <div className="h-56"><Bar data={purityData} options={{ ...CHART_DEFAULTS, scales: { ...CHART_DEFAULTS.scales, y: { ...CHART_DEFAULTS.scales.y, min: 88, max: 100 } } }} /></div>
        </div>
        <div className="rounded-xl bg-slate-800/80 border border-slate-700 p-4">
          <p className="text-xs font-bold text-slate-400 mb-3">Hospitales por Zona</p>
          <div className="h-56"><Doughnut data={onlineData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 10 }, boxWidth: 12, padding: 8 } } } }} /></div>
        </div>
      </div>
      <div className="rounded-xl bg-slate-800/80 border border-slate-700 p-4">
        <p className="text-xs font-bold text-slate-400 mb-3">Caudal O₂ promedio por Zona (m³/h)</p>
        <div className="h-48"><Bar data={flowData} options={CHART_DEFAULTS} /></div>
      </div>
    </div>
  );
}

function TrendTab({ data }: { data: HospitalData[] }) {
  const [metric, setMetric] = useState<'o2_purity_pct' | 'o2_flow_m3h' | 'o2_tank_pressure_bar' | 'vacuum_level_mmhg'>('o2_purity_pct');
  const metricLabels: Record<string, string> = {
    o2_purity_pct: 'Pureza O₂ (%)', o2_flow_m3h: 'Caudal O₂ (m³/h)',
    o2_tank_pressure_bar: 'Presión Tanque O₂ (bar)', vacuum_level_mmhg: 'Nivel Vacío (mmHg)',
  };
  const colors = ['#38bdf8','#34d399','#fb923c','#a78bfa','#f472b6','#facc15','#4ade80','#60a5fa'];
  const allTs = [...new Set(data.flatMap(d => d.rows.map(r => r.timestamp)).filter(Boolean) as string[])].sort().slice(-50);
  const chartData = {
    labels: allTs.map(ts => new Date(ts).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })),
    datasets: data.filter(d => d.rows.length > 0).map((d, i) => {
      const tsMap: Record<string, number> = {};
      d.rows.forEach(r => { if (r.timestamp) tsMap[r.timestamp] = r[metric] as number; });
      return { label: d.hospital.nombre, data: allTs.map(ts => tsMap[ts] ?? null),
        borderColor: colors[i % colors.length], backgroundColor: `${colors[i % colors.length]}20`,
        borderWidth: 2, pointRadius: 2, tension: 0.3, spanGaps: true, fill: false };
    }),
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {Object.entries(metricLabels).map(([k, l]) => (
          <button key={k} onClick={() => setMetric(k as typeof metric)}
            className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${metric === k ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700'}`}>{l}</button>
        ))}
      </div>
      <div className="rounded-xl bg-slate-800/80 border border-slate-700 p-4">
        <p className="text-xs font-bold text-slate-400 mb-3">Tendencia: {metricLabels[metric]}</p>
        <div className="h-72"><Line data={chartData} options={CHART_DEFAULTS} /></div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {data.filter(d => d.rows.length > 0).map((d, i) => {
          const vals = d.rows.slice(-20).map(r => r[metric] as number);
          const last = vals[vals.length - 1] ?? 0;
          const trend = vals.length > 1 ? vals[vals.length-1] - vals[0] : 0;
          const color = colors[i % colors.length];
          const sparkData = { labels: vals.map((_, j) => String(j)), datasets: [{ data: vals, borderColor: color, backgroundColor: `${color}20`, borderWidth: 1.5, pointRadius: 0, tension: 0.3, fill: true }] };
          return (
            <div key={d.hospital.id} className="rounded-xl bg-slate-800/80 border border-slate-700 p-3">
              <div className="flex justify-between items-start mb-2">
                <div><p className="text-xs font-bold text-slate-200">{d.hospital.nombre}</p><p className="text-[9px] text-slate-500">{d.hospital.ciudad}</p></div>
                <div className="text-right">
                  <p className="text-sm font-black" style={{ color }}>{last.toFixed(1)}</p>
                  <p className={`text-[10px] font-bold ${trend > 0 ? 'text-green-400' : trend < 0 ? 'text-red-400' : 'text-slate-500'}`}>
                    {trend > 0 ? '↑' : trend < 0 ? '↓' : '→'} {Math.abs(trend).toFixed(1)}
                  </p>
                </div>
              </div>
              <div className="h-12"><Line data={sparkData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { enabled: false } }, scales: { x: { display: false }, y: { display: false } }, animation: false }} /></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ComparativeTab({ data }: { data: HospitalData[] }) {
  const colors = ['#38bdf8','#34d399','#fb923c','#a78bfa','#f472b6','#facc15','#4ade80','#60a5fa'];
  const metrics = [
    { key: 'o2_purity_pct',        label: 'Pureza O₂ (%)',          min: 88 },
    { key: 'o2_flow_m3h',          label: 'Caudal O₂ (m³/h)',        min: 0 },
    { key: 'o2_tank_pressure_bar', label: 'Presión Tanque O₂ (bar)', min: 0 },
    { key: 'air_line_pressure_bar',label: 'Presión Aire (bar)',       min: 0 },
    { key: 'vacuum_level_mmhg',    label: 'Vacío (mmHg)',             min: undefined },
    { key: 'compressor_hours',     label: 'Horas Compresor',          min: 0 },
  ];
  const avgFor = (hd: HospitalData, key: string) => {
    const vals = hd.rows.map(r => r[key as keyof PlantRow] as number).filter(v => typeof v === 'number');
    return vals.length ? vals.reduce((a, v) => a + v, 0) / vals.length : 0;
  };
  return (
    <div className="space-y-4">
      {metrics.map(m => {
        const chartData = { labels: data.map(d => d.hospital.nombre), datasets: [{ label: m.label,
          data: data.map(d => +avgFor(d, m.key).toFixed(2)),
          backgroundColor: data.map((_, i) => `${colors[i % colors.length]}80`),
          borderColor: data.map((_, i) => colors[i % colors.length]), borderWidth: 2, borderRadius: 6 }] };
        return (
          <div key={m.key} className="rounded-xl bg-slate-800/80 border border-slate-700 p-4">
            <p className="text-xs font-bold text-slate-400 mb-3">{m.label} — promedio por hospital</p>
            <div className="h-44"><Bar data={chartData} options={{ ...CHART_DEFAULTS, indexAxis: 'y' as const, scales: { x: { ...CHART_DEFAULTS.scales.x, ...(m.min !== undefined ? { min: m.min } : {}) }, y: { ticks: { color: '#64748b', font: { size: 10 } }, grid: { color: '#1e293b' } } } }} /></div>
          </div>
        );
      })}
    </div>
  );
}

function ConsumptionTab({ data }: { data: HospitalData[] }) {
  const colors = ['#38bdf8','#34d399','#fb923c','#a78bfa','#f472b6','#facc15','#4ade80','#60a5fa'];
  const allRows = data.flatMap(d => d.rows.map(r => ({ ...r, _zona: d.zona })));
  const hourBuckets: Record<string, number[]> = {};
  allRows.forEach(r => {
    if (!r.timestamp) return;
    const h = new Date(r.timestamp).getHours();
    const key = `${String(h).padStart(2,'0')}:00`;
    if (!hourBuckets[key]) hourBuckets[key] = [];
    hourBuckets[key].push(r.o2_flow_m3h);
  });
  const hourLabels = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2,'0')}:00`);
  const hourAvgs = hourLabels.map(l => { const v = hourBuckets[l] ?? []; return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; });
  const hourlyChart = { labels: hourLabels, datasets: [{ label: 'Caudal O₂ promedio (m³/h)', data: hourAvgs.map(v => +v.toFixed(2)), borderColor: '#38bdf8', backgroundColor: '#38bdf820', borderWidth: 2, fill: true, tension: 0.4, pointRadius: 2 }] };
  const zoneTotals = data.reduce<Record<string, number>>((acc, d) => { const z = d.zona; const total = d.rows.reduce((a, r) => a + r.o2_flow_m3h, 0); acc[z] = (acc[z] ?? 0) + total; return acc; }, {});
  const zoneNames = Object.keys(zoneTotals).sort();
  const zoneFlowChart = { labels: zoneNames, datasets: [{ label: 'Flujo total acumulado (m³)', data: zoneNames.map(z => +zoneTotals[z].toFixed(1)), backgroundColor: zoneNames.map(z => `${ZONE_COLORS[z] ?? '#38bdf8'}80`), borderColor: zoneNames.map(z => ZONE_COLORS[z] ?? '#38bdf8'), borderWidth: 2, borderRadius: 6 }] };
  const timelineTs = [...new Set(data.flatMap(d => d.rows.map(r => r.timestamp)).filter(Boolean) as string[])].sort().slice(-30);
  const stackedChart = { labels: timelineTs.map(ts => new Date(ts).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })), datasets: data.filter(d => d.rows.length > 0).map((d, i) => { const tsMap: Record<string, number> = {}; d.rows.forEach(r => { if (r.timestamp) tsMap[r.timestamp] = r.o2_flow_m3h; }); return { label: d.hospital.nombre, data: timelineTs.map(ts => tsMap[ts] ?? 0), backgroundColor: `${colors[i % colors.length]}90`, borderColor: colors[i % colors.length], borderWidth: 1 }; }) };
  const purityBins = Array.from({ length: 12 }, (_, i) => 88 + i);
  const purityCounts = purityBins.map(bin => allRows.filter(r => r.o2_purity_pct >= bin && r.o2_purity_pct < bin + 1).length);
  const purityDist = { labels: purityBins.map(b => `${b}–${b+1}%`), datasets: [{ label: 'Frecuencia lecturas', data: purityCounts, backgroundColor: purityBins.map(b => b >= 95 ? '#34d39980' : b >= 93 ? '#38bdf880' : b >= 90 ? '#fb923c80' : '#ef444480'), borderColor: purityBins.map(b => b >= 95 ? '#34d399' : b >= 93 ? '#38bdf8' : b >= 90 ? '#fb923c' : '#ef4444'), borderWidth: 1.5, borderRadius: 4 }] };
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl bg-slate-800/80 border border-slate-700 p-4">
          <p className="text-xs font-bold text-slate-400 mb-1">Consumo O₂ por hora del día</p>
          <p className="text-[10px] text-slate-600 mb-3">Promedio histórico — todas las plantas</p>
          <div className="h-56"><Line data={hourlyChart} options={CHART_DEFAULTS} /></div>
        </div>
        <div className="rounded-xl bg-slate-800/80 border border-slate-700 p-4">
          <p className="text-xs font-bold text-slate-400 mb-1">Consumo O₂ acumulado por Zona</p>
          <p className="text-[10px] text-slate-600 mb-3">Suma de caudales registrados</p>
          <div className="h-56"><Bar data={zoneFlowChart} options={CHART_DEFAULTS} /></div>
        </div>
      </div>
      <div className="rounded-xl bg-slate-800/80 border border-slate-700 p-4">
        <p className="text-xs font-bold text-slate-400 mb-1">Caudal O₂ por planta — últimas lecturas</p>
        <p className="text-[10px] text-slate-600 mb-3">Vista apilada — comparación en tiempo real</p>
        <div className="h-56"><Bar data={stackedChart} options={{ ...CHART_DEFAULTS, scales: { x: { ...CHART_DEFAULTS.scales.x, stacked: true }, y: { ...CHART_DEFAULTS.scales.y, stacked: true } } }} /></div>
      </div>
      <div className="rounded-xl bg-slate-800/80 border border-slate-700 p-4">
        <p className="text-xs font-bold text-slate-400 mb-1">Distribución de Pureza O₂</p>
        <p className="text-[10px] text-slate-600 mb-3">Histograma de todas las lecturas · verde ≥95% · azul ≥93% · naranja ≥90% · rojo &lt;90%</p>
        <div className="h-48"><Bar data={purityDist} options={{ ...CHART_DEFAULTS, plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false } } }} /></div>
      </div>
    </div>
  );
}
