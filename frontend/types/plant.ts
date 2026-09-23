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
  // Datos del PLC BOGE (null en equipos sin PLC o filas antiguas)
  plc_online?:                  boolean | null;
  plc_plant_state?:             number | null;  // 1 = generador funcionando
  plc_plant_state_label?:       string | null;
  plc_o2_content_pct?:          number | null;
  plc_gas_flow_nm3h?:           number | null;
  plc_gas_pressure_barg?:       number | null;
  plc_air_inlet_pressure_barg?: number | null;
  plc_gas_temp_c?:              number | null;
  plc_air_inlet_temp_c?:        number | null;
  plc_gas_dewpoint_c?:          number | null;
  plc_air_inlet_dewpoint_c?:    number | null;
  plc_service_hours_total?:     number | null;
  plc_service_hours_partial?:   number | null;
  plc_flow_total_nm3?:          number | null;
  plc_flow_partial_nm3?:        number | null;
  plc_alarms?:                  number | null;
  plc_faults?:                  number | null;
  plc_alarms_ack?:              number[] | null;
  plc_valves?:                  number[] | null;
  plc_life_bit?:                number | null;
  // Equipo dentro del hospital (null en equipos antiguos = único equipo)
  unit_id?:   string | null;
  unit_type?: UnitType | null;
  // Solo en latest_all: la fila es el resumen del hospital y aquí va la
  // última lectura de cada equipo
  units?:     PlantRow[];
}

export type UnitType = 'o2' | 'air' | 'vacuum';

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
  lat?:         number | null; // ubicación personalizada en el mapa (fijada por el admin)
  lon?:         number | null;
}

export interface ApiDataResponse {
  ok:    boolean;
  count: number;
  rows:  PlantRow[];
  now?:  string; // hora del servidor (ISO) para detectar conexión sin depender del reloj del navegador
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
