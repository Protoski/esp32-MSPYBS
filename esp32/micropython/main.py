"""Monitor Planta Gases Medicinales - version MicroPython.

Fuente de datos por defecto: lee el PLC BOGE (Siemens S7-1200) por Modbus
TCP -- SOLO LECTURA, ver modbus_tcp.py -- arma el mismo JSON que el
firmware anterior y lo envia periodicamente al Google Apps Script
configurado. El modo legacy (9 transmisores 4-20mA via 3x ADS1115 + 4
contactos digitales aislados) sigue disponible con "data_source": "sensors"
en la config, para equipos que todavia no tienen PLC.

Si no hay red guardada, o si al arrancar se mantiene presionado el
boton BOOT (GPIO0), levanta el portal de configuracion por WiFi.
"""

import gc
import time
import json
from machine import Pin, I2C, WDT, reset

import config as cfgmod
import wifi_portal
import http_client
import modbus_tcp

RUNTIME_PATH = "/runtime.json"
BOOT_BUTTON_PIN = 0
# Holgado a proposito: un ciclo puede tardar hasta ~40s si la red esta lenta
# (POST + GET del redirect, con 20s de timeout cada uno).
WDT_TIMEOUT_MS = 120000
# Tras N fallos seguidos de envio, reiniciar para recuperar memoria limpia
MAX_FALLOS_SEGUIDOS = 3


def load_runtime():
    try:
        with open(RUNTIME_PATH) as f:
            return json.load(f)
    except OSError:
        return {"compressor_hours": 0.0}


def save_runtime(rt):
    with open(RUNTIME_PATH, "w") as f:
        json.dump(rt, f)


def force_config_requested():
    btn = Pin(BOOT_BUTTON_PIN, Pin.IN, Pin.PULL_UP)
    return btn.value() == 0  # BOOT esta activo en bajo


def voltage_to_engineering(voltage, sensor_cfg):
    """4mA (0.6V con shunt de 150 ohm) -> min ; 20mA (3.0V) -> max."""
    v_min, v_max = 0.6, 3.0
    v = max(v_min, min(v_max, voltage))
    frac = (v - v_min) / (v_max - v_min)
    return sensor_cfg["min"] + frac * (sensor_cfg["max"] - sensor_cfg["min"])


def build_ads_modules(i2c, addresses):
    """Crea un ADS1115 por direccion presente en el bus; None si no responde."""
    from ads1115 import ADS1115
    found = set(i2c.scan())
    modules = {}
    for idx, addr in enumerate(addresses):
        modules[idx] = ADS1115(i2c, addr) if addr in found else None
    return modules


_sim_phase = 0.0


def simulated_voltage():
    """Valor de relleno cuando el ADS1115 correspondiente no esta conectado
    todavia, para poder probar todo el resto del programa sin el hardware."""
    global _sim_phase
    import math
    _sim_phase += 0.15
    return 1.8 + 0.6 * math.sin(_sim_phase)


def read_analog_fields(cfg, ads_modules):
    values = {}
    for name, s in cfg["analog"].items():
        mod = ads_modules.get(s["ads"])
        if mod is not None:
            try:
                voltage = mod.read_voltage(s["ch"])
            except OSError:
                voltage = simulated_voltage()
                print("[AVISO] fallo de lectura en", name, "- uso valor simulado")
        else:
            voltage = simulated_voltage()
        values[name] = round(voltage_to_engineering(voltage, s), 2)
    return values


def _equipment_status(run_pin, fault_pin, invert):
    running = bool(run_pin.value())
    faulted = bool(fault_pin.value())
    if invert:
        running, faulted = not running, not faulted
    if faulted:
        return "FAULT", running
    return ("ON" if running else "OFF"), running


def read_digital_fields(cfg, pins, runtime, elapsed_s):
    values = {}
    compressor_running = False
    for name, d in cfg["digital"].items():
        run_pin, fault_pin = pins[name]
        status, running = _equipment_status(run_pin, fault_pin, d.get("invert"))
        values[name] = status
        if name == "compressor_status":
            compressor_running = running

    if compressor_running:
        runtime["compressor_hours"] += elapsed_s / 3600.0
    values["compressor_hours"] = int(runtime["compressor_hours"])
    return values


def build_payload(cfg, analog_values, digital_values):
    payload = {"action": cfg["action"], "token": cfg["device_token"], "hospital_id": cfg["hospital_id"]}
    payload.update(analog_values)
    payload.update(digital_values)
    return payload


_STATUS_BY_CODE = {0: "OFF", 1: "ON", 2: "FAULT"}


def _register_value(raw_registers, spec):
    """Arma el valor de ingenieria de un campo a partir de los registros
    crudos leidos, aplicando signo y escala segun `spec` (ver plc_registers
    en config.py)."""
    offset = spec["offset"]
    if spec.get("words", 1) == 2:
        raw = (raw_registers[offset] << 16) | raw_registers[offset + 1]
        if spec.get("signed") and raw >= 0x80000000:
            raw -= 0x100000000
    else:
        raw = raw_registers[offset]
        if spec.get("signed") and raw >= 0x8000:
            raw -= 0x10000
    return raw * spec.get("scale", 1)


