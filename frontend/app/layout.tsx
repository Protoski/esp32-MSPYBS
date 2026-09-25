import type { Metadata } from 'next';
import './globals.css';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { HospitalProvider } from '@/context/HospitalContext';

export const metadata: Metadata = {
  title:       'MSPYBS — Monitor Planta Gases Medicinales',
  description: 'Sistema de monitoreo en tiempo real: O₂, Aire Médico y Vacío — Multi-hospital',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="dark">
      <body className="min-h-screen bg-slate-900 flex flex-col">
        <HospitalProvider>
          <Navbar />
          <main className="max-w-screen-2xl w-full mx-auto px-4 md:px-6 py-6 flex-1">
            {children}
          </main>
          <Footer />
        </HospitalProvider>
      </body>
    </html>
  );
}
