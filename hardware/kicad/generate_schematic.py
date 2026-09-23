#!/usr/bin/env python3
"""Genera el esquematico KiCad del monitor de planta (ADS1115 x3 + optoacopladores x4).

Convenciones verificadas contra las plantillas oficiales de KiCad 9:
  - Al colocar un simbolo, KiCad NIEGA la coordenada Y de la libreria:
        posicion_absoluta = (inst_x + local_x,  inst_y - local_y)
    (comprobado comparando la propiedad Reference de un simbolo real:
     libreria (0, 20.32) + instancia en y=44.45  ->  y absoluta 24.13)
  - Todo debe caer en la grilla de 2.54 mm o el ERC marca "endpoint off grid".

Las conexiones se hacen con "cable corto + etiqueta" de forma uniforme:
dos etiquetas con el mismo nombre quedan electricamente unidas. Los simbolos
de alimentacion +3V3 y GND aparecen una sola vez cada uno, para que el ERC
considere esas redes como alimentadas.
"""

import json

GRID = 2.54
PIN_LEN = 2.54
STUB = 7.62


def snap(v):
    """Alinea a la grilla de 2.54 mm."""
    return round(v / GRID) * GRID


# ---------------------------------------------------------------------------
# Simbolos propios: caja con pines a los lados
# ---------------------------------------------------------------------------

def make_box_symbol(name, ref_prefix, value, left_pins, right_pins, datasheet="~"):
    width = 22.86  # 9 * 2.54
    h = GRID * (max(len(left_pins), len(right_pins)) + 1)
    top = h / 2
    coords = {}

    def pin_block(pin_list, side):
        lines = []
        n = len(pin_list)
        start_y = GRID * (n - 1) / 2
        for i, (pname, pnum, etype) in enumerate(pin_list):
            y = start_y - i * GRID
            x = (-width / 2 - PIN_LEN) if side == "left" else (width / 2 + PIN_LEN)
            angle = 0 if side == "left" else 180
            coords[pnum] = (x, y)
            lines.append(f'''\t\t\t(pin {etype} line
\t\t\t\t(at {x:.2f} {y:.2f} {angle})
\t\t\t\t(length {PIN_LEN})
\t\t\t\t(name "{pname}" (effects (font (size 1.27 1.27))))
\t\t\t\t(number "{pnum}" (effects (font (size 1.27 1.27))))
\t\t\t)''')
        return lines

    pins = pin_block(left_pins, "left") + pin_block(right_pins, "right")

    text = f'''\t(symbol "{name}"
\t\t(pin_names (offset 1.016))
\t\t(exclude_from_sim no) (in_bom yes) (on_board yes)
\t\t(property "Reference" "{ref_prefix}" (at 0 {top + 2.54:.2f} 0) (effects (font (size 1.27 1.27))))
\t\t(property "Value" "{value}" (at 0 {-(top + 2.54):.2f} 0) (effects (font (size 1.27 1.27))))
\t\t(property "Footprint" "" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))
\t\t(property "Datasheet" "{datasheet}" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))
\t\t(symbol "{name}_0_1"
\t\t\t(rectangle (start {-width/2:.2f} {top:.2f}) (end {width/2:.2f} {-top:.2f})
\t\t\t\t(stroke (width 0.254) (type default)) (fill (type background))
\t\t\t)
\t\t)
\t\t(symbol "{name}_1_1"
{chr(10).join(pins)}
\t\t)
\t\t(embedded_fonts no)
\t)'''
    return text, coords


ESP32_TXT, ESP32_PINS = make_box_symbol(
    "ESP32_DevKit", "U", "ESP32 DevKit",
    left_pins=[("3V3", "3V3", "power_in"), ("GND", "GND", "power_in")],
    right_pins=[
        ("GPIO21/SDA", "21", "bidirectional"),
        ("GPIO22/SCL", "22", "bidirectional"),
        ("GPIO25", "25", "input"),
        ("GPIO27", "27", "input"),
        ("GPIO26", "26", "input"),
        ("GPIO33", "33", "input"),
    ],
    datasheet="https://www.espressif.com/en/products/socs/esp32",
)

ADS_TXT, ADS_PINS = make_box_symbol(
    "ADS1115_Modulo", "U", "ADS1115",
    left_pins=[("VDD", "VDD", "power_in"), ("GND", "GND", "power_in"), ("ADDR", "ADDR", "input")],
    right_pins=[
        ("SCL", "SCL", "input"), ("SDA", "SDA", "bidirectional"),
        ("A0", "A0", "passive"), ("A1", "A1", "passive"),
        ("A2", "A2", "passive"), ("A3", "A3", "passive"),
    ],
    datasheet="https://www.ti.com/lit/ds/symlink/ads1115.pdf",
)

