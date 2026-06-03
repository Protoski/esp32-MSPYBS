import type { Metadata } from 'next';
import './globals.css';
import Navbar from '@/components/Navbar';
import { HospitalProvider } from '@/context/HospitalContext';

export const metadata: Metadata = {
  title:       'MSPYBS — Monitor Planta Gases Medicinales',
  description: 'Sistema de monitoreo en tiempo real: O₂, Aire Médico y Vacío — Multi-hospital',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="dark">
      <body className="min-h-screen bg-slate-900">
        <HospitalProvider>
          <Navbar />
          <main className="max-w-screen-2xl mx-auto px-4 md:px-6 py-6">
            {children}
          </main>
        </HospitalProvider>
      </body>
    </html>
  );
}
