'use client';

/**
 * Dashboard principal — Planta de Gases Medicinales
 *
 * Arquitectura del polling:
 *  - useEffect lanza un intervalo de 5 s al montar el componente.
 *  - fetchPlantData() llama al endpoint de Google Apps Script.
 *  - Los datos se guardan en estado local y los componentes
 *    re-renderizan automáticamente.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import KPICard, { o2PurityStatus, rangeStatus } from '@/components/KPICard';
import PilotLight from '@/components/PilotLight';
import TimeSeriesChart from '@/components/TimeSeriesChart';
import StatusBar from '@/components/StatusBar';
import { fetchPlantData } from '@/lib/api';
import type { PlantRow } from '@/types/plant';

const POLL_INTERVAL_MS = 5_000;

// ── Formatea timestamp ISO a "HH:MM:SS" ─────────────────────
function fmtTime(iso: string | null): string {
  if (!iso) return '--';
  return new Date(iso).toLocaleTimeString('es-CO', { hour12: false });
}

// ── Formatea número con 2 decimales ─────────────────────────
function n(v: number | undefined, d = 2): string {
  if (v === undefined || v === null || isNaN(Number(v))) return '--';
  return Number(v).toFixed(d);
}

export default function DashboardPage() {
  const [rows, setRows]               = useState<PlantRow[]>([]);
  const [lastUpdate, setLastUpdate]   = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isPolling, setIsPolling]     = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const intervalRef                   = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    setIsPolling(true);
    try {
      const data = await fetchPlantData();
      if (data.ok && data.rows.length > 0) {
        setRows(data.rows);
        setLastUpdate(fmtTime(data.rows[data.rows.length - 1].timestamp));
        setIsConnected(true);
        setError(null);
      }
    } catch (err) {
      setIsConnected(false);
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setIsPolling(false);
    }
  }, []);

  useEffect(() => {
    poll(); // carga inmediata al montar
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [poll]);

  // ── Último registro (KPIs actuales) ───────────────────────
  const latest = rows[rows.length - 1];

  // ── Datos para gráficos (eje X = tiempo) ──────────────────
  const labels  = rows.map((r) => fmtTime(r.timestamp));
  const slicedLabels = labels.slice(-50);

  const towerAData  = rows.slice(-50).map((r) => r.tower_a_pressure_bar);
  const towerBData  = rows.slice(-50).map((r) => r.tower_b_pressure_bar);
  const o2FlowData  = rows.slice(-50).map((r) => r.o2_flow_m3h);
  const purityData  = rows.slice(-50).map((r) => r.o2_purity_pct);
  const vacuumData  = rows.slice(-50).map((r) => r.vacuum_level_mmhg);
  const airPressData= rows.slice(-50).map((r) => r.air_line_pressure_bar);

  return (
    <div className="min-h-screen bg-slate-900 p-4 md:p-6 space-y-6">

      {/* ── CABECERA ─────────────────────────────────────── */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-slate-100 tracking-tight">
            🏭 Monitor Planta de Gases Medicinales
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Sistema de Monitoreo y Producción — PSA · Aire Médico · Vacío
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-500">
            {new Date().toLocaleDateString('es-CO', {
              weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
            })}
          </p>
        </div>
      </header>

      {/* ── BARRA DE ESTADO ──────────────────────────────── */}
      <StatusBar
        lastUpdate={lastUpdate}
        isConnected={isConnected}
        isPolling={isPolling}
        errorMessage={error}
      />

      {/* ════════════════════════════════════════════════════
          SECCIÓN 1: PSA Y OXÍGENO MEDICINAL
      ════════════════════════════════════════════════════ */}
      <section className="space-y-4">
        <SectionTitle icon="⚗️" title="Planta PSA — Oxígeno Medicinal" />

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">

          <KPICard
            label="Pureza O₂"
            value={n(latest?.o2_purity_pct)}
            unit="% O₂"
            status={latest ? o2PurityStatus(latest.o2_purity_pct) : 'neutral'}
            sublabel={
              latest && latest.o2_purity_pct < 90 ? '⚠ ALARMA GRAVE' :
              latest && latest.o2_purity_pct < 93 ? '⚠ Por debajo del umbral' :
              'En rango normal (≥93%)'
            }
          />

          <KPICard
            label="Caudal O₂"
            value={n(latest?.o2_flow_m3h)}
            unit="m³/h"
            status={latest ? rangeStatus(latest.o2_flow_m3h, 2, 5, 1, 6) : 'neutral'}
          />

          <KPICard
            label="Presión Torre A"
            value={n(latest?.tower_a_pressure_bar)}
            unit="bar"
            status={latest ? rangeStatus(latest.tower_a_pressure_bar, 0.2, 6, 0.1, 7) : 'neutral'}
            sublabel="Ciclo PSA"
          />

          <KPICard
            label="Presión Torre B"
            value={n(latest?.tower_b_pressure_bar)}
            unit="bar"
            status={latest ? rangeStatus(latest.tower_b_pressure_bar, 0.2, 6, 0.1, 7) : 'neutral'}
            sublabel="Ciclo PSA"
          />

          <KPICard
            label="Tanque O₂"
            value={n(latest?.o2_tank_pressure_bar)}
            unit="bar"
            status={latest ? rangeStatus(latest.o2_tank_pressure_bar, 2.5, 6, 1.5, 7) : 'neutral'}
          />

          <KPICard
            label="Dew Point PSA"
            value={n(latest?.psa_dewpoint_c)}
            unit="°C"
            status={latest ? rangeStatus(latest.psa_dewpoint_c, -60, -30, -70, -20) : 'neutral'}
            sublabel="Aire entrada PSA"
          />
        </div>

        {/* Gráficos PSA */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <TimeSeriesChart
            title="Presión Torres PSA (bar)"
            labels={slicedLabels}
            yUnit="bar"
            yMin={0}
            yMax={7}
            series={[
              {
                label:       'Torre A',
                data:        towerAData,
                borderColor: '#38bdf8',
                bgColor:     'rgba(56,189,248,0.08)',
              },
              {
                label:       'Torre B',
                data:        towerBData,
                borderColor: '#a78bfa',
                bgColor:     'rgba(167,139,250,0.08)',
              },
            ]}
          />

          <TimeSeriesChart
            title="Pureza y Caudal de Oxígeno"
            labels={slicedLabels}
            yUnit="%"
            yMin={85}
            yMax={100}
            series={[
              {
                label:       'Pureza O₂ (%)',
                data:        purityData,
                borderColor: '#22c55e',
                bgColor:     'rgba(34,197,94,0.08)',
              },
            ]}
            threshold={{ value: 93, label: 'Umbral 93%', color: '#f59e0b' }}
          />
        </div>
      </section>

      {/* ════════════════════════════════════════════════════
          SECCIÓN 2: AIRE MÉDICO Y COMPRESORES
      ════════════════════════════════════════════════════ */}
      <section className="space-y-4">
        <SectionTitle icon="💨" title="Sistema de Aire Médico y Compresores" />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Luz piloto compresor */}
          <PilotLight
            label="Compresor de Aire"
            status={latest?.compressor_status ?? 'OFF'}
            detail={latest ? `${latest.compressor_hours} h acumuladas` : undefined}
          />

          <KPICard
            label="Horas Compresor"
            value={n(latest?.compressor_hours, 0)}
            unit="h"
            status={latest
              ? latest.compressor_hours > 8000 ? 'warn' : 'ok'
              : 'neutral'}
            sublabel={latest && latest.compressor_hours > 8000 ? '⚠ Revisión próxima' : 'Mantenimiento al día'}
          />

          <KPICard
            label="Presión Línea Aire"
            value={n(latest?.air_line_pressure_bar)}
            unit="bar"
            status={latest ? rangeStatus(latest.air_line_pressure_bar, 4.5, 5.5, 4.0, 6.0) : 'neutral'}
            sublabel="HTM 02-01: 4.5–5.5 bar"
          />

          <KPICard
            label="Dew Point Aire"
            value={n(latest?.air_dewpoint_c)}
            unit="°C"
            status={latest
              ? latest.air_dewpoint_c < -46 ? 'ok' :
                latest.air_dewpoint_c < -40 ? 'warn' : 'danger'
              : 'neutral'}
            sublabel="ISO 7396-1: < −46 °C"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-1 gap-4">
          <TimeSeriesChart
            title="Presión Línea de Aire Médico (bar)"
            labels={slicedLabels}
            yUnit="bar"
            yMin={3.5}
            yMax={6.5}
            series={[
              {
                label:       'Presión Aire Médico',
                data:        airPressData,
                borderColor: '#fb923c',
                bgColor:     'rgba(251,146,60,0.08)',
              },
            ]}
            threshold={{ value: 4.5, label: 'Mín. 4.5 bar', color: '#ef4444' }}
          />
        </div>
      </section>

      {/* ════════════════════════════════════════════════════
          SECCIÓN 3: VACÍO MÉDICO
      ════════════════════════════════════════════════════ */}
      <section className="space-y-4">
        <SectionTitle icon="🔩" title="Sistema de Vacío Médico" />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <PilotLight
            label="Bomba de Vacío"
            status={latest?.vacuum_pump_status ?? 'OFF'}
          />

          <KPICard
            label="Nivel de Vacío"
            value={n(latest?.vacuum_level_mmhg, 0)}
            unit="mmHg"
            status={latest
              ? latest.vacuum_level_mmhg < -400 ? 'ok' :
                latest.vacuum_level_mmhg < -300 ? 'warn' : 'danger'
              : 'neutral'}
            sublabel="ISO 7396-1: mín. −400 mmHg"
          />

          <div className="rounded-xl bg-slate-800 border border-slate-700 p-4 flex flex-col justify-center">
            <p className="text-xs text-slate-500 uppercase tracking-widest font-semibold mb-2">
              Referencia Vacío Médico
            </p>
            <ul className="text-xs text-slate-400 space-y-1">
              <li><span className="text-green-400 font-bold">OK:</span>  &lt; −400 mmHg</li>
              <li><span className="text-amber-400 font-bold">Alerta:</span> −300 a −400 mmHg</li>
              <li><span className="text-red-400 font-bold">Falla:</span>  &gt; −300 mmHg</li>
            </ul>
          </div>
        </div>

        <TimeSeriesChart
          title="Nivel de Vacío Médico (mmHg)"
          labels={slicedLabels}
          yUnit="mmHg"
          yMax={0}
          yMin={-700}
          series={[
            {
              label:       'Vacío (mmHg)',
              data:        vacuumData,
              borderColor: '#e879f9',
              bgColor:     'rgba(232,121,249,0.08)',
            },
          ]}
          threshold={{ value: -400, label: 'Mín. −400 mmHg', color: '#ef4444' }}
        />
      </section>

      {/* ── PIE DE PÁGINA ────────────────────────────────── */}
      <footer className="text-center text-xs text-slate-700 pt-4 border-t border-slate-800">
        MSPYBS — Sistema de Monitoreo Planta de Gases Medicinales &nbsp;·&nbsp;
        Datos actualizados cada 5 s vía Google Apps Script
      </footer>
    </div>
  );
}

// ── Componente auxiliar de título de sección ──────────────
function SectionTitle({ icon, title }: { icon: string; title: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-slate-700 pb-2">
      <span className="text-lg">{icon}</span>
      <h2 className="text-sm font-bold uppercase tracking-widest text-slate-300">{title}</h2>
    </div>
  );
}