def read_plc_fields(cfg):
    """Lee el PLC BOGE por Modbus TCP (SOLO LECTURA) y arma los mismos
    campos que espera el backend. Ante cualquier error de comunicacion,
    propaga la excepcion -- el llamador decide como reaccionar (se trata
    igual que un fallo de envio HTTP: no debe matar el bucle principal)."""
    raw = modbus_tcp.read_holding_registers(
        cfg["plc_ip"], cfg["plc_port"], cfg["plc_unit_id"],
        start_addr=0, quantity=cfg["plc_register_count"],
    )

    values = {}
    for name, spec in cfg["plc_registers"].items():
        values[name] = _register_value(raw, spec)

    compressor_code = int(values.pop("compressor_status_code", 0))
    vacuum_code = int(values.pop("vacuum_pump_status_code", 0))
    values["compressor_status"] = _STATUS_BY_CODE.get(compressor_code, "FAULT")
    values["vacuum_pump_status"] = _STATUS_BY_CODE.get(vacuum_code, "FAULT")
    values["compressor_hours"] = int(values.get("compressor_hours", 0))

    for key in ("o2_flow_m3h", "tower_a_pressure_bar", "tower_b_pressure_bar",
                "o2_tank_pressure_bar", "o2_purity_pct", "psa_dewpoint_c",
                "air_line_pressure_bar", "air_dewpoint_c", "vacuum_level_mmhg"):
        if key in values:
            values[key] = round(values[key], 2)

    return values, raw


def main():
    cfg = cfgmod.load()

    if force_config_requested() or not cfgmod.is_configured(cfg):
        print("Entrando en modo de configuracion...")
        wifi_portal.start_ap_and_serve(cfg)
        return  # start_ap_and_serve reinicia la placa al guardar

    print("Conectando a WiFi '%s'..." % cfg["wifi_ssid"])
    if not wifi_portal.connect_sta(cfg):
        print("No se pudo conectar. Abriendo portal de configuracion.")
        wifi_portal.start_ap_and_serve(cfg)
        return

    print("Conectado. Iniciando monitoreo.")

    source = cfg.get("data_source", "plc")
    print("  Fuente de datos:", source)

    ads_modules = {}
    pins = {}
    if source == "sensors":
        i2c = I2C(0, scl=Pin(22), sda=Pin(21), freq=100000)
        ads_modules = build_ads_modules(i2c, cfg["ads_addresses"])
        for idx, mod in ads_modules.items():
            estado = "detectado" if mod else "NO detectado (se simula)"
            print("  ADS1115 #%d (0x%02X): %s" % (idx, cfg["ads_addresses"][idx], estado))

        pins = {
            name: (
                Pin(d["run_pin"], Pin.IN, Pin.PULL_DOWN),
                Pin(d["fault_pin"], Pin.IN, Pin.PULL_DOWN),
            )
            for name, d in cfg["digital"].items()
        }
    else:
        print("  PLC: %s:%d (unit %d) -- SOLO LECTURA" %
              (cfg["plc_ip"], cfg["plc_port"], cfg["plc_unit_id"]))

    runtime = load_runtime()
    interval = cfg["send_interval_s"]
    last_runtime_save = time.time()
    fallos_seguidos = 0

    # Watchdog: si el programa se cuelga (por ejemplo en una lectura de red
    # que nunca vuelve), la placa se reinicia sola y main.py arranca de nuevo.
    # Es lo que hace que el equipo se recupere sin que nadie vaya a la planta.
    wdt = WDT(timeout=WDT_TIMEOUT_MS)

    while True:
        loop_start = time.time()
        wdt.feed()

        try:
            # Si se cayo el WiFi, reconectar antes de intentar enviar.
            if not wifi_portal.is_connected():
                print("[WiFi] Conexion perdida, reconectando...")
                wifi_portal.connect_sta(cfg)

            if source == "sensors":
                analog_values = read_analog_fields(cfg, ads_modules)
                digital_values = read_digital_fields(cfg, pins, runtime, interval)
                payload = build_payload(cfg, analog_values, digital_values)
            else:
                # Si falla la lectura Modbus, la excepcion sube al except
                # de mas abajo, que ya sabe no matar el bucle principal;
                # sin dato del PLC no hay nada que enviar este ciclo.
                plc_values, raw_registers = read_plc_fields(cfg)
                if cfg.get("plc_debug_dump"):
                    print("  [PLC] registros crudos 40001-%d:" %
                          (40000 + cfg["plc_register_count"]), raw_registers)
                payload = build_payload(cfg, plc_values, {})

            body = json.dumps(payload)

            print("Enviando:", body)
            try:
                status, resp = http_client.post_json(cfg["sheet_url"], body)
                print("  Respuesta:", status, resp[:120])
                fallos_seguidos = 0
            except Exception as e:
                fallos_seguidos += 1
                print("  [ERROR] no se pudo enviar (%d seguidos):" % fallos_seguidos, e)
                # MicroPython no compacta la memoria: una vez que el heap queda
                # fragmentado, mbedTLS no consigue su bloque contiguo y ya no
                # se recupera solo. Reiniciar es la unica salida real.
                if fallos_seguidos >= MAX_FALLOS_SEGUIDOS:
                    print("  [RESET] demasiados fallos seguidos, reiniciando la placa")
                    time.sleep(1)
                    reset()

            if time.time() - last_runtime_save > 300:
                save_runtime(runtime)
                last_runtime_save = time.time()

        except Exception as e:
            # Nada dentro de un ciclo debe poder matar el bucle completo.
            print("  [ERROR] fallo el ciclo:", e)

        gc.collect()
        print("  [mem] libre:", gc.mem_free())

        # Dormir en tramos cortos, alimentando el watchdog en cada uno.
        elapsed = time.time() - loop_start
        restante = max(1, interval - elapsed)
        while restante > 0:
            wdt.feed()
            time.sleep(min(5, restante))
            restante -= 5


if __name__ == "__main__":
    main()
