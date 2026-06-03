'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { fetchHospitals, updateHospital, toggleHospital } from '@/lib/api';
import type { Hospital } from '@/types/plant';

const inp = 'w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 transition-all';

export default function HospitalConfigPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [hospital, setHospital] = useState<Hospital | null>(null);
  const [form, setForm] = useState<Hospital | null>(null);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { hospitals } = await fetchHospitals();
      const found = hospitals.find((h: Hospital) => h.id === id);
      if (found) { setHospital(found); setForm(found); }
    } catch (err) { setError(err instanceof Error ? err.message : 'Error'); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (!form || !hospital) return (
    <div className="flex items-center justify-center h-48 text-slate-500">Cargando configuración…</div>
  );

  const setTh = (k: string, v: number)  => setForm(f => f ? ({ ...f, thresholds: { ...f.thresholds, [k]: v } }) : f);
  const setEq = (k: string, v: boolean) => setForm(f => f ? ({ ...f, equipment:  { ...f.equipment,  [k]: v } }) : f);

  const handleSave = async () => {
    if (!form) return;
    setSaving(true); setError(null);
    try {
      const res = await updateHospital(id, form);
      if (res.ok) { setSuccess(true); setTimeout(() => setSuccess(false), 3000); await load(); }
      else setError(res.error ?? 'Error al guardar.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Error de red'); }
    finally { setSaving(false); }
  };

  const handleToggle = async () => { await toggleHospital(id, !hospital.activo); await load(); };

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm text-slate-500 mb-1">
            <Link href="/admin" className="hover:text-slate-300 transition-colors">← Admin</Link>
            <span>/</span>
            <span className="text-slate-300">{hospital.nombre}</span>
          </div>
          <h1 className="text-xl font-black text-slate-100">Configuración</h1>
        </div>
        <div className="flex gap-2">
          <Link href={`/hospital/${id}`}
            className="px-3 py-2 rounded-xl border border-slate-700 text-slate-400 hover:text-sky-400 hover:border-sky-500/50 text-xs font-semibold transition-all">
            Ver dashboard
          </Link>
          <button onClick={handleToggle}
            className={`px-3 py-2 rounded-xl text-xs font-bold transition-all border ${
              hospital.activo
                ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20 border-red-500/30'
                : 'bg-green-500/10 text-green-400 hover:bg-green-500/20 border-green-500/30'
            }`}>
            {hospital.activo ? '⏸ Desactivar' : '▶ Activar'}
          </button>
        </div>
      </div>

      {success && (
        <div className="rounded-xl bg-green-500/10 border border-green-500/30 px-4 py-3 text-sm text-green-400 font-semibold">
          ✅ Configuración guardada correctamente.
        </div>
      )}
      {error && (
        <div className="rounded-xl bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      {/* Información básica */}
      <div className="rounded-xl border border-slate-700 bg-slate-800/60 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-700 bg-slate-800 flex items-center justify-between">
          <p className="text-sm font-bold text-slate-300">📋 Información General</p>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
            hospital.activo ? 'bg-green-500/20 text-green-400' : 'bg-slate-700 text-slate-500'
          }`}>
            {hospital.activo ? 'Activo' : 'Inactivo'}
          </span>
        </div>
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[
            { label: 'Nombre',    key: 'nombre' },
            { label: 'Ciudad',    key: 'ciudad' },
            { label: 'Dirección', key: 'direccion' },
          ].map(({ label, key }) => (
            <div key={key} className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-400">{label}</label>
              <input
                value={(form as unknown as Record<string, string>)[key] ?? ''}
                onChange={e => setForm(f => f ? ({ ...f, [key]: e.target.value }) : f)}
                className={inp}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Umbrales */}
      <div className="rounded-xl border border-slate-700 bg-slate-800/60 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-700 bg-slate-800">
          <p className="text-sm font-bold text-slate-300">⚠️ Umbrales de Alarma</p>
        </div>
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[
            { label: 'Pureza O₂ Alerta (%)',    key: 'o2_purity_warn',     min: 85,   max: 99,   step: 0.5 },
            { label: 'Pureza O₂ Crítico (%)',   key: 'o2_purity_critical', min: 80,   max: 95,   step: 0.5 },
            { label: 'Presión Aire Mín. (bar)', key: 'air_pressure_min',   min: 3,    max: 6,    step: 0.1 },
            { label: 'Presión Aire Máx. (bar)', key: 'air_pressure_max',   min: 4,    max: 8,    step: 0.1 },
            { label: 'Vacío Mínimo (mmHg)',     key: 'vacuum_min_mmhg',   min: -700, max: -100, step: 10  },
          ].map(({ label, key, min, max, step }) => (
            <div key={key} className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-400">{label}</label>
              <input
                type="number" min={min} max={max} step={step}
                value={(form.thresholds as Record<string, number>)[key]}
                onChange={e => setTh(key, Number(e.target.value))}
                className={inp}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Equipos */}
      <div className="rounded-xl border border-slate-700 bg-slate-800/60 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-700 bg-slate-800">
          <p className="text-sm font-bold text-slate-300">🔧 Control de Equipos</p>
          <p className="text-[10px] text-slate-500 mt-0.5">El ESP32 leerá estos estados en cada ciclo y actuará en consecuencia.</p>
        </div>
        <div className="p-4 space-y-3">
          {[
            { key: 'psa_enabled',        label: 'Planta PSA — Oxígeno Medicinal', desc: 'Habilita la producción de O₂ vía PSA' },
            { key: 'compressor_enabled', label: 'Compresor de Aire Médico',        desc: 'Controla el arranque/paro del compresor' },
            { key: 'vacuum_enabled',     label: 'Bomba de Vacío Médico',           desc: 'Controla el arranque/paro de la bomba de vacío' },
          ].map(({ key, label, desc }) => {
            const enabled = form.equipment[key as keyof typeof form.equipment];
            return (
              <div key={key}
                className={`flex items-center justify-between rounded-xl border px-4 py-3 transition-all ${
                  enabled ? 'border-green-500/30 bg-green-500/5' : 'border-slate-700 bg-slate-900/40'
                }`}>
                <div>
                  <p className="text-sm font-semibold text-slate-200">{label}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">{desc}</p>
                </div>
                <button
                  onClick={() => setEq(key, !enabled)}
                  className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${
                    enabled ? 'bg-green-500' : 'bg-slate-700'
                  }`}>
                  <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-all ${
                    enabled ? 'left-6' : 'left-0.5'
                  }`} />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Acciones */}
      <div className="flex gap-3">
        <button onClick={() => router.back()}
          className="flex-1 rounded-xl border border-slate-700 text-slate-400 hover:text-slate-200 py-3 text-sm font-semibold transition-all">
          Cancelar
        </button>
        <button onClick={handleSave} disabled={saving}
          className="flex-1 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white py-3 text-sm font-bold transition-colors">
          {saving ? 'Guardando…' : '💾 Guardar Cambios'}
        </button>
      </div>
    </div>
  );
}
