export default function Footer() {
  return (
    <footer className="border-t border-slate-800 bg-slate-900/80 mt-8">
      <div className="max-w-screen-2xl mx-auto px-4 md:px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mspbs.jpg" alt="Ministerio de Salud Pública y Bienestar Social — Paraguay"
            className="h-10 w-auto rounded-md bg-white px-1.5 py-0.5" />
        </div>
        <div className="text-center sm:text-right">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Desarrollado por</p>
          <p className="text-sm font-semibold text-slate-300">DGGIES · MSPBS — Asesoría Técnica</p>
          <p className="text-[11px] text-slate-500">Monitor de Gases Medicinales · {new Date().getFullYear()}</p>
        </div>
      </div>
    </footer>
  );
}
