'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ADMIN_PIN = process.env.NEXT_PUBLIC_ADMIN_PIN ?? '1234';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const path = usePathname();

  useEffect(() => {
    if (sessionStorage.getItem('admin_unlocked') === 'true') setUnlocked(true);
  }, []);

  const handlePin = (e: React.FormEvent) => {
    e.preventDefault();
    if (pin === ADMIN_PIN) { sessionStorage.setItem('admin_unlocked', 'true'); setUnlocked(true); setError(false); }
    else { setError(true); setPin(''); }
  };

  if (!unlocked) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-800 p-8 space-y-6">
          <div className="text-center">
            <div className="w-12 h-12 rounded-xl bg-slate-700 flex items-center justify-center text-2xl mx-auto mb-3">🔐</div>
            <h2 className="text-lg font-black text-slate-100">Panel de Administración</h2>
            <p className="text-xs text-slate-500 mt-1">Ingresa el PIN de acceso</p>
          </div>
          <form onSubmit={handlePin} className="space-y-4">
            <input type="password" value={pin} onChange={e => setPin(e.target.value)} placeholder="PIN" maxLength={8}
              className={`w-full rounded-xl border bg-slate-900 px-4 py-3 text-center text-xl font-black tracking-[0.5em] text-slate-100 outline-none focus:ring-2 transition-all ${
                error ? 'border-red-500 focus:ring-red-500/30' : 'border-slate-600 focus:ring-sky-500/30 focus:border-sky-500'}`} />
            {error && <p className="text-xs text-red-400 text-center">PIN incorrecto</p>}
            <button type="submit" className="w-full rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-bold py-3 transition-colors">Acceder</button>
          </form>
          <p className="text-[10px] text-slate-600 text-center">PIN por defecto: 1234 — configura NEXT_PUBLIC_ADMIN_PIN en Vercel para cambiarlo.</p>
        </div>
      </div>
    );
  }

  const navLinks = [
    { href: '/admin',           label: 'Resumen',    icon: '📊' },
    { href: '/admin/hospitals', label: 'Hospitales', icon: '🏥' },
  ];

  return (
    <div className="flex gap-6">
      <aside className="w-48 flex-shrink-0 hidden md:block">
        <div className="rounded-xl border border-slate-700 bg-slate-800 overflow-hidden sticky top-20">
          <div className="px-4 py-3 border-b border-slate-700">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Administración</p>
          </div>
          <nav className="p-2 space-y-0.5">
            {navLinks.map(({ href, label, icon }) => (
              <Link key={href} href={href} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                path === href ? 'bg-sky-500/20 text-sky-400' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'}`}>
                <span>{icon}</span>{label}
              </Link>
            ))}
          </nav>
          <div className="p-2 border-t border-slate-700">
            <button onClick={() => { sessionStorage.removeItem('admin_unlocked'); setUnlocked(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all">
              🔒 Cerrar sesión
            </button>
          </div>
        </div>
      </aside>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
