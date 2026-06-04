'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { fetchHospitals, fetchPlantData } from '@/lib/api';
import type { Hospital, PlantRow } from '@/types/plant';

const fmt = (iso: string | null) =>
  !iso ? '—' : new Date(iso).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'medium', hour12: false });

const fmtDate = (iso: string | null) =>
  !iso ? '' : new Date(iso).toLocaleDateString('sv-SE'); // YYYY-MM-DD

const COLS = [
  { key: 'timestamp',            label: 'Fecha / Hora',        fmt: (v: unknown) => fmt(v as string) },
  { key: 'o2_purity_pct',        label: 'Pureza O₂ (%)',       fmt: (v: unknown) => Number(v).toFixed(2) },
  { key: 'o2_flow_m3h',          label: 'Caudal O₂ (m³/h)',    fmt: (v: unknown) => Number(v).toFixed(2) },
  { key: 'tower_a_pressure_bar', label: 'Presión Torre A (bar)',fmt: (v: unknown) => Number(v).toFixed(2) },
  { key: 'tower_b_pressure_bar', label: 'Presión Torre B (bar)',fmt: (v: unknown) => Number(v).toFixed(2) },
  { key: 'o2_tank_pressure_bar', label: 'Tanque O₂ (bar)',      fmt: (v: unknown) => Number(v).toFixed(2) },
  { key: 'psa_dewpoint_c',       label: 'Dew Point PSA (°C)',   fmt: (v: unknown) => Number(v).toFixed(1) },
  { key: 'air_line_pressure_bar',label: 'Presión Aire (bar)',   fmt: (v: unknown) => Number(v).toFixed(2) },
  { key: 'air_dewpoint_c',       label: 'Dew Point Aire (°C)',  fmt: (v: unknown) => Number(v).toFixed(1) },
  { key: 'vacuum_level_mmhg',    label: 'Vacío (mmHg)',         fmt: (v: unknown) => Number(v).toFixed(0) },
  { key: 'compressor_status',    label: 'Compresor',            fmt: (v: unknown) => String(v) },
  { key: 'vacuum_pump_status',   label: 'Bomba Vacío',          fmt: (v: unknown) => String(v) },
];

const PAGE_SIZE = 25;

