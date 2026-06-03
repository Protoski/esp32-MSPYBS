/**
 * Tipos TypeScript que modelan los datos de la planta.
 * Deben coincidir exactamente con los campos del JSON que
 * retorna el backend (Google Apps Script doGet).
 */

export type DeviceStatus = 'ON' | 'OFF' | 'FAULT';

export interface PlantRow {
  timestamp:             string | null;
  o2_flow_m3h:           number;
  tower_a_pressure_bar:  number;
  tower_b_pressure_bar:  number;
  o2_tank_pressure_bar:  number;
  o2_purity_pct:         number;
  psa_dewpoint_c:        number;
  compressor_status:     DeviceStatus;
  compressor_hours:      number;
  air_line_pressure_bar: number;
  air_dewpoint_c:        number;
  vacuum_pump_status:    DeviceStatus;
  vacuum_level_mmhg:     number;
}

export interface ApiResponse {
  ok:    boolean;
  count: number;
  rows:  PlantRow[];
  error?: string;
}
