// Paraguay department zones and city coordinates

export interface CityCoords {
  lat: number;
  lon: number;
  departamento: string;
  zona: string;
}

// Coordinates for Paraguayan cities/towns (approximate center)
export const CITY_COORDS: Record<string, CityCoords> = {
  'asunción':            { lat: -25.2867, lon: -57.6470, departamento: 'Capital',       zona: 'Central' },
  'asuncion':            { lat: -25.2867, lon: -57.6470, departamento: 'Capital',       zona: 'Central' },
  'lambaré':             { lat: -25.3500, lon: -57.6167, departamento: 'Central',       zona: 'Central' },
  'lambare':             { lat: -25.3500, lon: -57.6167, departamento: 'Central',       zona: 'Central' },
  'fernando de la mora': { lat: -25.3333, lon: -57.5667, departamento: 'Central',       zona: 'Central' },
  'luque':               { lat: -25.2667, lon: -57.4833, departamento: 'Central',       zona: 'Central' },
  'capiatá':             { lat: -25.3500, lon: -57.4500, departamento: 'Central',       zona: 'Central' },
  'capiata':             { lat: -25.3500, lon: -57.4500, departamento: 'Central',       zona: 'Central' },
  'san lorenzo':         { lat: -25.3333, lon: -57.5167, departamento: 'Central',       zona: 'Central' },
  'mariano roque alonso':{ lat: -25.1833, lon: -57.5333, departamento: 'Central',       zona: 'Central' },
  'ñemby':               { lat: -25.3833, lon: -57.5833, departamento: 'Central',       zona: 'Central' },
  'nemby':               { lat: -25.3833, lon: -57.5833, departamento: 'Central',       zona: 'Central' },
  'itauguá':             { lat: -25.3833, lon: -57.3500, departamento: 'Central',       zona: 'Central' },
  'itaugua':             { lat: -25.3833, lon: -57.3500, departamento: 'Central',       zona: 'Central' },
  'guarambaré':          { lat: -25.4667, lon: -57.4500, departamento: 'Central',       zona: 'Central' },
  'guarambare':          { lat: -25.4667, lon: -57.4500, departamento: 'Central',       zona: 'Central' },
  'villeta':             { lat: -25.5167, lon: -57.5667, departamento: 'Central',       zona: 'Central' },
  'caacupé':             { lat: -25.3833, lon: -57.1667, departamento: 'Cordillera',    zona: 'Cordillera' },
  'caacupe':             { lat: -25.3833, lon: -57.1667, departamento: 'Cordillera',    zona: 'Cordillera' },
  'coronel oviedo':      { lat: -25.4500, lon: -56.4333, departamento: 'Caaguazú',      zona: 'Oriente Norte' },
  'caaguazú':            { lat: -25.4500, lon: -56.0167, departamento: 'Caaguazú',      zona: 'Oriente Norte' },
  'caaguazu':            { lat: -25.4500, lon: -56.0167, departamento: 'Caaguazú',      zona: 'Oriente Norte' },
  'villarrica':          { lat: -25.7500, lon: -56.4333, departamento: 'Guairá',        zona: 'Oriente Sur' },
  'encarnación':         { lat: -27.3306, lon: -55.8667, departamento: 'Itapúa',        zona: 'Sur' },
  'encarnacion':         { lat: -27.3306, lon: -55.8667, departamento: 'Itapúa',        zona: 'Sur' },
  'ciudad del este':     { lat: -25.5167, lon: -54.6167, departamento: 'Alto Paraná',   zona: 'Este' },
  'hernandarias':        { lat: -25.4000, lon: -54.6167, departamento: 'Alto Paraná',   zona: 'Este' },
  'presidente franco':   { lat: -25.5500, lon: -54.6167, departamento: 'Alto Paraná',   zona: 'Este' },
  'concepción':          { lat: -23.4000, lon: -57.4333, departamento: 'Concepción',    zona: 'Norte' },
  'concepcion':          { lat: -23.4000, lon: -57.4333, departamento: 'Concepción',    zona: 'Norte' },
  'pedro juan caballero':{ lat: -22.5500, lon: -55.7333, departamento: 'Amambay',       zona: 'Norte' },
  'san estanislao':      { lat: -24.6500, lon: -56.4333, departamento: 'San Pedro',     zona: 'Norte' },
  'san pedro':           { lat: -24.1167, lon: -56.9833, departamento: 'San Pedro',     zona: 'Norte' },
  'paraguarí':           { lat: -25.6333, lon: -57.1500, departamento: 'Paraguarí',     zona: 'Central' },
  'paraguari':           { lat: -25.6333, lon: -57.1500, departamento: 'Paraguarí',     zona: 'Central' },
  'pilar':               { lat: -26.8500, lon: -58.3000, departamento: 'Ñeembucú',      zona: 'Sur' },
  'filadelfia':          { lat: -22.3500, lon: -60.0333, departamento: 'Boquerón',      zona: 'Chaco' },
  'mariscal estigarribia':{ lat: -22.0333, lon: -60.6167, departamento: 'Boquerón',    zona: 'Chaco' },
  'pozo colorado':       { lat: -23.4833, lon: -58.7833, departamento: 'Presidente Hayes', zona: 'Chaco' },
};

export const ZONES = ['Central', 'Cordillera', 'Oriente Norte', 'Oriente Sur', 'Este', 'Norte', 'Sur', 'Chaco'];

export const ZONE_COLORS: Record<string, string> = {
  'Central':       '#38bdf8',
  'Cordillera':    '#a78bfa',
  'Oriente Norte': '#34d399',
  'Oriente Sur':   '#4ade80',
  'Este':          '#fb923c',
  'Norte':         '#f472b6',
  'Sur':           '#facc15',
  'Chaco':         '#94a3b8',
  'Desconocido':   '#475569',
};

export function getCityCoords(ciudad: string): CityCoords | null {
  if (!ciudad) return null;
  const key = ciudad.toLowerCase().trim();
  return CITY_COORDS[key] ?? null;
}

export function getZone(ciudad: string): string {
  const coords = getCityCoords(ciudad);
  return coords?.zona ?? 'Desconocido';
}
