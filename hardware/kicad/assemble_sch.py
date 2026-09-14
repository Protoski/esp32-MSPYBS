#!/usr/bin/env python3
"""Ensambla el archivo .kicad_sch final a partir de _lib_symbols.txt y _layout.json.

Formato verificado contra las plantillas oficiales que trae instalado KiCad
9.0 en /usr/share/kicad/template/ -- de ahi se confirmo la estructura exacta
de una instancia de simbolo, sus pines, y el bloque de instancias por
proyecto que exige el formato moderno (2025+) de esquematicos.
"""

import json
import uuid

PROJECT_NAME = "plant_monitor"
ROOT_UUID = str(uuid.uuid4())


def uid():
    return str(uuid.uuid4())


def qualify_top_symbol(text, bare_name, libname):
    """Reemplaza SOLO la linea de apertura del simbolo de nivel superior
    ('(symbol "bare_name"' con comilla de cierre inmediata) por su forma
    calificada 'Libreria:bare_name'. No toca los sub-simbolos anidados
    (que terminan en _0_1 / _1_1 y por eso no calzan con este patron exacto)."""
    needle = f'(symbol "{bare_name}"'
    replacement = f'(symbol "{libname}:{bare_name}"'
    assert text.count(needle) == 1, f"se esperaba encontrar '{needle}' una sola vez"
    return text.replace(needle, replacement, 1)


with open("_lib_symbols.txt") as f:
    raw = f.read()

# los 7 simbolos de nivel superior, en el mismo orden en que se escribieron
bare_names = ["ESP32_DevKit", "ADS1115_Modulo", "Optoacoplador_4p", "R", "Conn_01x02", "GND", "+3V3", "PWR_FLAG"]
libnames   = ["local",        "local",          "local",            "Device", "Connector_Generic", "power", "power", "power"]

# cortar el texto en los puntos donde arranca cada simbolo de nivel superior
offsets = [raw.index(f'\t(symbol "{bare}"') for bare in bare_names]
assert offsets == sorted(offsets), "los simbolos no estan en el orden esperado"
bounds = offsets + [len(raw)]
parts_split = [raw[bounds[i]:bounds[i + 1]] for i in range(len(bare_names))]

qualified = [qualify_top_symbol(p, bare, lib) for p, bare, lib in zip(parts_split, bare_names, libnames)]
LIB_SYMBOLS_BLOCK = "\n".join(qualified)

with open("_layout.json") as f:
    layout = json.load(f)

PIN_NUMS = {
    "local:ESP32_DevKit": ["3V3", "GND", "21", "22", "25", "27", "26", "33"],
    "local:ADS1115_Modulo": ["VDD", "GND", "ADDR", "SCL", "SDA", "A0", "A1", "A2", "A3"],
    "local:Optoacoplador_4p": ["1", "2", "4", "3"],
    "local:R": ["1", "2"],
    "local:Conn_01x02": ["1", "2"],
    "power:GND": ["1"],
    "power:+3V3": ["1"],
    "power:PWR_FLAG": ["1"],
}


def lib_id_for(lib_id_raw):
    return lib_id_raw.replace("local:R", "Device:R").replace(
        "local:Conn_01x02", "Connector_Generic:Conn_01x02")


def emit_instance(ref, lib_id_raw, x, y, value):
    lib_id = lib_id_for(lib_id_raw)
    is_power = lib_id.startswith("power:")
    pins = PIN_NUMS.get(lib_id_raw, [])
    pin_lines = "\n".join(f'\t\t(pin "{p}" (uuid "{uid()}"))' for p in pins)
    ref_prop = "" if not is_power else ""
    hide_ref = "(hide yes)" if is_power else ""
    return f'''\t(symbol
\t\t(lib_id "{lib_id}")
\t\t(at {x:.2f} {y:.2f} 0)
\t\t(unit 1)
\t\t(exclude_from_sim no) (in_bom yes) (on_board yes) (dnp no)
\t\t(uuid "{uid()}")
\t\t(property "Reference" "{ref}" (at {x:.2f} {y-13.97:.2f} 0) (effects (font (size 1.27 1.27)) {hide_ref}))
\t\t(property "Value" "{value}" (at {x:.2f} {y+13.97:.2f} 0) (effects (font (size 1.27 1.27)) {hide_ref}))
\t\t(property "Footprint" "" (at {x:.2f} {y:.2f} 0) (effects (font (size 1.27 1.27)) (hide yes)))
\t\t(property "Datasheet" "~" (at {x:.2f} {y:.2f} 0) (effects (font (size 1.27 1.27)) (hide yes)))
{pin_lines}
\t\t(instances
\t\t\t(project "{PROJECT_NAME}"
\t\t\t\t(path "/{ROOT_UUID}"
\t\t\t\t\t(reference "{ref}")
\t\t\t\t\t(unit 1)
\t\t\t\t)
\t\t\t)
\t\t)
\t)'''


def emit_wire(p1, p2):
    return f'''\t(wire
\t\t(pts (xy {p1[0]:.2f} {p1[1]:.2f}) (xy {p2[0]:.2f} {p2[1]:.2f}))
\t\t(stroke (width 0) (type solid))
\t\t(uuid "{uid()}")
\t)'''


def emit_no_connect(x, y):
    return f'\t(no_connect (at {x:.2f} {y:.2f}) (uuid "{uid()}"))'


def emit_label(x, y, text):
    return f'''\t(label "{text}"
\t\t(at {x:.2f} {y:.2f} 0)
\t\t(effects (font (size 1.27 1.27)) (justify left bottom))
\t\t(uuid "{uid()}")
\t)'''


instances_txt = "\n".join(
    emit_instance(ref, lib_id, x, y, value) for ref, lib_id, x, y, value in layout["instances"]
)
wires_txt = "\n".join(emit_wire(tuple(w[0]), tuple(w[1])) for w in layout["wires"])
labels_txt = "\n".join(emit_label(x, y, text) for x, y, text in layout["labels"])
nc_txt = "\n".join(emit_no_connect(x, y) for x, y in layout.get("no_connects", []))

SCH = f'''(kicad_sch
\t(version 20250114)
\t(generator "eeschema")
\t(generator_version "9.0")
\t(uuid "{ROOT_UUID}")
\t(paper "A2")
\t(title_block
\t\t(title "Monitor Planta de Gases Medicinales - Interfaz de sensores")
\t\t(comment 1 "Hospital Basico de Guarambare - MSPYBS")
\t\t(comment 2 "9 canales 4-20mA (ADS1115 x3) + 4 entradas digitales aisladas")
\t)
\t(lib_symbols
{LIB_SYMBOLS_BLOCK}
\t)
{instances_txt}
{wires_txt}
{labels_txt}
{nc_txt}
\t(sheet_instances
\t\t(path "/" (page "1"))
\t)
\t(embedded_fonts no)
)
'''

with open("plant_monitor.kicad_sch", "w") as f:
    f.write(SCH)

print("Escrito plant_monitor.kicad_sch:", len(SCH), "caracteres")
print("ROOT_UUID:", ROOT_UUID)
with open("_root_uuid.txt", "w") as f:
    f.write(ROOT_UUID)
