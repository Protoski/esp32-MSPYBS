#!/usr/bin/env python3
"""
Simulador de plantas MSPYBS.

Envía datos falsos (pero realistas) al mismo backend de Google Apps Script
que usan los ESP32 reales, simulando que ciertas plantas están funcionando
y en línea. El usuario elige interactivamente qué plantas simular como
"en línea"; las que no se seleccionan simplemente no reciben datos nuevos,
así que el dashboard/API las mostrará como "sin señal" (igual que a un
equipo real desconectado).

No requiere librerías externas, solo Python 3.8+.

Uso:
    python simulate_plants.py --url "https://script.google.com/macros/s/XXX/exec"

o dejando la URL como variable de entorno:
    export MSPYBS_API_URL="https://script.google.com/macros/s/XXX/exec"
    python simulate_plants.py

Comandos interactivos mientras corre:
    list              → muestra las plantas y cuáles están simuladas como online
    on <n>[,<n>...]    → marca esas plantas (por número de lista) como en línea
    off <n>[,<n>...]   → marca esas plantas como fuera de línea (deja de enviarles datos)
    quit / Ctrl+C      → detiene el simulador
"""

import argparse
import json
import os
import random
import sys
import threading
import time
import urllib.request
import urllib.error
import urllib.parse

SEND_INTERVAL_SECONDS = 5


def api_get(base_url: str, action: str, params: dict | None = None) -> dict:
    params = params or {}
    params["action"] = action
    params["_t"] = str(int(time.time() * 1000))
    query = "&".join(f"{k}={urllib.parse.quote(str(v))}" for k, v in params.items())
    url = f"{base_url}?{query}"
    with urllib.request.urlopen(url, timeout=15) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    if not data.get("ok"):
        raise RuntimeError(data.get("error", "Error desconocido del backend."))
    return data


def api_post(base_url: str, body: dict) -> dict:
    payload = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        base_url,
        data=payload,
        headers={"Content-Type": "text/plain;charset=utf-8"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    if not data.get("ok"):
        raise RuntimeError(data.get("error", "Error desconocido del backend."))
    return data


class PlantSimState:
    """Guarda valores acumulativos (horas de compresor) para que cada envío
    sea coherente con el anterior, como haría un equipo real."""

    def __init__(self, hospital_id: str):
        self.hospital_id = hospital_id
        self.compressor_hours = random.randint(500, 2000)

    def next_reading(self) -> dict:
        self.compressor_hours += SEND_INTERVAL_SECONDS / 3600.0
        return {
            "action": "data",
            "hospital_id": self.hospital_id,
            "o2_flow_m3h": round(random.uniform(2.8, 3.5), 2),
            "tower_a_pressure_bar": round(random.uniform(4.9, 5.1), 2),
            "tower_b_pressure_bar": round(random.uniform(0.2, 0.4), 2),
            "o2_tank_pressure_bar": round(random.uniform(4.0, 4.5), 2),
            "o2_purity_pct": round(random.uniform(93.5, 96.5), 2),
            "psa_dewpoint_c": round(random.uniform(-46, -40), 1),
            "compressor_status": "ON",
            "compressor_hours": round(self.compressor_hours, 1),
            "air_line_pressure_bar": round(random.uniform(4.7, 5.1), 2),
            "air_dewpoint_c": round(random.uniform(-48, -42), 1),
            "vacuum_pump_status": "ON",
            "vacuum_level_mmhg": round(random.uniform(-600, -500)),
        }


def sender_loop(base_url: str, states: dict, online_ids: set, lock: threading.Lock, stop_event: threading.Event):
    while not stop_event.is_set():
        with lock:
            targets = list(online_ids)
        for hospital_id in targets:
            try:
                reading = states[hospital_id].next_reading()
                api_post(base_url, reading)
                print(f"  → enviado OK: {states[hospital_id].hospital_id}")
            except Exception as exc:  # noqa: BLE001
                print(f"  ⚠ error enviando para {hospital_id}: {exc}")
        stop_event.wait(SEND_INTERVAL_SECONDS)


def print_list(hospitals: list, online_ids: set):
    print("\n=== Plantas ===")
    for i, h in enumerate(hospitals, start=1):
        estado = "🟢 EN LÍNEA (simulada)" if h["id"] in online_ids else "🔴 SIN SEÑAL (no se envían datos)"
        print(f"  {i}. {h['nombre']} ({h.get('ciudad') or 'sin ciudad'}) — {estado}")
    print()


def parse_indices(arg: str, count: int) -> list:
    indices = []
    for part in arg.split(","):
        part = part.strip()
        if not part.isdigit():
            continue
        n = int(part)
        if 1 <= n <= count:
            indices.append(n - 1)
    return indices


def main():
    parser = argparse.ArgumentParser(description="Simulador de plantas MSPYBS.")
    parser.add_argument("--url", default=os.environ.get("MSPYBS_API_URL"), help="URL del Apps Script (o setea MSPYBS_API_URL)")
    args = parser.parse_args()

    if not args.url:
        print("❌ Falta la URL del backend. Usa --url o la variable de entorno MSPYBS_API_URL.")
        sys.exit(1)

    base_url = args.url
    print(f"🔌 Conectando a: {base_url}")
    hospitals = api_get(base_url, "hospitals")["hospitals"]
    if not hospitals:
        print("❌ No hay plantas registradas en el Sheet. Crea al menos una antes de simular.")
        sys.exit(1)

    states = {h["id"]: PlantSimState(h["id"]) for h in hospitals}
    online_ids: set = set()
    lock = threading.Lock()
    stop_event = threading.Event()

    print_list(hospitals, online_ids)
    print("Selecciona qué plantas simular como EN LÍNEA (ej: 1,3) o Enter para ninguna todavía:")
    initial = input("> ").strip()
    if initial:
        with lock:
            for idx in parse_indices(initial, len(hospitals)):
                online_ids.add(hospitals[idx]["id"])

    thread = threading.Thread(
        target=sender_loop, args=(base_url, states, online_ids, lock, stop_event), daemon=True
    )
    thread.start()
    print(f"\n▶ Enviando datos cada {SEND_INTERVAL_SECONDS}s a las plantas seleccionadas.")
    print("Comandos: list | on <n,n,...> | off <n,n,...> | quit\n")

    try:
        while True:
            cmd = input("> ").strip()
            if not cmd:
                continue
            if cmd in ("quit", "exit", "q"):
                break
            if cmd == "list":
                with lock:
                    print_list(hospitals, online_ids)
                continue
            if cmd.startswith("on "):
                with lock:
                    for idx in parse_indices(cmd[3:], len(hospitals)):
                        online_ids.add(hospitals[idx]["id"])
                    print_list(hospitals, online_ids)
                continue
            if cmd.startswith("off "):
                with lock:
                    for idx in parse_indices(cmd[4:], len(hospitals)):
                        online_ids.discard(hospitals[idx]["id"])
                    print_list(hospitals, online_ids)
                continue
            print("Comando no reconocido. Usa: list | on <n,n,...> | off <n,n,...> | quit")
    except (KeyboardInterrupt, EOFError):
        pass
    finally:
        print("\n⏹ Deteniendo simulador...")
        stop_event.set()
        thread.join(timeout=2)


if __name__ == "__main__":
    main()
