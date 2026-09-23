import type { PlantRow } from '@/types/plant';

const STATE_TEXT: Record<number, string> = {
  0: 'Generador listo (detenido)',
  1: 'Generador funcionando',
  2: 'Generador apagándose',
  3: 'Generador entrando en espera',
  4: 'Generador en espera',
  11: 'Rearranque tras corte de energía',
};

// La pureza solo se evalúa contra los umbrales cuando el generador está
// produciendo: parado, en espera o sin comunicación con el PLC, un 0 % no
// es una alarma. Filas sin datos de PLC se evalúan como siempre.
export function purityEvaluable(row: PlantRow): boolean {
  if (row.plc_online === false) return false;
  if (row.plc_plant_state != null && row.plc_plant_state !== 1) return false;
  return true;
}

// Bits de FAULT ARRAY 1 (registro 40022), manual BOGE HMI S7-1200 pág. 53.
const FAULT_BITS: { bit: number; level: 'critical' | 'warning'; text: string }[] = [
  { bit: 0,  level: 'critical', text: 'Fallo del analizador de oxígeno' },
  { bit: 1,  level: 'critical', text: 'Fallo del flujómetro de gas producto' },
  { bit: 2,  level: 'critical', text: 'Fallo del transmisor de presión de entrada de aire' },
  { bit: 3,  level: 'critical', text: 'Fallo del transmisor de presión de gas producto' },
  { bit: 4,  level: 'critical', text: 'Fallo del transmisor de temperatura de entrada de aire' },
  { bit: 5,  level: 'critical', text: 'Fallo del transmisor de temperatura de gas producto' },
  { bit: 6,  level: 'critical', text: 'Fallo del transmisor de punto de rocío de entrada de aire' },
  { bit: 7,  level: 'critical', text: 'Fallo del transmisor de punto de rocío de gas producto' },
  { bit: 8,  level: 'critical', text: 'Fallo del compresor de aire' },
  { bit: 9,  level: 'critical', text: 'Fallo del secador de aire' },
  { bit: 10, level: 'warning',  text: 'Se requiere mantenimiento de filtros' },
  { bit: 11, level: 'warning',  text: 'Se requiere mantenimiento de válvulas' },
  { bit: 12, level: 'warning',  text: 'Comprobar la fuente de alimentación' },
];

export function plcFaults(row: PlantRow): { level: 'critical' | 'warning'; text: string }[] {
  const f = row.plc_faults;
  if (f == null) return [];
  return FAULT_BITS.filter(b => (f & (1 << b.bit)) !== 0).map(({ level, text }) => ({ level, text }));
}

// Texto para mostrar en lugar de la alarma de pureza, o null si no aplica.
export function generatorStatusText(row: PlantRow): string | null {
  if (row.plc_online === false) return 'Sin comunicación con el PLC';
  if (row.plc_plant_state == null) return null;
  return STATE_TEXT[row.plc_plant_state] ?? `Estado de planta ${row.plc_plant_state}`;
}
