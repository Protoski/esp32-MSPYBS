'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createHospital } from '@/lib/api';
import type { Hospital } from '@/types/plant';

const DEF_TH = { o2_purity_warn: 93, o2_purity_critical: 90, air_pressure_min: 4.5, air_pressure_max: 5.5, vacuum_min_mmhg: -400 };
const DEF_EQ = { compressor_enabled: true, vacuum_enabled: true, psa_enabled: true };
const inp = 'w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 transition-all placeholder:text-slate-600';

export default function AddHospitalPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [form, setForm] = useState<Omit<Hospital, 'id' | 'created_at'>>({
    nombre: '', ciudad: '', direccion: '', activo: true,
    thresholds: { ...DEF_TH }, equipment: { ...DEF_EQ },
  });

  const set   = (k: string, v: unknown) => setForm(f => ({ ...f, [k]: v }));
  const setTh = (k: string, v: number)  => setForm(f => ({ ...f, thresholds: { ...f.thresholds, [k]: v } }));
  const setEq = (k: string, v: boolean) => setForm(f => ({ ...f, equipment:  { ...f.equipment,  [k]: v } }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.nombre.trim() || !form.ciudad.trim()) { setError('Nombre y ciudad son obligatorios.'); return; }
    setSaving(true); setError(null);
    try {
      const res = await createHospital(form);
      if (res.ok) { setSuccess(true); setTimeout(() => router.push('/admin'), 1500); }
      else setError(res.error ?? 'Error al crear el hospital.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Error de red'); }
    finally { setSaving(false); }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-black text-slate-100">Agregar Hospital</h1>
        <p className="text-sm text-slate-500 mt-0.5">Configura la información y umbrales del nuevo hospital.</p>
      </div>
      {success && <div className="rounded-xl bg-green-500/10 border border-green-500/30 px-4 py-3 text-sm text-green-400 font-semibold">✅ Hospital creado correctamente. Redirigiendo…</div>}
      {error  && <div className="rounded-xl bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-400">{error}</div>}
      <form onSubmit={handleSubmit} className="space-y-6">
        <Card title="📋 Información del Hospital">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5"><label className="text-xs font-semibold text-slate-400">Nombre *</label><input value={form.nombre} onChange={e => set('nombre', e.target.value)} placeholder="Ej: Hospital Universitario" className={inp} required /></div>
            <div className="space-y-1.5"><label className="text-xs font-semibold text-slate-400">Ciudad *</label><input value={form.ciudad} onChange={e => set('ciudad', e.target.value)} placeholder="Ej: Bogotá" className={inp} required /></div>
            <div className="space-y-1.5 sm:col-span-2"><label className="text-xs font-semibold text-slate-400">Dirección</label><input value={form.direccion} onChange={e => set('direccion', e.target.value)} placeholder="Ej: Calle 50 # 30-20" className={inp} /></div>
            <div className="space-y-1.5"><label className="text-xs font-semibold text-slate-400">Estado inicial</label><select value={form.activo ? 'true' : 'false'} onChange={e => set('activo', e.target.value === 'true')} className={inp}><option value="true">Activo</option><option value="false">Inactivo</option></select></div>
          </div>
        </Card>
        <Card title="⚠️ Umbrales de Alarma">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { label: 'Pureza O₂ Alerta (%)',    key: 'o2_purity_warn',     min: 85,  max: 99,   step: 0.5 },
              { label: 'Pureza O₂ Crítico (%)',   key: 'o2_purity_critical', min: 80,  max: 95,   step: 0.5 },
              { label: 'Presión Aire Mín. (bar)', key: 'air_pressure_min',   min: 3,   max: 6,    step: 0.1 },
              { label: 'Presión Aire Máx. (bar)', key: 'air_pressure_max',   min: 4,   max: 8,    step: 0.1 },
              { label: 'Vacío Mínimo (mmHg)',     key: 'vacuum_min_mmhg',   min: -700, max: -100, step: 10  },
            ].map(({ label, key, min, max, step }) => (
              <div key={key} className="space-y-1.5"><label className="text-xs font-semibold text-slate-400">{label}</label>
                <input type="number" min={min} max={max} step={step} value={(form.thresholds as Record<string,number>)[key]}
                  onChange={e => setTh(key, Number(e.target.value))} className={inp} /></div>
            ))}
          </div>
        </Card>
        <Card title="🔧 Equipos Habilitados">
          <div className="space-y-3">
            {[
              { key: 'psa_enabled',        label: 'Planta PSA — Oxígeno Medicinal' },
              { key: 'compressor_enabled', label: 'Compresor de Aire Médico' },
              { key: 'vacuum_enabled',     label: 'Bomba de Vacío Médico' },
            ].map(({ key, label }) => {
              const on = form.equipment[key as keyof typeof form.equipment];
              return (
                <label key={key} className="flex items-center justify-between rounded-xl bg-slate-900/60 border border-slate-700 px-4 py-3 cursor-pointer hover:border-slate-500 transition-colors">
                  <span className="text-sm text-slate-300">{label}</span>
                  <div className="relative" onClick={() => setEq(key, !on)}>
                    <div className={`w-10 h-5 rounded-full transition-colors ${on ? 'bg-sky-600' : 'bg-slate-700'}`}>
                      <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${on ? 'left-5' : 'left-0.5'}`} />
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        </Card>
        <div className="flex gap-3">
          <button type="button" onClick={() => router.back()} className="flex-1 rounded-xl border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500 py-3 text-sm font-semibold transition-all">Cancelar</button>
          <button type="submit" disabled={saving} className="flex-1 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white py-3 text-sm font-bold transition-colors">{saving ? 'Guardando…' : 'Crear Hospital'}</button>
        </div>
      </form>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/60 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-700 bg-slate-800"><p className="text-sm font-bold text-slate-300">{title}</p></div>
      <div className="p-4">{children}</div>
    </div>
  );
}
