"""Monitor Planta Gases Medicinales - version MicroPython.

Lee 9 transmisores 4-20mA (via 3x ADS1115) y 4 contactos digitales
aislados (marcha + falla del compresor, marcha + falla de la bomba de
vacio), arma el mismo JSON que el firmware Arduino original, y lo
envia periodicamente al Google Apps Script configurado.

Si no hay red guardada, o si al arrancar se mantiene presionado el
boton BOOT (GPIO0), levanta el portal de configuracion por WiFi.
"""

import gc
import time
import json
from machine import Pin, I2C, WDT, reset

import config as cfgmod
import wifi_portal
from ads1115 import ADS1115
import http_client

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

            analog_values = read_analog_fields(cfg, ads_modules)
            digital_values = read_digital_fields(cfg, pins, runtime, interval)
            payload = build_payload(cfg, analog_values, digital_values)
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
