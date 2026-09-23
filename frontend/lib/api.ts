import type {
  ApiDataResponse,
  ApiHospitalsResponse,
  ApiCommandResponse,
  Hospital,
} from '@/types/plant';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

if (!BASE && typeof window !== 'undefined') {
  console.warn('[API] NEXT_PUBLIC_API_URL no definida.');
}

async function apiFetch<T>(params: Record<string, string>): Promise<T> {
  const url = new URL(BASE);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  url.searchParams.set('_t', Date.now().toString()); // evita caché de Google Apps Script
  const res = await fetch(url.toString(), { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.hospitals === undefined) data.hospitals = [];
  if (data.rows      === undefined) data.rows = [];
  return data;
}

async function apiPost<T>(body: Record<string, unknown>): Promise<T> {
  // El token de administrador se adjunta aca, no se compara nunca en el
  // cliente: la unica verificacion real ocurre en el backend.
  const token = typeof window !== 'undefined' ? sessionStorage.getItem('admin_token') : null;
  // Content-Type text/plain evita el preflight CORS de Google Apps Script
  const res = await fetch(BASE, {
    method:   'POST',
    headers:  { 'Content-Type': 'text/plain;charset=utf-8' },
    body:     JSON.stringify({ token, ...body }),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.ok === false) throw new Error(data.error || 'Error desconocido');
  return data;
}

export async function verifyAdminToken(token: string): Promise<boolean> {
  const res = await fetch(BASE, {
    method:   'POST',
    headers:  { 'Content-Type': 'text/plain;charset=utf-8' },
    body:     JSON.stringify({ action: 'verify_token', token }),
    redirect: 'follow',
  });
  if (!res.ok) return false;
  const data = await res.json();
  return data.ok === true;
}

export async function fetchPlantData(hospitalId: string): Promise<ApiDataResponse> {
  return apiFetch<ApiDataResponse>({ action: 'data', hospital_id: hospitalId });
}

export async function fetchAllLatest(): Promise<ApiDataResponse> {
  return apiFetch<ApiDataResponse>({ action: 'latest_all' });
}

export async function fetchHospitals(): Promise<ApiHospitalsResponse> {
  return apiFetch<ApiHospitalsResponse>({ action: 'hospitals' });
}

export async function createHospital(
  data: Omit<Hospital, 'id' | 'created_at'> & { id?: string }
): Promise<ApiCommandResponse> {
  return apiPost<ApiCommandResponse>({ action: 'add_hospital', ...data });
}

export async function toggleHospital(
  id: string,
  activo: boolean
): Promise<ApiCommandResponse> {
  return apiPost<ApiCommandResponse>({ action: 'toggle_hospital', id, activo });
}

export async function deleteHospital(id: string): Promise<ApiCommandResponse> {
  return apiPost<ApiCommandResponse>({ action: 'delete_hospital', id });
}

export async function updateHospital(
  id: string,
  data: Partial<Omit<Hospital, 'id' | 'created_at'>>
): Promise<ApiCommandResponse> {
  return apiPost<ApiCommandResponse>({ action: 'update_hospital', id, ...data });
}