OPTO_TXT, OPTO_PINS = make_box_symbol(
    "Optoacoplador_4p", "OK", "PC817",
    left_pins=[("A", "1", "passive"), ("K", "2", "passive")],
    right_pins=[("C", "4", "passive"), ("E", "3", "passive")],
    datasheet="PC817 / 4N35 / TLP291",
)

with open("sym_R.txt") as f:
    R_TXT = f.read().rstrip("\n")
with open("sym_Conn01x02.txt") as f:
    CONN_TXT = f.read().rstrip("\n")
with open("sym_GND.txt") as f:
    GND_TXT = f.read().rstrip("\n")
with open("sym_3V3.txt") as f:
    V3_TXT = f.read().rstrip("\n")
with open("sym_PWRFLAG.txt") as f:
    PWRFLAG_TXT = f.read().rstrip("\n")

# Coordenadas locales reales, leidas de los archivos de libreria
R_PINS = {"1": (0.0, 3.81), "2": (0.0, -3.81)}
CONN2_PINS = {"1": (-5.08, 0.0), "2": (-5.08, -2.54)}
PWR_PIN = {"1": (0.0, 0.0)}   # tanto GND como +3V3 tienen su pin en el origen

LIB_SYMBOLS = "\n".join([ESP32_TXT, ADS_TXT, OPTO_TXT, R_TXT, CONN_TXT, GND_TXT, V3_TXT, PWRFLAG_TXT])

# ---------------------------------------------------------------------------
# Colocacion
# ---------------------------------------------------------------------------

instances = []
wires = []
labels = []
no_connects = []


def pin_abs(ix, iy, local):
    """Posicion absoluta de un pin: la Y de la libreria se niega."""
    return (ix + local[0], iy - local[1])


def place(ref, lib_id, x, y, value, local_pins, nets, dirs):
    x, y = snap(x), snap(y)
    instances.append((ref, lib_id, x, y, value))
    for num, net in nets.items():
        ax, ay = pin_abs(x, y, local_pins[num])
        dx, dy = dirs[num]
        ex, ey = ax + dx * STUB, ay + dy * STUB
        wires.append(((ax, ay), (ex, ey)))
        labels.append((ex, ey, net))


def place_power(ref, lib_id, x, y, value, net):
    """Simbolo de alimentacion + su etiqueta, para que la red quede 'alimentada'."""
    x, y = snap(x), snap(y)
    instances.append((ref, lib_id, x, y, value))
    ax, ay = pin_abs(x, y, PWR_PIN["1"])
    ey = ay + STUB if value == "GND" else ay - STUB
    wires.append(((ax, ay), (ax, ey)))
    labels.append((ax, ey, net))


# --- ESP32 -----------------------------------------------------------------
place("U1", "local:ESP32_DevKit", 63.5, 127.0, "ESP32 DevKit", ESP32_PINS,
      nets={"3V3": "+3V3", "GND": "GND", "21": "SDA", "22": "SCL",
            "25": "DI_COMP_RUN", "27": "DI_COMP_FAULT",
            "26": "DI_VAC_RUN", "33": "DI_VAC_FAULT"},
      dirs={"3V3": (-1, 0), "GND": (-1, 0), "21": (1, 0), "22": (1, 0),
            "25": (1, 0), "27": (1, 0), "26": (1, 0), "33": (1, 0)})

# Los dos unicos simbolos de alimentacion del esquema
place_power("#PWR001", "power:+3V3", 40.64, 101.6, "+3V3", "+3V3")
place_power("#PWR002", "power:GND", 40.64, 152.4, "GND", "GND")

# PWR_FLAG: le dice al ERC que estas redes vienen alimentadas desde afuera
# (el 3V3 lo entrega el regulador de la propia placa ESP32)
place_power("#FLG001", "power:PWR_FLAG", 25.4, 101.6, "PWR_FLAG", "+3V3")
place_power("#FLG002", "power:PWR_FLAG", 25.4, 152.4, "PWR_FLAG", "GND")