export default function HistorialPage() {
  const [hospitals, setHospitals]       = useState<Hospital[]>([]);
  const [rows, setRows]                 = useState<PlantRow[]>([]);
  const [selectedHospital, setSelected] = useState('');
  const [dateFrom, setDateFrom]         = useState('');
  const [dateTo, setDateTo]             = useState('');
  const [search, setSearch]             = useState('');
  const [page, setPage]                 = useState(1);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [sortCol, setSortCol]           = useState<string>('timestamp');
  const [sortAsc, setSortAsc]           = useState(false);

  const loadHospitals = useCallback(async () => {
    try {
      const { hospitals: hs } = await fetchHospitals();
      setHospitals(hs);
      if (hs.length > 0) setSelected(hs[0].id);
    } catch { /* ignore */ }
  }, []);

  React.useEffect(() => { loadHospitals(); }, [loadHospitals]);

  const handleSearch = useCallback(async () => {
    if (!selectedHospital) return;
    setLoading(true); setError(null); setPage(1);
    try {
      const { rows: fetched } = await fetchPlantData(selectedHospital);
      setRows(fetched);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar datos');
      setRows([]);
    } finally { setLoading(false); }
  }, [selectedHospital]);

  const filtered = useMemo(() => {
    let data = [...rows];

    if (dateFrom) {
      data = data.filter(r => r.timestamp && fmtDate(r.timestamp) >= dateFrom);
    }
    if (dateTo) {
      data = data.filter(r => r.timestamp && fmtDate(r.timestamp) <= dateTo);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      data = data.filter(r =>
        Object.values(r).some(v => String(v ?? '').toLowerCase().includes(q))
      );
    }

    data.sort((a, b) => {
      const av = (a as Record<string, unknown>)[sortCol] ?? '';
      const bv = (b as Record<string, unknown>)[sortCol] ?? '';
      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
      return sortAsc ? cmp : -cmp;
    });

    return data;
  }, [rows, dateFrom, dateTo, search, sortCol, sortAsc]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleSort = (key: string) => {
    if (sortCol === key) setSortAsc(a => !a);
    else { setSortCol(key); setSortAsc(false); }
  };

  const exportCSV = () => {
    const header = COLS.map(c => c.label).join(',');
    const csvRows = filtered.map(r =>
      COLS.map(c => {
        const val = (r as Record<string, unknown>)[c.key];
        const s = c.fmt(val);
        return `"${s.replace(/"/g, '""')}"`;
      }).join(',')
    );
    const blob = new Blob(['﻿' + [header, ...csvRows].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const hosp = hospitals.find(h => h.id === selectedHospital);
    a.href     = url;
    a.download = `historial_${hosp?.nombre ?? 'hospital'}_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const inp = 'rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 transition-all';

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-black text-slate-100">Historial de Registros</h1>
          <p className="text-xs text-slate-500 mt-0.5">Consulta, filtra y exporta el historial de mediciones</p>
        </div>
        <button onClick={exportCSV} disabled={filtered.length === 0}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white text-sm font-bold transition-colors">
          ⬇ Exportar CSV
          {filtered.length > 0 && <span className="bg-green-700 px-1.5 py-0.5 rounded-md text-[10px]">{filtered.length}</span>}
        </button>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-4 space-y-4">
        <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Filtros de búsqueda</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="space-y-1">
            <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Hospital</label>
            <select value={selectedHospital} onChange={e => setSelected(e.target.value)} className={inp + ' w-full'}>
              {hospitals.map(h => <option key={h.id} value={h.id}>{h.nombre}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Desde</label>
            <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }}
              className={inp + ' w-full [color-scheme:dark]'} />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Hasta</label>
            <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }}
              className={inp + ' w-full [color-scheme:dark]'} />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Buscar</label>
            <input type="text" placeholder="Ej: ON, FAULT, 95…" value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              className={inp + ' w-full'} />
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={handleSearch} disabled={loading || !selectedHospital}
            className="px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white text-sm font-bold transition-colors">
            {loading ? '⏳ Cargando…' : '🔍 Buscar'}
          </button>
          <button onClick={() => { setDateFrom(''); setDateTo(''); setSearch(''); setPage(1); }}
            className="px-4 py-2 rounded-xl border border-slate-700 text-slate-400 hover:text-slate-200 text-sm font-semibold transition-all">
            ✕ Limpiar filtros
          </button>
          {rows.length > 0 && (
            <span className="text-xs text-slate-500 ml-auto">
              {filtered.length} registro{filtered.length !== 1 ? 's' : ''} encontrado{filtered.length !== 1 ? 's' : ''}
              {filtered.length !== rows.length && ` de ${rows.length} totales`}
            </span>
          )}
        </div>
      </div>

      {error && <div className="rounded-xl bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-400">{error}</div>}

      {rows.length === 0 && !loading ? (
        <div className="rounded-xl border border-dashed border-slate-700 p-12 text-center">
          <p className="text-3xl mb-3">📋</p>
          <p className="text-slate-400 font-semibold">Selecciona un hospital y presiona Buscar</p>
          <p className="text-xs text-slate-600 mt-1">Se cargarán los últimos 500 registros</p>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[900px]">
              <thead className="bg-slate-800/80 sticky top-0 z-10">
                <tr>
                  {COLS.map(c => (
                    <th key={c.key} onClick={() => handleSort(c.key)}
                      className="text-left px-3 py-2.5 text-[10px] font-bold uppercase tracking-widest text-slate-500 cursor-pointer hover:text-sky-400 whitespace-nowrap select-none transition-colors">
                      <span className="flex items-center gap-1">
                        {c.label}
                        {sortCol === c.key && <span className="text-sky-400">{sortAsc ? '↑' : '↓'}</span>}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {paginated.map((r, i) => (
                  <tr key={i} className="bg-slate-900/50 hover:bg-slate-800/40 transition-colors">
                    {COLS.map(c => {
                      const val = (r as Record<string, unknown>)[c.key];
                      const display = c.fmt(val);
                      const isStatus = c.key.includes('status');
                      const color = isStatus
                        ? display === 'ON'    ? 'text-green-400'
                        : display === 'FAULT' ? 'text-red-400 font-bold'
                        : 'text-slate-500'
                        : 'text-slate-300';
                      return (
                        <td key={c.key} className={`px-3 py-2 whitespace-nowrap ${color}`}>{display}</td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 bg-slate-800/60 border-t border-slate-700">
              <span className="text-xs text-slate-500">
                Página {page} de {totalPages} · Mostrando {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} de {filtered.length}
              </span>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage(1)} disabled={page === 1}
                  className="px-2 py-1 rounded-lg text-xs text-slate-400 hover:text-slate-200 disabled:opacity-30 hover:bg-slate-700 transition-all">«</button>
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                  className="px-2 py-1 rounded-lg text-xs text-slate-400 hover:text-slate-200 disabled:opacity-30 hover:bg-slate-700 transition-all">‹</button>
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  const p = Math.max(1, Math.min(totalPages - 4, page - 2)) + i;
                  return (
                    <button key={p} onClick={() => setPage(p)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${p === page ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'}`}>
                      {p}
                    </button>
                  );
                })}
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                  className="px-2 py-1 rounded-lg text-xs text-slate-400 hover:text-slate-200 disabled:opacity-30 hover:bg-slate-700 transition-all">›</button>
                <button onClick={() => setPage(totalPages)} disabled={page === totalPages}
                  className="px-2 py-1 rounded-lg text-xs text-slate-400 hover:text-slate-200 disabled:opacity-30 hover:bg-slate-700 transition-all">»</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
