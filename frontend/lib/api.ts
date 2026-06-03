/**
 * Capa de acceso a datos.
 * Lee la URL del backend desde la variable de entorno para que
 * jamás quede escrita en el código fuente del repositorio público.
 */

import type { ApiResponse } from '@/types/plant';

const API_URL = process.env.NEXT_PUBLIC_API_URL;

export async function fetchPlantData(): Promise<ApiResponse> {
  if (!API_URL) {
    throw new Error(
      'NEXT_PUBLIC_API_URL no está definida. ' +
      'Añádela en .env.local (desarrollo) o en el panel de Vercel (producción).'
    );
  }

  const res = await fetch(API_URL, {
    // "no-store" para que cada poll obtenga datos frescos sin caché
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  return res.json() as Promise<ApiResponse>;
}
