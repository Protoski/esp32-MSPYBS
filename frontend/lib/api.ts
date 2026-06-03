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
  const res = await fetch(url.toString(), { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.hospitals === undefined) data.hospitals = [];
  if (data.rows      === undefined) data.rows = [];
  return data;
}

async function apiPost<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch(BASE, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
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
  data: Omit<Hospital, 'id' | 'created_at'>
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
