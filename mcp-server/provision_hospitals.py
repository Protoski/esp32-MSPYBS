#!/usr/bin/env python3
"""
Alta puntual de hospitales con un ID externo predefinido (ej. el
`sensorMspbsId` que SIGGAM va a usar para identificar cada planta en el
sistema ESP32/MSPYBS).

Requiere que el backend (backend/google-apps-script.js) ya tenga el soporte
de "id" opcional en add_hospital -- si el hospital ya existe con ese id, el
backend devuelve error y este script simplemente lo reporta y sigue con el
resto (no falla, no duplica nada).

Uso:
    python3 provision_hospitals.py --url "https://script.google.com/macros/s/XXX/exec"

Para agregar otros hospitales, edita la lista HOSPITALS más abajo.
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

# Hospitales a crear, con el UUID que ya usa/usará SIGGAM como sensorMspbsId
# (columna "ESP32" de la tabla de comparación de identidades).
HOSPITALS = [
    {"id": "08a38b2c-ffd6-49d1-ad1b-f4faf85f6c64", "nombre": "INERAM", "ciudad": "Asunción"},
    {"id": "d699169a-a517-4489-bf79-4dc1ba9f21f7", "nombre": "Guarambaré", "ciudad": "Guarambaré"},
    {"id": "574a7042-5f62-4e71-9fc5-45bfdc163e0", "nombre": "Mcal. Estigarribia", "ciudad": "Mariscal Estigarribia"},
    {"id": "8e921cd2-e51d-49c9-94ed-5c756fb28ba3", "nombre": "Ciudad del Este", "ciudad": "Ciudad del Este"},
]


def api_post(base_url: str, body: dict) -> dict:
    payload = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        base_url,
        data=payload,
        headers={"Content-Type": "text/plain;charset=utf-8"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main():
    parser = argparse.ArgumentParser(description="Provisionar hospitales con id externo predefinido.")
    parser.add_argument("--url", default=os.environ.get("MSPYBS_API_URL"))
    args = parser.parse_args()

    if not args.url:
        print("❌ Falta la URL del backend. Usa --url o la variable MSPYBS_API_URL.")
        sys.exit(1)

    print(f"🔌 Conectando a: {args.url}\n")
    for h in HOSPITALS:
        body = {
            "action": "add_hospital",
            "id": h["id"],
            "nombre": h["nombre"],
            "ciudad": h["ciudad"],
            "activo": True,
        }
        try:
            res = api_post(args.url, body)
            if res.get("ok"):
                print(f"✅ {h['nombre']} ({h['ciudad']}) creado con id {h['id']}")
            else:
                # Backend responde ok:false, ej. "Ya existe un hospital con ese id"
                print(f"⏭  {h['nombre']}: {res.get('error')}")
        except Exception as exc:  # noqa: BLE001
            print(f"⚠  {h['nombre']}: error de red — {exc}")
        time.sleep(1)  # evita saturar Apps Script

    print("\nListo. Verifica con:")
    print(f"  {args.url}?action=hospitals")


if __name__ == "__main__":
    main()
