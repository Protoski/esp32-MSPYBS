'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Navbar() {
  const path = usePathname();
  const links = [
    { href: '/',      label: 'Dashboard',   icon: '⚡' },
    { href: '/admin', label: 'Administrar', icon: '⚙️' },
  ];
  return (
    <nav className="sticky top-0 z-50 border-b border-slate-800 bg-slate-900/80 backdrop-blur-md">
      <div className="max-w-screen-2xl mx-auto px-4 md:px-6 flex items-center justify-between h-14">
        <Link href="/" className="flex items-center gap-2 group">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center text-white text-sm font-black">M</div>
          <span className="font-black text-slate-100 tracking-tight hidden sm:block">MSPYBS</span>
          <span className="text-slate-600 hidden sm:block text-xs">|</span>
          <span className="text-slate-500 hidden sm:block text-xs">Gases Medicinales</span>
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
