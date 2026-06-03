// ── Tipos de la planta ────────────────────────────────────────

export type DeviceStatus  = 'ON' | 'OFF' | 'FAULT';
export type StatusLevel   = 'ok' | 'warn' | 'danger' | 'info' | 'neutral';

export interface PlantRow {
  timestamp:             string | null;
  hospital_id:           string;
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

export interface HospitalThresholds {
  o2_purity_warn:     number;
  o2_purity_critical: number;
  air_pressure_min:   number;
  air_pressure_max:   number;
  vacuum_min_mmhg:    number;
}

export interface HospitalEquipment {
  compressor_enabled: boolean;
  vacuum_enabled:     boolean;
  psa_enabled:        boolean;
}

export interface Hospital {
  id:           string;
  nombre:       string;
  ciudad:       string;
  direccion:    string;
  activo:       boolean;
  thresholds:   HospitalThresholds;
  equipment:    HospitalEquipment;
  created_at:   string;
}

export interface ApiDataResponse {
  ok:    boolean;
  count: number;
  rows:  PlantRow[];
  error?: string;
}

export interface ApiHospitalsResponse {
  ok:         boolean;
  hospitals:  Hospital[];
  error?:     string;
}

export interface ApiCommandResponse {
  ok:      boolean;
  message?: string;
  error?:  string;
}

export interface HospitalSummary {
  hospital:        Hospital;
  latest:          PlantRow | null;
  isOnline:        boolean;
  activeAlerts:    number;
}
