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
    # cada entrada: modulo ADS1115 (0,1,2) + canal (0-3) + rango de ingenieria
    # que corresponde a 4mA y 20mA respectivamente.
    # LEGACY: ya no se usa por defecto (ver "plc_*" abajo). Se deja el driver
    # (ads1115.py) y esta config por si se vuelve a necesitar leer sensores
    # 4-20mA directos en algun equipo sin PLC.
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
    # LEGACY: idem "analog" arriba, ya no se usa con el PLC BOGE.
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

    # ── Fuente de datos ──────────────────────────────────────────
    # "plc"    -> lee todo por Modbus TCP del PLC BOGE (ver plc_* abajo)
    # "sensors"-> modo legacy, lee ADS1115 + entradas digitales (arriba)
    "data_source": "plc",

    # ── PLC BOGE (Siemens S7-1200 CPU 1214C) via Modbus TCP ─────
    # SOLO LECTURA: este gateway nunca escribe al PLC (ver modbus_tcp.py).
    "plc_ip": "100.100.200.10",
    "plc_port": 501,
    "plc_unit_id": 1,

    # Mapa de registros: offset 0-based respecto a 40001 (ej. registro
    # "40006" -> offset 5). "scale" se multiplica por el valor crudo leido;
    # "signed" interpreta el registro de 16 bits como complemento a 2;
    # "words": 2 marca un valor de 32 bits repartido en dos registros
    # consecutivos (big-endian: primero el word alto).
    #
    # ⚠️ ESTOS OFFSETS SON UNA HIPOTESIS DE TRABAJO, NO ESTAN CONFIRMADOS
    # con la documentacion real del programa BOGE/TIA Portal. Antes de
    # confiar en los valores, correr el modo diagnostico (ver README) que
    # vuelca los 41 registros crudos, y ajustar esta tabla comparando esos
    # valores contra lo que se ve en el HMI/tablero del PLC en ese momento.
    "plc_registers": {
        "o2_flow_m3h":           {"offset": 0,  "scale": 0.01, "signed": False, "words": 1},
        "tower_a_pressure_bar":  {"offset": 1,  "scale": 0.01, "signed": False, "words": 1},
        "tower_b_pressure_bar":  {"offset": 2,  "scale": 0.01, "signed": False, "words": 1},
        "o2_tank_pressure_bar":  {"offset": 3,  "scale": 0.01, "signed": False, "words": 1},
        "o2_purity_pct":         {"offset": 4,  "scale": 0.01, "signed": False, "words": 1},
        "psa_dewpoint_c":        {"offset": 5,  "scale": 0.1,  "signed": True,  "words": 1},
        "air_line_pressure_bar": {"offset": 6,  "scale": 0.01, "signed": False, "words": 1},
        "air_dewpoint_c":        {"offset": 7,  "scale": 0.1,  "signed": True,  "words": 1},
        "vacuum_level_mmhg":     {"offset": 8,  "scale": 1,    "signed": True,  "words": 1},
        # codigo de estado: 0=OFF, 1=ON, 2=FAULT (confirmar con BOGE)
        "compressor_status_code":   {"offset": 9,  "scale": 1, "signed": False, "words": 1},
        "vacuum_pump_status_code":  {"offset": 10, "scale": 1, "signed": False, "words": 1},
        # horas del compresor como entero de 32 bits (2 registros)
        "compressor_hours":      {"offset": 11, "scale": 1,    "signed": False, "words": 2},
    },
    # Cuantos registros leer en una sola consulta Modbus (40001-40041 = 41)
    "plc_register_count": 41,
    # Si es True, imprime por Serial los 41 registros crudos en cada ciclo
    # -- util para comisionar/ajustar "plc_registers" sin documentacion,
    # comparando estos valores contra lo que muestra el HMI del PLC.
    "plc_debug_dump": True,
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
