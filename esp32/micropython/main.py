"""Monitor Planta Gases Medicinales - version MicroPython.

Combina dos fuentes de datos, ambas activas al mismo tiempo:
  1. Sensores locales: 9 transmisores 4-20mA (via 3x ADS1115) + 4 contactos
     digitales aislados. Lectura no invasiva, siempre activa.
  2. PLC BOGE (Siemens S7-1200) por Modbus TCP -- SOLO LECTURA, ver
     modbus_tcp.py -- a traves de una interfaz Ethernet dedicada (W5500,
     ver eth_plc.py), separada de la WiFi que se usa para llegar a
     internet. Se puede desactivar con "read_plc": false en la config.

Arma un unico JSON con ambas fuentes y lo envia periodicamente al Google
Apps Script configurado, usando el mismo mecanismo HTTP de siempre.

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
import eth_plc

RUNTIME_PATH = "/runtime.json"
BOOT_BUTTON_PIN = 0
# Holgado a proposito: un ciclo puede tardar hasta ~40s si la red esta lenta
# (POST + GET del redirect, con 20s de timeout cada uno).
WDT_TIMEOUT_MS = 120000
# Tras N fallos seguidos de envio, reiniciar para recuperar memoria limpia
MAX_FALLOS_SEGUIDOS = 3
# Si el life bit del PLC no cambia en N lecturas seguidas, avisar por Serial
# (posible programa del PLC colgado) -- es solo un aviso, no una falla.
LIFE_BIT_STALE_WARN_AFTER = 5


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
    if cfg.get("unit_id"):
        payload["unit_id"] = cfg["unit_id"]
    if cfg.get("unit_type"):
        payload["unit_type"] = cfg["unit_type"]
    payload.update(analog_values)
    payload.update(digital_values)
    return payload


# ============================================================
# LECTURA DEL PLC BOGE (Modbus TCP, SOLO LECTURA)
# ============================================================

def _decode_field(raw, spec):
    kind = spec["kind"]
    offsets = spec["offsets"]
    scale = spec.get("scale", 1)
    if kind == "u16":
        return raw[offsets[0]] * scale
    if kind == "s16":
        v = raw[offsets[0]]
        if v >= 0x8000:
            v -= 0x10000
        return v * scale
    if kind == "boge32":
        # Formula propia de BOGE (NO es el shift <<16 estandar): validada
        # empiricamente contra una lectura real (8379 h, 91965 Nm3).
        low, high = raw[offsets[0]], raw[offsets[1]]
        return (high * 32768 + low) * scale
    if kind == "bitmask32":
        # Alarmas/fallos son mascaras de bits, no contadores: se combinan
        # con el shift estandar de 16 bits, no con la formula de BOGE.
        low, high = raw[offsets[0]], raw[offsets[1]]
        return (high << 16) | low
    raise ValueError("kind de registro desconocido: %s" % kind)


def decode_plc_registers(cfg, raw):
    """Traduce los 41 registros crudos al mapa documentado por BOGE."""
    values = {}
    for name, spec in cfg["plc_registers"].items():
        values[name] = _decode_field(raw, spec)

    values["alarms_ack"] = [raw[o] for o in cfg["plc_alarms_ack_offsets"]]

    state_code = raw[cfg["plc_plant_state_offset"]]
    values["plant_state"] = state_code
    values["plant_state_label"] = cfg["plc_plant_state_labels"].get(
        state_code, "DESCONOCIDO_%d" % state_code
    )

    v_start = cfg["plc_valves_offset_start"]
    values["valves"] = [raw[v_start + i] for i in range(cfg["plc_valves_count"])]

    values["life_bit"] = raw[cfg["plc_life_bit_offset"]]

    for key in ("o2_content_pct", "gas_flow_nm3h", "gas_pressure_barg",
                "air_inlet_pressure_barg", "gas_temp_c", "air_inlet_temp_c",
                "gas_dewpoint_c", "air_inlet_dewpoint_c"):
        if key in values:
            values[key] = round(values[key], 2)

    return values


def new_plc_state():
    return {
        "values": None,           # ultimo dato VALIDO conocido (se conserva ante fallos)
        "online": False,          # si el ultimo intento de lectura tuvo exito
        "last_life_bit": None,
        "life_bit_unchanged_cycles": 0,
        "consecutive_failures": 0,
    }


def poll_plc_once(cfg, state):
    """Intenta leer el PLC, con reintentos y espera progresiva. Ante fallo
    total, NO borra ni fabrica valores: conserva los ultimos datos validos
    y marca online=False, para no confundir 'no puedo hablarle al PLC' con
    'la planta esta en falla' (son cosas separadas a proposito)."""
    max_retries = cfg.get("plc_max_retries", 3)
    backoff = 1
    attempt = 0
    while attempt <= max_retries:
        try:
            raw = modbus_tcp.read_holding_registers(
                cfg["plc_ip"], cfg["plc_port"], cfg["plc_unit_id"],
                start_addr=0, quantity=cfg["plc_register_count"],
            )
            values = decode_plc_registers(cfg, raw)

            if cfg.get("plc_debug_dump"):
                print("  [PLC] registros crudos 40001-%d:" %
                      (40000 + cfg["plc_register_count"]), raw)

            life_bit = values["life_bit"]
            if state["last_life_bit"] == life_bit:
                state["life_bit_unchanged_cycles"] += 1
                if state["life_bit_unchanged_cycles"] == LIFE_BIT_STALE_WARN_AFTER:
                    print("  [PLC][AVISO] life bit sin cambios en %d lecturas -- "
                          "verificar que el programa del PLC siga corriendo"
                          % state["life_bit_unchanged_cycles"])
            else:
                state["life_bit_unchanged_cycles"] = 0
            state["last_life_bit"] = life_bit

            state["values"] = values
            state["online"] = True
            state["consecutive_failures"] = 0
            return
        except Exception as e:
            attempt += 1
            state["consecutive_failures"] += 1
            print("  [PLC][ERROR] lectura Modbus fallo (intento %d/%d): %s" %
                  (attempt, max_retries + 1, e))
            if attempt <= max_retries:
                time.sleep(backoff)
                backoff = min(backoff * 2, 10)

    state["online"] = False
    if state["values"] is None:
        print("  [PLC][ERROR] sin datos del PLC todavia -- se omiten campos plc_* de este envio")
    else:
        print("  [PLC][ERROR] PLC no responde -- se reenvian los ultimos datos validos "
              "marcados como plc_online=false")


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

    # Sensores locales: SIEMPRE activos, en paralelo al PLC.
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

    # PLC por Ethernet: opcional, no debe tumbar el arranque si falla.
    plc_enabled = bool(cfg.get("read_plc"))
    plc_state = new_plc_state()
    if plc_enabled:
        try:
            eth_plc.start(cfg)
            print("  [ETH] W5500 iniciado. IP local: %s  PLC: %s:%d (unit %d) -- SOLO LECTURA" %
                  (cfg["eth_esp32_ip"], cfg["plc_ip"], cfg["plc_port"], cfg["plc_unit_id"]))
        except Exception as e:
            print("  [ETH][ERROR] no se pudo iniciar Ethernet, PLC deshabilitado este arranque:", e)
            plc_enabled = False

    runtime = load_runtime()
    send_interval = cfg["send_interval_s"]
    plc_interval = max(1, cfg.get("plc_read_interval_s", 3))
    # Fuerza un primer envio y una primera lectura del PLC apenas arranca.
    last_send = time.time() - send_interval
    last_plc_poll = time.time() - plc_interval
    last_runtime_save = time.time()
    fallos_seguidos = 0

    # Watchdog: si el programa se cuelga, la placa se reinicia sola y
    # main.py arranca de nuevo. Es lo que hace que el equipo se recupere
    # sin que nadie vaya a la planta.
    wdt = WDT(timeout=WDT_TIMEOUT_MS)

    while True:
        wdt.feed()
        now = time.time()

        # Ciclo corto: leer el PLC cada plc_interval segundos (2-5s tipico),
        # independiente del intervalo de envio HTTP (tipicamente mas largo).
        if plc_enabled and (now - last_plc_poll) >= plc_interval:
            last_plc_poll = now
            try:
                poll_plc_once(cfg, plc_state)
            except Exception as e:
                # No debe poder tumbar el programa por ningun motivo.
                print("  [PLC][ERROR] fallo inesperado leyendo el PLC:", e)

        # Ciclo largo: armar el payload y enviarlo al backend.
        if (now - last_send) >= send_interval:
            last_send = now
            try:
                if not wifi_portal.is_connected():
                    print("[WiFi] Conexion perdida, reconectando...")
                    wifi_portal.connect_sta(cfg)

                analog_values = read_analog_fields(cfg, ads_modules)
                digital_values = read_digital_fields(cfg, pins, runtime, send_interval)
                payload = build_payload(cfg, analog_values, digital_values)

                payload["plc_online"] = plc_state["online"]
                if plc_state["values"] is not None:
                    for key, val in plc_state["values"].items():
                        payload["plc_" + key] = val

                body = json.dumps(payload)

                print("Enviando:", body)
                try:
                    status, resp = http_client.post_json(cfg["sheet_url"], body)
                    print("  Respuesta:", status, resp[:120])
                    fallos_seguidos = 0
                except Exception as e:
                    fallos_seguidos += 1
                    print("  [ERROR] no se pudo enviar (%d seguidos):" % fallos_seguidos, e)
                    # MicroPython no compacta la memoria: una vez que el heap
                    # queda fragmentado, mbedTLS no consigue su bloque
                    # contiguo y ya no se recupera solo. Reiniciar es la
                    # unica salida real.
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

        wdt.feed()
        time.sleep(1)


if __name__ == "__main__":
    main()
