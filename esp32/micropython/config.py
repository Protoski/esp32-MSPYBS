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
    # cada equipo tiene marcha + falla, igual que el tablero real.
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
