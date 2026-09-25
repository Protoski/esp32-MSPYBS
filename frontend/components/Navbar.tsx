'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Navbar() {
  const path = usePathname();
  const links = [
    { href: '/',         label: 'Dashboard',   icon: '⚡' },
    { href: '/mapa',     label: 'Mapa',        icon: '🗺' },
    { href: '/informes', label: 'Informes',    icon: '📊' },
    { href: '/admin',    label: 'Administrar', icon: '⚙️' },
  ];
  return (
    <nav className="sticky top-0 z-50 border-b border-slate-800 bg-slate-900/80 backdrop-blur-md">
      <div className="max-w-screen-2xl mx-auto px-4 md:px-6 flex items-center justify-between h-14">
        <Link href="/" className="flex items-center gap-3 group min-w-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mspbs.jpg" alt="Ministerio de Salud Pública y Bienestar Social — Paraguay"
            className="h-9 w-auto rounded-md bg-white px-1.5 py-0.5 flex-shrink-0" />
          <span className="text-slate-600 hidden md:block text-xs">|</span>
          <span className="text-slate-400 hidden md:block text-xs font-semibold">Monitor de Gases Medicinales</span>
        </Link>
        <div className="flex items-center gap-1">
          {links.map(({ href, label, icon }) => (
            <Link key={href} href={href} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
              path === href || (href !== '/' && path.startsWith(href))
                ? 'bg-sky-500/20 text-sky-400' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'}`}>
              <span>{icon}</span>
              <span className="hidden sm:block">{label}</span>
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
