'use client';

import React, { useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import KPICard, { o2PurityStatus, rangeStatus } from '@/components/KPICard';
import PilotLight from '@/components/PilotLight';
import TimeSeriesChart from '@/components/TimeSeriesChart';
import StatusBar from '@/components/StatusBar';
import GaugeChart from '@/components/GaugeChart';
import AlertBanner from '@/components/AlertBanner';
import { fetchPlantData, fetchHospitals } from '@/lib/api';
import { usePolling } from '@/hooks/usePolling';
import type { PlantRow, Hospital } from '@/types/plant';

const POLL_MS = 5_000;
const fmt = (iso: string | null) => !iso ? '--' : new Date(iso).toLocaleTimeString('es-CO', { hour12: false });
const n = (v: number | undefined, d = 2) => (v === undefined || v === null || isNaN(Number(v))) ? '--' : Number(v).toFixed(d);

export default function HospitalDashboard() {
  const { id } = useParams<{ id: string }>();
  const [rows, setRows] = useState<PlantRow[]>([]);
  const [hospital, setHospital] = useState<Hospital | null>(null);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const poll = useCallback(async () => {
    setIsPolling(true);
    try {
      const [dataRes, hospRes] = await Promise.all([fetchPlantData(id), fetchHospitals()]);
      if (dataRes.ok && dataRes.rows.length > 0) {
        setRows(dataRes.rows);
        setLastUpdate(fmt(dataRes.rows[dataRes.rows.length - 1].timestamp));
        setIsConnected(true);
      }
      const found = hospRes.hospitals.find((h: Hospital) => h.id === id);
      if (found) setHospital(found);
      setError(null);
    } catch (err) {
      setIsConnected(false);
      setError(err instanceof Error ? err.message : 'Error');
    } finally { setIsPolling(false); }
  }, [id]);

  usePolling(poll, POLL_MS);

  const latest = rows[rows.length - 1];
  const last50 = rows.slice(-50);
  const labels = last50.map(r => fmt(r.timestamp));
  const th = hospital?.thresholds;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/" className="hover:text-slate-300 transition-colors">← Todos los hospitales</Link>
        {hospital && <><span>/</span><span className="text-slate-300 font-semibold">{hospital.nombre}</span></>}
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-slate-100">{hospital?.nombre ?? 'Cargando...'}</h1>
          <p className="text-sm text-slate-500">{hospital?.ciudad} · {hospital?.direccion}</p>
        </div>
        {hospital && (
          <Link href={`/admin/hospital/${id}`} className="text-xs px-3 py-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-all">⚙️ Configurar</Link>
        )}
      </div>
      <StatusBar lastUpdate={lastUpdate} isConnected={isConnected} isPolling={isPolling} errorMessage={error} />
      {latest && hospital && <AlertBanner latest={latest} hospital={hospital} />}

      <Section icon="⚗️" title="Planta PSA — Oxígeno Medicinal">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <GaugeChart value={latest?.o2_purity_pct ?? 0} min={80} max={100} label="Pureza O₂" unit="% O₂"
            status={latest ? o2PurityStatus(latest.o2_purity_pct, th?.o2_purity_warn, th?.o2_purity_critical) : 'neutral'}
            marks={[{ value: th?.o2_purity_warn ?? 93, color: '#f59e0b' }, { value: th?.o2_purity_critical ?? 90, color: '#ef4444' }]} />
          <GaugeChart value={latest?.tower_a_pressure_bar ?? 0} min={0} max={7} label="Torre A PSA" unit="bar" status={latest ? rangeStatus(latest.tower_a_pressure_bar, 0.2, 6) : 'neutral'} />
          <GaugeChart value={latest?.tower_b_pressure_bar ?? 0} min={0} max={7} label="Torre B PSA" unit="bar" status={latest ? rangeStatus(latest.tower_b_pressure_bar, 0.2, 6) : 'neutral'} />
          <GaugeChart value={latest?.o2_tank_pressure_bar ?? 0} min={0} max={8} label="Tanque O₂" unit="bar" status={latest ? rangeStatus(latest.o2_tank_pressure_bar, 2.5, 6) : 'neutral'} />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
          <KPICard label="Pureza O₂" value={n(latest?.o2_purity_pct)} unit="% O₂"
            status={latest ? o2PurityStatus(latest.o2_purity_pct, th?.o2_purity_warn, th?.o2_purity_critical) : 'neutral'}
            sublabel={latest && latest.o2_purity_pct < (th?.o2_purity_critical ?? 90) ? '🚨 ALARMA GRAVE' : latest && latest.o2_purity_pct < (th?.o2_purity_warn ?? 93) ? '⚠ Bajo umbral' : 'Normal (≥93%)'}
            trend={rows.length > 2 ? (rows[rows.length-1].o2_purity_pct > rows[rows.length-2].o2_purity_pct ? 'up' : 'down') : 'stable'} />
          <KPICard label="Caudal O₂" value={n(latest?.o2_flow_m3h)} unit="m³/h" status={latest ? rangeStatus(latest.o2_flow_m3h, 2, 5, 1, 6) : 'neutral'} />
          <KPICard label="Presión Torre A" value={n(latest?.tower_a_pressure_bar)} unit="bar" status={latest ? rangeStatus(latest.tower_a_pressure_bar, 0.2, 6) : 'neutral'} sublabel="Ciclo PSA" />
          <KPICard label="Presión Torre B" value={n(latest?.tower_b_pressure_bar)} unit="bar" status={latest ? rangeStatus(latest.tower_b_pressure_bar, 0.2, 6) : 'neutral'} sublabel="Ciclo PSA" />
          <KPICard label="Dew Point PSA" value={n(latest?.psa_dewpoint_c)} unit="°C" status={latest ? rangeStatus(latest.psa_dewpoint_c, -60, -30, -70, -20) : 'neutral'} sublabel="Entrada PSA" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <TimeSeriesChart title="Presión Torres PSA (bar)" labels={labels} yUnit="bar" yMin={0} yMax={7}
            series={[
              { label: 'Torre A', data: last50.map(r => r.tower_a_pressure_bar), borderColor: '#38bdf8', bgColor: 'rgba(56,189,248,0.06)' },
              { label: 'Torre B', data: last50.map(r => r.tower_b_pressure_bar), borderColor: '#a78bfa', bgColor: 'rgba(167,139,250,0.06)' },
            ]} />
          <TimeSeriesChart title="Pureza de Oxígeno (%)" labels={labels} yUnit="%" yMin={85} yMax={100}
            series={[{ label: 'Pureza O₂', data: last50.map(r => r.o2_purity_pct), borderColor: '#22c55e', bgColor: 'rgba(34,197,94,0.06)' }]}
            threshold={{ value: th?.o2_purity_warn ?? 93, label: `Umbral ${th?.o2_purity_warn ?? 93}%`, color: '#f59e0b' }} />
        </div>
      </Section>

      <Section icon="💨" title="Sistema de Aire Médico y Compresores">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          <PilotLight label="Compresor de Aire" status={latest?.compressor_status ?? 'OFF'} detail={latest ? `${latest.compressor_hours} h acumuladas` : undefined} />
          <KPICard label="Horas Compresor" value={n(latest?.compressor_hours, 0)} unit="h" status={latest ? (latest.compressor_hours > 8000 ? 'warn' : 'ok') : 'neutral'} sublabel={latest && latest.compressor_hours > 8000 ? '⚠ Revisión próxima' : 'Al día'} />
          <KPICard label="Presión Aire" value={n(latest?.air_line_pressure_bar)} unit="bar" status={latest ? rangeStatus(latest.air_line_pressure_bar, th?.air_pressure_min ?? 4.5, th?.air_pressure_max ?? 5.5, 4.0, 6.0) : 'neutral'} sublabel="HTM 02-01" />
          <KPICard label="Dew Point Aire" value={n(latest?.air_dewpoint_c)} unit="°C" status={latest ? (latest.air_dewpoint_c < -46 ? 'ok' : latest.air_dewpoint_c < -40 ? 'warn' : 'danger') : 'neutral'} sublabel="ISO 7396-1: < −46°C" />
        </div>
        <TimeSeriesChart title="Presión Línea de Aire Médico (bar)" labels={labels} yUnit="bar" yMin={3.5} yMax={6.5}
          series={[{ label: 'Aire Médico', data: last50.map(r => r.air_line_pressure_bar), borderColor: '#fb923c', bgColor: 'rgba(251,146,60,0.06)' }]}
          threshold={{ value: th?.air_pressure_min ?? 4.5, label: `Mín. ${th?.air_pressure_min ?? 4.5} bar`, color: '#ef4444' }} />
      </Section>

      <Section icon="🔩" title="Sistema de Vacío Médico">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
          <PilotLight label="Bomba de Vacío" status={latest?.vacuum_pump_status ?? 'OFF'} />
          <KPICard label="Nivel de Vacío" value={n(latest?.vacuum_level_mmhg, 0)} unit="mmHg"
            status={latest ? (latest.vacuum_level_mmhg < (th?.vacuum_min_mmhg ?? -400) ? 'ok' : latest.vacuum_level_mmhg < -300 ? 'warn' : 'danger') : 'neutral'}
            sublabel={`ISO 7396-1: mín. ${th?.vacuum_min_mmhg ?? -400} mmHg`} />
          <div className="rounded-xl bg-slate-800/80 border border-slate-700 p-4 flex flex-col justify-center gap-1.5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Referencia</p>
            {[['OK','text-green-400',`< ${th?.vacuum_min_mmhg ?? -400} mmHg`],['Alerta','text-amber-400','−300 a −400 mmHg'],['Falla','text-red-400','> −300 mmHg']].map(([l,c,r]) => (
              <div key={String(l)} className="flex items-center justify-between text-xs"><span className={`font-bold ${c}`}>{l}</span><span className="text-slate-500">{r}</span></div>
            ))}
          </div>
        </div>
        <TimeSeriesChart title="Nivel de Vacío Médico (mmHg)" labels={labels} yUnit="mmHg" yMax={0} yMin={-700}
          series={[{ label: 'Vacío', data: last50.map(r => r.vacuum_level_mmhg), borderColor: '#e879f9', bgColor: 'rgba(232,121,249,0.06)' }]}
          threshold={{ value: th?.vacuum_min_mmhg ?? -400, label: 'Mín.', color: '#ef4444' }} />
      </Section>

      <footer className="text-center text-xs text-slate-700 pt-2 border-t border-slate-800">
        {hospital?.nombre} · Polling cada {POLL_MS / 1000} s via Google Apps Script
      </footer>
    </div>
  );
}

function Section({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
        <span>{icon}</span>
        <h2 className="text-xs font-black uppercase tracking-widest text-slate-400">{title}</h2>
      </div>
      {children}
    </section>
  );
}
