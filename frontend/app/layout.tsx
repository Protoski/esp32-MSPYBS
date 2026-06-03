import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title:       'MSPYBS — Monitor Planta Gases Medicinales',
  description: 'Dashboard industrial en tiempo real: O₂, Aire Médico y Vacío',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="dark">
      <body className="min-h-screen bg-slate-900">{children}</body>
    </html>
  );
}