# --- 3 x ADS1115 -----------------------------------------------------------
ADS_LABEL = {"U2": "ADS1115 0x48", "U3": "ADS1115 0x49", "U4": "ADS1115 0x4A"}
ADDR_NET = {"U2": "GND", "U3": "+3V3", "U4": "SDA"}  # fija la direccion I2C
channels = [
    ("tower_a_pressure_bar", "U2", "A0"), ("tower_b_pressure_bar", "U2", "A1"),
    ("o2_tank_pressure_bar", "U2", "A2"), ("air_line_pressure_bar", "U2", "A3"),
    ("o2_purity_pct", "U3", "A0"), ("psa_dewpoint_c", "U3", "A1"),
    ("air_dewpoint_c", "U3", "A2"), ("o2_flow_m3h", "U3", "A3"),
    ("vacuum_level_mmhg", "U4", "A0"),
]

for idx, ref in enumerate(["U2", "U3", "U4"]):
    ax, ay = 152.4, 50.8 + idx * 60.96
    nets = {"VDD": "+3V3", "GND": "GND", "ADDR": ADDR_NET[ref],
            "SCL": "SCL", "SDA": "SDA"}
    dirs = {"VDD": (-1, 0), "GND": (-1, 0), "ADDR": (-1, 0),
            "SCL": (1, 0), "SDA": (1, 0)}
    for cname, cref, cpin in channels:
        if cref == ref:
            nets[cpin] = f"CH_{cname.upper()}"
            dirs[cpin] = (1, 0)
    place(ref, "local:ADS1115_Modulo", ax, ay, ADS_LABEL[ref], ADS_PINS, nets, dirs)
    # canales de repuesto del tercer modulo: se marcan explicitamente sin conectar
    if ref == "U4":
        for spare in ("A1", "A2", "A3"):
            no_connects.append(pin_abs(snap(ax), snap(ay), ADS_PINS[spare]))

# --- 9 canales 4-20 mA: borne + resistencia shunt --------------------------
for i, (cname, cref, cpin) in enumerate(channels):
    y = 38.1 + i * 27.94
    net = f"CH_{cname.upper()}"
    place(f"J{i+1}", "local:Conn_01x02", 292.1, y, cname, CONN2_PINS,
          nets={"1": "LOOP_24V+", "2": net}, dirs={"1": (-1, 0), "2": (-1, 0)})
    place(f"R{i+1}", "local:R", 342.9, y, "150R 1%", R_PINS,
          nets={"1": net, "2": "GND"}, dirs={"1": (0, -1), "2": (0, 1)})

# --- 4 entradas digitales aisladas -----------------------------------------
digitals = [
    ("Marcha compresor", "DI_COMP_RUN"),
    ("Falla compresor", "DI_COMP_FAULT"),
    ("Marcha bomba vacio", "DI_VAC_RUN"),
    ("Falla bomba vacio", "DI_VAC_FAULT"),
]
for i, (desc, net) in enumerate(digitals):
    y = 291.1 + i * 33.02
    a_net = f"OPTO{i+1}_A"
    c_net = net
    place(f"J{10+i}", "local:Conn_01x02", 76.2, y, desc, CONN2_PINS,
          nets={"1": "LOOP_24V+", "2": a_net}, dirs={"1": (-1, 0), "2": (-1, 0)})
    place(f"R{10+i}", "local:R", 111.76, y, "2k2", R_PINS,
          nets={"1": a_net, "2": f"OPTO{i+1}_K"}, dirs={"1": (0, -1), "2": (0, 1)})
    place(f"OK{i+1}", "local:Optoacoplador_4p", 165.1, y, "PC817", OPTO_PINS,
          nets={"1": f"OPTO{i+1}_K", "2": "LOOP_24V-", "4": c_net, "3": "GND"},
          dirs={"1": (-1, 0), "2": (-1, 0), "4": (1, 0), "3": (1, 0)})
    place(f"R{14+i}", "local:R", 223.52, y, "10k", R_PINS,
          nets={"1": "+3V3", "2": c_net}, dirs={"1": (0, -1), "2": (0, 1)})
    # el nodo colector/pull-up es la señal que lee el ESP32
    labels.append((snap(223.52) + 5.08, snap(y) + 3.81 + STUB, net))
    wires.append(((snap(223.52), snap(y) + 3.81 + STUB),
                  (snap(223.52) + 5.08, snap(y) + 3.81 + STUB)))

print(f"Instancias: {len(instances)}  Cables: {len(wires)}  Etiquetas: {len(labels)}")

with open("_lib_symbols.txt", "w") as f:
    f.write(LIB_SYMBOLS)
with open("_layout.json", "w") as f:
    json.dump({"instances": instances, "wires": wires, "labels": labels,
               "no_connects": no_connects}, f)
