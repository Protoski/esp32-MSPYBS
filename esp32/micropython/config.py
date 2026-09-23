"""Carga y guarda la configuracion de la planta en /config.json.

Existe para que reconfigurar (WiFi, rangos de sensores, URL del Sheet)
no requiera reflashear la placa: se edita desde el portal web.
"""

import json

CONFIG_PATH = "/config.json"

DEFAULTS = {
    "wifi_ssid": "",
    "wifi_pass": "",
    "hospital_id": "",
    "sheet_url": "",
    "device_token": "",
    "action": "data",
    "send_interval_s": 60,

    # ── Sensores 4-20mA + entradas digitales (SIEMPRE activos) ──
    # Lectura no invasiva en paralelo al PLC -- se conservan ambas fuentes,
    # no se reemplazan una a la otra.
    "analog": {
        "tower_a_pressure_bar":  {"ads": 0, "ch": 0, "min": 0, "max": 16},
        "tower_b_pressure_bar":  {"ads": 0, "ch": 1, "min": 0, "max": 16},
        "o2_tank_pressure_bar":  {"ads": 0, "ch": 2, "min": 0, "max": 16},
        "air_line_pressure_bar": {"ads": 0, "ch": 3, "min": 0, "max": 16},
        "o2_purity_pct":         {"ads": 1, "ch": 0, "min": 0, "max": 100},
        "psa_dewpoint_c":        {"ads": 1, "ch": 1, "min": -100, "max": 20},
        "air_dewpoint_c":        {"ads": 1, "ch": 2, "min": -100, "max": 20},
        "o2_flow_m3h":           {"ads": 1, "ch": 3, "min": 0, "max": 50},
        "vacuum_level_mmhg":     {"ads": 2, "ch": 0, "min": 0, "max": 760},
    },
    # entradas digitales aisladas (contacto seco via optoacoplador).
    "digital": {
        "compressor_status": {
            "run_pin": 25, "fault_pin": 27, "invert": False,
        },
        "vacuum_pump_status": {
            "run_pin": 26, "fault_pin": 33, "invert": False,
        },
    },
    # direcciones I2C de los 3 modulos ADS1115 (se fijan con el pin ADDR)
    "ads_addresses": [0x48, 0x49, 0x4A],

    # ── Lectura directa del PLC BOGE (Siemens S7-1200 CPU 1214C) ────
    # Se agrega COMO EXTRA junto a los sensores de arriba, no los reemplaza.
    "read_plc": True,

    # -- Red Ethernet dedicada al PLC (W5500 por SPI) --
    # Red aislada solo PLC <-> ESP32 a traves de un switch: sin gateway,
    # a proposito, para que nada mas pueda rutear hacia/desde ella.
    # ⚠️ Pines de ejemplo -- AJUSTAR segun el modulo W5500 y el ESP32 real.
    "eth_spi_id": 2,
    "eth_pin_sck": 18,
    "eth_pin_mosi": 23,
    "eth_pin_miso": 19,
    "eth_pin_cs": 5,
    "eth_pin_rst": 4,
    "eth_baudrate": 2000000,
    "eth_esp32_ip": "100.100.200.20",
    "eth_esp32_mask": "255.255.255.0",

    # -- Modbus TCP hacia el PLC (SOLO LECTURA, function code 0x03) --
    "plc_ip": "100.100.200.10",
    "plc_port": 501,
    "plc_unit_id": 1,
    "plc_register_count": 41,   # holding registers 40001-40041
    "plc_read_interval_s": 3,   # 2-5s segun lo pedido; independiente de send_interval_s
    "plc_max_retries": 3,       # reintentos con espera progresiva antes de dar por caida la lectura
    "plc_debug_dump": True,     # imprime los 41 registros crudos -- apagar una vez calibrado

    # Mapa de registros -- CONFIRMADO contra documentacion BOGE y contra una
    # lectura real (horas de servicio 8379h, totalizador 91965 Nm3, estado 0,
    # sin alarmas/fallos, valvulas cerradas). offset = registro - 40001.
    #
    # kind:
    #  "u16"       -> entero sin signo de 1 registro, *scale
    #  "s16"       -> igual pero interpretando complemento a 2 (temperaturas,
    #                 puntos de rocio, que pueden ser negativos)
    #  "boge32"    -> par (bajo, alto) combinado como alto*32768 + bajo,
    #                 formula propia de BOGE (NO es el shift <<16 estandar
    #                 de otros fabricantes) -- validada empiricamente arriba
    #  "bitmask32" -> par (bajo, alto) combinado como (alto<<16)|bajo, para
    #                 alarmas/fallos (mascara de bits, no un contador)
    "plc_registers": {
        # 40001: escala de fabrica desconocida (depende del rango del
        # analizador de O2 configurado en el PLC) -- CONFIRMAR con BOGE/HMI.
        "o2_content_pct":          {"offsets": [0],      "kind": "u16", "scale": 0.1},
        "gas_flow_nm3h":           {"offsets": [1],      "kind": "u16", "scale": 0.1},
        "gas_pressure_barg":       {"offsets": [2],      "kind": "u16", "scale": 0.1},
        "air_inlet_pressure_barg": {"offsets": [3],      "kind": "u16", "scale": 0.1},
        "gas_temp_c":              {"offsets": [4],      "kind": "s16", "scale": 0.1},
        "air_inlet_temp_c":        {"offsets": [5],      "kind": "s16", "scale": 0.1},
        "gas_dewpoint_c":          {"offsets": [6],      "kind": "s16", "scale": 0.1},
        "air_inlet_dewpoint_c":    {"offsets": [7],      "kind": "s16", "scale": 0.1},
        # offsets 8,9,10 (registros 40009-40011): no documentados, se ignoran
        "service_hours_total":     {"offsets": [11, 12], "kind": "boge32", "scale": 1},
        "service_hours_partial":   {"offsets": [13, 14], "kind": "boge32", "scale": 1},
        "flow_total_nm3":          {"offsets": [15, 16], "kind": "boge32", "scale": 1},
        "flow_partial_nm3":        {"offsets": [17, 18], "kind": "boge32", "scale": 1},
        "alarms":                  {"offsets": [19, 20], "kind": "bitmask32", "scale": 1},
        "faults":                  {"offsets": [21, 22], "kind": "bitmask32", "scale": 1},
    },
    # 40024-40026 (offsets 23,24,25): alarmas reconocidas, 3 palabras crudas
    "plc_alarms_ack_offsets": [23, 24, 25],
    # 40027 (offset 26): estado de planta
    "plc_plant_state_offset": 26,
    "plc_plant_state_labels": {
        0: "LISTA_PARA_COMENZAR",
        1: "FUNCIONANDO",
        2: "APAGADO_EN_PROGRESO",
        3: "ESPERA_EN_PROGRESO",
        4: "ESPERA_COMPLETADA",
        11: "REINICIO_AUTOMATICO_TRAS_CORTE",
    },
    # 40028-40036 (offsets 27-35): posicion de 9 valvulas, 0=cerrada 1=abierta
    "plc_valves_offset_start": 27,
    "plc_valves_count": 9,
    # offsets 36-39 (registros 40037-40040): no documentados, se ignoran
    # 40041 (offset 40): life bit -- heartbeat propio del PLC
    "plc_life_bit_offset": 40,
}


def load():
    try:
        with open(CONFIG_PATH) as f:
            cfg = json.load(f)
    except OSError:
        cfg = {}
    merged = dict(DEFAULTS)
    merged.update(cfg)
    return merged


def save(cfg):
    with open(CONFIG_PATH, "w") as f:
        json.dump(cfg, f)


def is_configured(cfg):
    return bool(cfg.get("wifi_ssid")) and bool(cfg.get("sheet_url"))
