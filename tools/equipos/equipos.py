#!/usr/bin/env python3
"""Alta y programación de ESP32 del monitor de gases medicinales.

Genera la carpeta de cada equipo (firmware + configuración), la compila y sube
al ESP32 conectado por USB, verifica el monitor serie y lleva un inventario.
Lo usa el skill /nuevo-equipo de Claude Code, pero funciona solo.

Configuración local (nunca en el repositorio), en ~/.config/mspybs/ con
permisos 600:
  global.env              API_URL y DEVICE_TOKEN (comunes a todos los equipos)
  wifi/<hospital_id>.env  red WiFi de cada hospital
  equipos.json            inventario

Ejecutar sin argumentos para ver los subcomandos. No imprime contraseñas ni tokens.
"""

import argparse
import datetime
import getpass
import glob
import json
import os
import re
import select
import shutil
import subprocess
import sys
import time
import unicodedata
import urllib.request

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
FIRMWARE_PLC = os.path.join(REPO, "esp32", "plant_monitor.ino")
FIRMWARE_MPY = os.path.join(REPO, "esp32", "micropython")
CONFIG_DIR = os.environ.get("MSPYBS_CONFIG_DIR", os.path.expanduser("~/.config/mspybs"))
FQBN = "esp32:esp32:esp32"
ESP32_INDEX = "https://espressif.github.io/arduino-esp32/package_esp32_index.json"
ARDUINO_LIBS = ["EthernetENC", "ArduinoJson@6.21.5"]
UNIT_PREFIX = {"o2": "O2", "air": "AIR", "vacuum": "VAC"}
# Marcas con perfil de PLC (mapa de registros Modbus) en plant_monitor.ino
PLC_BRANDS = {"BOGE"}
GENERIC_WORDS = {
    "hospital", "regional", "general", "basico", "distrital", "nacional", "instituto",
    "centro", "de", "del", "la", "las", "el", "los", "y", "psa", "planta", "sanatorio",
}


# ── utilidades ─────────────────────────────────────────────────────────────

def fail(msg, code=1):
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(code)


def write_private(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(text)
    os.chmod(path, 0o600)


def read_env(path):
    data = {}
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.rstrip("\n").split("=", 1)
                data[k.strip()] = v
    return data


def write_env(path, data):
    write_private(path, "".join(f"{k}={v}\n" for k, v in data.items()))


def c_string(value):
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def ask(label, secret=False):
    if not sys.stdin.isatty():
        return sys.stdin.readline().rstrip("\n")
    return getpass.getpass(f"{label}: ") if secret else input(f"{label}: ")


def slug(text):
    t = unicodedata.normalize("NFD", text).encode("ascii", "ignore").decode().lower()
    words = [w for w in re.split(r"[^a-z0-9]+", t) if w and w not in GENERIC_WORDS]
    return "_".join(words[:2]) or "hospital"


def now_iso():
    return datetime.datetime.now().replace(microsecond=0).isoformat()


def global_config():
    cfg = read_env(os.path.join(CONFIG_DIR, "global.env"))
    missing = [k for k in ("API_URL", "DEVICE_TOKEN") if not cfg.get(k)]
    if missing:
        fail("falta la configuración global (" + ", ".join(missing) + "). "
             "Ejecuta: python3 tools/equipos/equipos.py config-global")
    return cfg


def wifi_config(hospital_id):
    cfg = read_env(os.path.join(CONFIG_DIR, "wifi", f"{hospital_id}.env"))
    if not cfg.get("WIFI_SSID"):
        fail(f"no hay WiFi guardado para el hospital {hospital_id}. "
             f"Ejecuta: python3 tools/equipos/equipos.py wifi --hospital-id {hospital_id}")
    return cfg


# ── inventario ─────────────────────────────────────────────────────────────

def inventory_path():
    return os.path.join(CONFIG_DIR, "equipos.json")


def load_inventory():
    p = inventory_path()
    return json.load(open(p, encoding="utf-8")) if os.path.exists(p) else []


def save_inventory(items):
    write_private(inventory_path(), json.dumps(items, ensure_ascii=False, indent=2) + "\n")


def find_unit(items, hospital_id, unit_id):
    return next((e for e in items if e["hospital_id"] == hospital_id and e["unit_id"] == unit_id), None)


def upsert(entry):
    items = load_inventory()
    cur = find_unit(items, entry["hospital_id"], entry["unit_id"])
    if cur:
        cur.update(entry)
    else:
        items.append(entry)
    save_inventory(items)


def inventory_by_folder(folder):
    folder = os.path.abspath(folder)
    return next((e for e in load_inventory() if os.path.abspath(e.get("carpeta", "")) == folder), None)


# ── herramientas externas ─────────────────────────────────────────────────

def which(name):
    local = os.path.expanduser(f"~/.local/bin/{name}")
    return shutil.which(name) or (local if os.path.exists(local) else None)


def run(cmd, check=True, **kw):
    print("$ " + " ".join(cmd), flush=True)
    r = subprocess.run(cmd, **kw)
    if check and r.returncode != 0:
        fail(f"el comando terminó con código {r.returncode}")
    return r


def arduino_cli():
    return which("arduino-cli")


def esptool_cmd():
    exe = which("esptool") or which("esptool.py")
    if exe:
        return [exe]
    r = subprocess.run([sys.executable, "-m", "esptool", "version"], capture_output=True)
    return [sys.executable, "-m", "esptool"] if r.returncode == 0 else None


def serial_ports():
    ports = sorted(glob.glob("/dev/ttyUSB*") + glob.glob("/dev/ttyACM*") + glob.glob("/dev/cu.usbserial*")
                   + glob.glob("/dev/cu.SLAB*") + glob.glob("/dev/cu.wchusbserial*"))
    return ports


def pick_port(port):
    if port:
        return port
    ports = serial_ports()
    if len(ports) == 1:
        return ports[0]
    if not ports:
        fail("no hay ningún ESP32 conectado por USB (no se encontró /dev/ttyUSB* ni /dev/ttyACM*)")
    fail("hay varios puertos USB: " + ", ".join(ports) + ". Indica cuál con --puerto")


def cmd_check(args):
    say = (lambda *a, **k: None) if args.json else print
    rep = {"arduino_cli": None, "core_esp32": False, "librerias": {}, "esptool": False,
           "mpremote": False, "puertos": [], "puertos_sin_permiso": [], "config_global": False}
    cli = arduino_cli()
    if not cli and args.install:
        run(["sh", "-c", "curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh"
                         " | BINDIR=$HOME/.local/bin sh"])
        cli = arduino_cli()
    rep["arduino_cli"] = cli
    say(f"arduino-cli: {cli or 'NO INSTALADO'}")
    if cli:
        cores = subprocess.run([cli, "core", "list"], capture_output=True, text=True).stdout
        if "esp32:esp32" not in cores and args.install:
            subprocess.run([cli, "config", "init"], capture_output=True)
            run([cli, "config", "add", "board_manager.additional_urls", ESP32_INDEX], check=False)
            run([cli, "core", "update-index"])
            run([cli, "core", "install", "esp32:esp32"])
            cores = subprocess.run([cli, "core", "list"], capture_output=True, text=True).stdout
        rep["core_esp32"] = "esp32:esp32" in cores
        say(f"core esp32:esp32: {'ok' if rep['core_esp32'] else 'FALTA'}")
        libs = subprocess.run([cli, "lib", "list"], capture_output=True, text=True).stdout
        for lib in ARDUINO_LIBS:
            name = lib.split("@")[0]
            present = name in libs
            if not present and args.install:
                run([cli, "lib", "install", lib])
                present = True
            rep["librerias"][name] = present
            say(f"librería {name}: {'ok' if present else 'FALTA'}")
    # MicroPython (solo para equipos de sensores)
    esp = esptool_cmd()
    mpr = which("mpremote")
    if (not esp or not mpr) and args.install and args.sensores:
        pipx = which("pipx")
        for pkg in ("esptool", "mpremote"):
            if pipx:
                run([pipx, "install", pkg], check=False)
            else:
                run([sys.executable, "-m", "pip", "install", "--user", pkg], check=False)
        esp, mpr = esptool_cmd(), which("mpremote")
    rep["esptool"], rep["mpremote"] = bool(esp), bool(mpr)
    say(f"esptool (solo sensores): {'ok' if esp else 'no instalado'}")
    say(f"mpremote (solo sensores): {'ok' if mpr else 'no instalado'}")
    rep["puertos"] = serial_ports()
    say("puertos USB: " + (", ".join(rep["puertos"]) if rep["puertos"] else "ninguno"))
    for p in rep["puertos"]:
        if not os.access(p, os.R_OK | os.W_OK):
            rep["puertos_sin_permiso"].append(p)
            say(f"  sin permiso sobre {p}: ejecuta 'sudo usermod -aG dialout $USER' y vuelve a iniciar sesión")
    g = read_env(os.path.join(CONFIG_DIR, "global.env"))
    rep["config_global"] = bool(g.get("API_URL") and g.get("DEVICE_TOKEN"))
    say(f"configuración global: {'ok' if rep['config_global'] else 'FALTA (config-global)'}")
    ok = (bool(cli) and rep["core_esp32"] and all(rep["librerias"].values())
          and not rep["puertos_sin_permiso"] and rep["config_global"])
    rep["ok"] = ok
    if args.json:
        print(json.dumps(rep, ensure_ascii=False))
    sys.exit(0 if ok else 2)


# ── configuración local ────────────────────────────────────────────────────

def cmd_config_global(args):
    """Sin opciones pide URL, DEVICE_TOKEN y ADMIN_TOKEN (opcional). Con opciones,
    solo lo indicado; los tokens se leen ocultos o por stdin, nunca como argumento."""
    path = os.path.join(CONFIG_DIR, "global.env")
    cfg = read_env(path)
    todo = not (args.api_url or args.device_token or args.admin_token)
    url = args.api_url or (ask("URL del backend (termina en /exec)") if todo else None)
    if url is not None:
        if not re.match(r"^https://script\.google\.com/macros/s/[\w-]+/exec$", url.strip()):
            fail("la URL debe tener la forma https://script.google.com/macros/s/.../exec")
        cfg["API_URL"] = url.strip()
    if todo or args.device_token:
        token = ask("DEVICE_TOKEN", secret=True).strip()
        if not token:
            fail("DEVICE_TOKEN vacío")
        cfg["DEVICE_TOKEN"] = token
    if todo or args.admin_token:
        admin = ask("ADMIN_TOKEN (para crear hospitales; Enter para omitir)", secret=True).strip()
        if admin:
            cfg["ADMIN_TOKEN"] = admin
        elif args.admin_token:
            fail("ADMIN_TOKEN vacío")
    write_env(path, cfg)
    print(f"Guardado en {path} (permisos 600).")


def cmd_wifi(args):
    ssid = args.ssid or ask("Nombre de la red WiFi (SSID)")
    password = ask("Contraseña WiFi", secret=True)
    if not ssid.strip():
        fail("SSID vacío")
    path = os.path.join(CONFIG_DIR, "wifi", f"{args.hospital_id}.env")
    write_env(path, {"WIFI_SSID": ssid.strip(), "WIFI_PASSWORD": password})
    print(f"WiFi '{ssid.strip()}' guardado para el hospital {args.hospital_id} (permisos 600).")


def parse_secrets_h(path):
    text = open(path, encoding="utf-8").read()
    vals = {}
    for key in ("WIFI_SSID", "WIFI_PASSWORD", "API_URL", "DEVICE_TOKEN"):
        m = re.search(key + r'\s*=\s*"((?:[^"\\]|\\.)*)"', text)
        if m:
            vals[key] = m.group(1).replace('\\"', '"').replace("\\\\", "\\")
    return vals


def cmd_importar(args):
    vals = parse_secrets_h(args.desde)
    if vals.get("API_URL") and vals.get("DEVICE_TOKEN") and "PEGAR" not in vals["DEVICE_TOKEN"]:
        g = read_env(os.path.join(CONFIG_DIR, "global.env"))
        g.update(API_URL=vals["API_URL"], DEVICE_TOKEN=vals["DEVICE_TOKEN"])
        write_env(os.path.join(CONFIG_DIR, "global.env"), g)
        print("Configuración global importada (API_URL y DEVICE_TOKEN).")
    if vals.get("WIFI_SSID") and args.hospital_id:
        write_env(os.path.join(CONFIG_DIR, "wifi", f"{args.hospital_id}.env"),
                  {"WIFI_SSID": vals["WIFI_SSID"], "WIFI_PASSWORD": vals.get("WIFI_PASSWORD", "")})
        print(f"WiFi '{vals['WIFI_SSID']}' importado para el hospital {args.hospital_id}.")


def mpy_firmware():
    return next(iter(sorted(glob.glob(os.path.join(CONFIG_DIR, "micropython", "*.bin")))), None)


def cmd_estado(args):
    g = read_env(os.path.join(CONFIG_DIR, "global.env"))
    if args.json:
        wifis = sorted(glob.glob(os.path.join(CONFIG_DIR, "wifi", "*.env")))
        print(json.dumps({
            "config_dir": CONFIG_DIR,
            "api_url_final": g["API_URL"][-12:] if g.get("API_URL") else None,
            "device_token": bool(g.get("DEVICE_TOKEN")), "admin_token": bool(g.get("ADMIN_TOKEN")),
            "micropython_bin": mpy_firmware(),
            "wifi": [{"hospital_id": os.path.basename(w)[:-4], "ssid": read_env(w).get("WIFI_SSID", "")} for w in wifis],
        }, ensure_ascii=False))
        return
    print(f"Carpeta de configuración: {CONFIG_DIR}")
    print(f"API_URL: {'…' + g['API_URL'][-12:] if g.get('API_URL') else 'falta'}")
    print(f"DEVICE_TOKEN: {'guardado' if g.get('DEVICE_TOKEN') else 'falta'}")
    print(f"ADMIN_TOKEN: {'guardado' if g.get('ADMIN_TOKEN') else 'falta (solo para crear hospitales)'}")
    wifis = sorted(glob.glob(os.path.join(CONFIG_DIR, "wifi", "*.env")))
    print(f"WiFi guardados: {len(wifis)}")
    for w in wifis:
        print(f"  {os.path.basename(w)[:-4]}: {read_env(w).get('WIFI_SSID', '?')}")


# ── generación ─────────────────────────────────────────────────────────────

def fetch_units(hospital_id):
    url = read_env(os.path.join(CONFIG_DIR, "global.env")).get("API_URL")
    if not url:
        return []
    try:
        with urllib.request.urlopen(url + "?action=latest_all", timeout=20) as r:
            rows = json.load(r).get("rows", [])
    except Exception as e:
        print(f"AVISO: no se pudo consultar el backend ({e}); solo se usa el inventario local", file=sys.stderr)
        return []
    row = next((x for x in rows if x.get("hospital_id") == hospital_id), None)
    return [u.get("unit_id") for u in (row or {}).get("units", []) if u.get("unit_id")]


def cmd_siguiente(args):
    prefix = UNIT_PREFIX[args.tipo]
    used = {e["unit_id"] for e in load_inventory() if e["hospital_id"] == args.hospital_id}
    used |= set(fetch_units(args.hospital_id))
    n = 1
    while f"{prefix}-{n}" in used:
        n += 1
    print(f"{prefix}-{n}")


def check_unit(args):
    if not re.match(r"^[A-Z0-9][A-Z0-9-]{0,15}$", args.unidad):
        fail("UNIT_ID inválido: usa mayúsculas, números y guiones, p. ej. O2-2 o VAC-1")
    existing = find_unit(load_inventory(), args.hospital_id, args.unidad)
    if existing and not args.reemplazar:
        fail(f"{args.unidad} ya existe en este hospital (carpeta {existing.get('carpeta')}). "
             "Elige otro UNIT_ID o usa --reemplazar si es el mismo equipo.")


def target_folder(args):
    base = args.salida or next((p for p in (os.path.expanduser("~/Escritorio"), os.path.expanduser("~/Desktop"))
                                if os.path.isdir(p)), os.path.expanduser("~"))
    base = base if args.salida else os.path.join(base, "equipos")
    name = args.carpeta or f"{slug(args.hospital_nombre)}_{args.unidad.replace('-', '_')}"
    if not re.match(r"^[A-Za-z][A-Za-z0-9_]*$", name):
        fail("nombre de carpeta inválido: letras, números y _ (empezando por letra)")
    folder = os.path.join(base, name)
    if os.path.exists(folder) and not args.reemplazar:
        fail(f"la carpeta {folder} ya existe. Usa --reemplazar para regenerarla.")
    os.makedirs(folder, exist_ok=True)
    return folder, name


def cmd_generar_plc(args):
    if args.marca.upper() not in PLC_BRANDS:
        fail(f"no hay perfil de PLC para la marca '{args.marca}' (disponibles: {', '.join(sorted(PLC_BRANDS))}). "
             "Para esta planta usa un equipo de sensores (generar-sensores) o agrega el perfil "
             "de su PLC con el mapa de registros del fabricante.")
    if args.tipo != "o2":
        fail("la pasarela PLC es para plantas de O2 (tipo o2)")
    check_unit(args)
    g = global_config()
    w = wifi_config(args.hospital_id)
    folder, name = target_folder(args)
    shutil.copyfile(FIRMWARE_PLC, os.path.join(folder, f"{name}.ino"))
    equipo = [
        "// Generado por tools/equipos/equipos.py — configuración de este equipo",
        "#pragma once",
        f"// {args.hospital_nombre} — planta {args.marca.upper()}",
        f"const char* HOSPITAL_ID = {c_string(args.hospital_id)};",
        f"const char* UNIT_ID     = {c_string(args.unidad)};",
        f"const char* UNIT_TYPE   = {c_string(args.tipo)};",
        f"#define ETH_IP_LAST_OCTET {args.eth_ip}",
        f"#define PLC_IP_LAST_OCTET {args.plc_ip}",
        "",
    ]
    with open(os.path.join(folder, "equipo.h"), "w", encoding="utf-8") as f:
        f.write("\n".join(equipo))
    write_private(os.path.join(folder, "secrets.h"), "\n".join([
        "// Generado por tools/equipos/equipos.py — NO subir al repositorio",
        "#pragma once",
        f"const char* WIFI_SSID     = {c_string(w['WIFI_SSID'])};",
        f"const char* WIFI_PASSWORD = {c_string(w.get('WIFI_PASSWORD', ''))};",
        f"const char* API_URL       = {c_string(g['API_URL'])};",
        f"const char* DEVICE_TOKEN  = {c_string(g['DEVICE_TOKEN'])};",
        "",
    ]))
    upsert({"hospital_id": args.hospital_id, "hospital_nombre": args.hospital_nombre,
            "unit_id": args.unidad, "unit_type": args.tipo, "marca": args.marca.upper(),
            "firmware": "plc", "eth_ip": f"100.100.200.{args.eth_ip}", "plc_ip": f"100.100.200.{args.plc_ip}",
            "wifi_ssid": w["WIFI_SSID"], "carpeta": folder, "generado": now_iso(), "estado": "generado"})
    print(f"Carpeta lista: {folder}")
    print(f"  {name}.ino · equipo.h ({args.unidad}, {args.tipo}, IP .{args.eth_ip}) · secrets.h (WiFi '{w['WIFI_SSID']}')")


def cmd_generar_sensores(args):
    check_unit(args)
    if args.leer_plc and args.marca.upper() not in PLC_BRANDS:
        fail(f"no hay perfil de PLC para la marca '{args.marca}'; genera el equipo sin --leer-plc")
    g = global_config()
    w = wifi_config(args.hospital_id)
    folder, name = target_folder(args)
    for f in glob.glob(os.path.join(FIRMWARE_MPY, "*.py")):
        shutil.copyfile(f, os.path.join(folder, os.path.basename(f)))
    shutil.copytree(os.path.join(FIRMWARE_MPY, "tools"), os.path.join(folder, "tools"),
                    dirs_exist_ok=True, ignore=shutil.ignore_patterns("__pycache__"))
    # config.py completa el resto con sus DEFAULTS al arrancar
    cfg = {
        "wifi_ssid": w["WIFI_SSID"], "wifi_pass": w.get("WIFI_PASSWORD", ""),
        "hospital_id": args.hospital_id, "unit_id": args.unidad, "unit_type": args.tipo or "",
        "sheet_url": g["API_URL"], "device_token": g["DEVICE_TOKEN"],
        "read_plc": bool(args.leer_plc),
    }
    if args.leer_plc:
        cfg["eth_esp32_ip"] = f"100.100.200.{args.eth_ip}"
    write_private(os.path.join(folder, "config.json"), json.dumps(cfg, ensure_ascii=False, indent=2) + "\n")
    upsert({"hospital_id": args.hospital_id, "hospital_nombre": args.hospital_nombre,
            "unit_id": args.unidad, "unit_type": args.tipo or "", "marca": args.marca.upper(),
            "firmware": "sensores", "lee_plc": bool(args.leer_plc), "wifi_ssid": w["WIFI_SSID"],
            "carpeta": folder, "generado": now_iso(), "estado": "generado"})
    print(f"Carpeta lista: {folder}")
    print(f"  firmware MicroPython · config.json ({args.unidad}, {args.tipo or 'todos'}, "
          f"PLC {'sí (W5500)' if args.leer_plc else 'no'}) · WiFi '{w['WIFI_SSID']}'")
    print("  Revisa los rangos 4-20 mA de config.py (analog) contra los transmisores instalados.")


# ── subir, actualizar y verificar ──────────────────────────────────────────

def folder_kind(folder):
    if os.path.exists(os.path.join(folder, "main.py")):
        return "sensores"
    if glob.glob(os.path.join(folder, "*.ino")):
        return "plc"
    fail(f"{folder} no parece la carpeta de un equipo")


def cmd_subir(args):
    folder = os.path.abspath(args.carpeta)
    port = pick_port(args.puerto)
    kind = folder_kind(folder)
    if kind == "plc":
        cli = arduino_cli() or fail("falta arduino-cli: ejecuta check --install")
        run([cli, "compile", "--upload", "-b", FQBN, "-p", port, folder])
    else:
        esp = esptool_cmd() or fail("falta esptool: ejecuta check --install --sensores")
        mpr = which("mpremote") or fail("falta mpremote: ejecuta check --install --sensores")
        if not args.solo_archivos:
            fw = args.firmware or mpy_firmware()
            if not fw:
                fail("falta el firmware MicroPython: descarga ESP32_GENERIC .bin de "
                     f"https://micropython.org/download/ESP32_GENERIC/ en {CONFIG_DIR}/micropython/ o usa --firmware")
            run(esp + ["--port", port, "erase_flash"])
            run(esp + ["--port", port, "--baud", "460800", "write_flash", "0x1000", fw])
            time.sleep(3)
        for f in sorted(glob.glob(os.path.join(folder, "*.py"))) + [os.path.join(folder, "config.json")]:
            run([mpr, "connect", port, "fs", "cp", f, ":" + os.path.basename(f)])
        run([mpr, "connect", port, "fs", "cp", "-r", os.path.join(folder, "tools"), ":tools"], check=False)
        run([mpr, "connect", port, "reset"], check=False)
    entry = inventory_by_folder(folder)
    if entry:
        upsert({**entry, "subido": now_iso(), "puerto": port, "estado": "subido"})
    print("Firmware subido. Siguiente paso: verificar")


def cmd_actualizar(args):
    folder = os.path.abspath(args.carpeta)
    if folder_kind(folder) == "plc":
        ino = glob.glob(os.path.join(folder, "*.ino"))[0]
        shutil.copyfile(FIRMWARE_PLC, ino)
        print(f"Firmware actualizado en {ino} (se conservan equipo.h y secrets.h)")
    else:
        for f in glob.glob(os.path.join(FIRMWARE_MPY, "*.py")):
            shutil.copyfile(f, os.path.join(folder, os.path.basename(f)))
        print(f"Archivos .py actualizados en {folder} (se conserva config.json)")


def reset_board(fd):
    """Reinicia el ESP32 con la línea RTS (EN) dejando DTR (IO0) libre, como el IDE."""
    import fcntl
    import struct
    import termios
    try:
        fcntl.ioctl(fd, termios.TIOCMBIC, struct.pack("I", termios.TIOCM_DTR))
        fcntl.ioctl(fd, termios.TIOCMBIS, struct.pack("I", termios.TIOCM_RTS))
        time.sleep(0.2)
        fcntl.ioctl(fd, termios.TIOCMBIC, struct.pack("I", termios.TIOCM_RTS))
    except (OSError, AttributeError):
        pass


def read_serial(port, seconds, reset=True):
    """Lee el puerto serie a 115200 sin dependencias (termios)."""
    import termios
    fd = os.open(port, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
    try:
        attrs = termios.tcgetattr(fd)
        attrs[0] = 0                                         # iflag
        attrs[1] = 0                                         # oflag
        attrs[2] = termios.CS8 | termios.CREAD | termios.CLOCAL
        attrs[3] = 0                                         # lflag
        attrs[4] = attrs[5] = termios.B115200
        termios.tcsetattr(fd, termios.TCSANOW, attrs)
        if reset:
            reset_board(fd)
        buf, end = b"", time.time() + seconds
        while time.time() < end:
            r, _, _ = select.select([fd], [], [], 0.5)
            if r:
                try:
                    buf += os.read(fd, 4096)
                except BlockingIOError:
                    pass
            if b"[HTTP] OK 200" in buf or b"Respuesta: 200" in buf:
                time.sleep(1)
                break
        return buf.decode("utf-8", "replace")
    finally:
        os.close(fd)


def classify(text, expected_hospital=None, expected_unit=None):
    res = {"resultado": "sin_datos", "avisos": []}
    if "[HTTP] OK 200" in text or re.search(r"Respuesta: 200 .*\"ok\": ?true", text):
        res["resultado"] = "ok"
    elif "No autorizado" in text:
        res["resultado"] = "no_autorizado"
    elif "[WiFi] ERROR" in text or "No se pudo conectar" in text or "Abriendo portal" in text:
        res["resultado"] = "sin_wifi"
    elif re.search(r"\[PLC\](\[ERROR\]| ERROR)", text):
        res["resultado"] = "sin_plc"
    m = re.search(r"\[EQUIPO\] Hospital (\S+) · unidad (\S+)", text)
    if m:
        res["hospital_id"], res["unit_id"] = m.group(1), m.group(2)
        if expected_hospital and m.group(1) != expected_hospital:
            res["avisos"].append(f"el equipo envía con hospital {m.group(1)}, se esperaba {expected_hospital}")
        if expected_unit and m.group(2) != expected_unit:
            res["avisos"].append(f"el equipo es {m.group(2)}, se esperaba {expected_unit}")
    mac = re.search(r"MAC ETH ([0-9A-F:]{17})", text)
    if mac:
        res["mac_eth"] = mac.group(1)
    if re.search(r"\[PLC\](\[ERROR\]| ERROR)", text) and res["resultado"] == "ok":
        res["avisos"].append("hubo errores de lectura del PLC")
    if "uso valor simulado" in text:
        res["avisos"].append("el firmware de sensores está enviando VALORES SIMULADOS por fallo de lectura")
    return res


def cmd_verificar(args):
    entry = inventory_by_folder(args.carpeta) if args.carpeta else None
    if args.log:
        text = open(args.log, encoding="utf-8", errors="replace").read()
    else:
        port = pick_port(args.puerto)
        print(f"Leyendo {port} durante hasta {args.segundos} s…", flush=True)
        text = read_serial(port, args.segundos, reset=not args.sin_reiniciar)
    res = classify(text, entry and entry["hospital_id"], entry and entry["unit_id"])
    lines = [l for l in text.splitlines() if re.search(r"\[(EQUIPO|ETH|WiFi|PLC|HTTP)\]|Respuesta:|ERROR|AVISO", l)]
    print("\n".join(lines[-25:]))
    print("RESULTADO: " + json.dumps(res, ensure_ascii=False))
    if entry:
        upd = {**entry, "verificado": now_iso(), "ultimo_resultado": res["resultado"],
               "estado": ("en_linea" if not res["avisos"] else "en_linea_con_avisos")
                         if res["resultado"] == "ok" else "con_problemas"}
        if res.get("mac_eth"):
            upd["mac_eth"] = res["mac_eth"]
        upsert(upd)
    sys.exit(0 if res["resultado"] == "ok" and not res["avisos"] else 3)


def cmd_inventario(args):
    items = [e for e in load_inventory() if not args.hospital_id or e["hospital_id"] == args.hospital_id]
    if args.json:
        print(json.dumps(items, ensure_ascii=False))
        return
    if not items:
        print("Inventario vacío.")
        return
    for e in sorted(items, key=lambda x: (x.get("hospital_nombre", ""), x["unit_id"])):
        print(f"- {e.get('hospital_nombre', '?')} · {e['unit_id']} ({e.get('unit_type') or 'todos'}) · "
              f"{e.get('marca', '?')} · {e.get('firmware')} · {e.get('estado')} · {e.get('carpeta')}")


# ── hospitales (backend) ───────────────────────────────────────────────────

# Mismo criterio que check_hospitals / create_hospital del MCP (mcp-server/index.js)
SIM_GENERIC = GENERIC_WORDS | {"hospitales", "e", "en", "boge", "plantas", "oxigeno", "o2",
                               "unidad", "salud", "servicio"}
SIM_ABBR = {"mcal": "mariscal", "gral": "general", "dr": "doctor", "dra": "doctora", "sta": "santa",
            "sto": "santo", "hosp": "hospital", "reg": "regional", "pdte": "presidente",
            "cnel": "coronel", "tte": "teniente", "nac": "nacional", "inst": "instituto"}
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)


def norm_name(text):
    t = unicodedata.normalize("NFD", str(text or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", t).strip()


def name_tokens(name):
    words = re.split(r"[^a-z0-9]+", norm_name(name))
    return {SIM_ABBR.get(w, w) for w in words if len(w) > 1 and SIM_ABBR.get(w, w) not in SIM_GENERIC}


def similar(a, b):
    ta, tb = name_tokens(a.get("nombre")), name_tokens(b.get("nombre"))
    if not ta or not tb:
        return norm_name(a.get("nombre")) == norm_name(b.get("nombre")) and \
            norm_name(a.get("ciudad")) == norm_name(b.get("ciudad"))
    small, big = (ta, tb) if len(ta) <= len(tb) else (tb, ta)
    return small <= big


def api_url():
    url = read_env(os.path.join(CONFIG_DIR, "global.env")).get("API_URL")
    if not url:
        fail("falta API_URL: guarda la configuración global")
    return url


def api_get(action):
    try:
        with urllib.request.urlopen(f"{api_url()}?action={action}", timeout=30) as r:
            data = json.load(r)
    except Exception as e:
        fail(f"no se pudo consultar el backend: {e}")
    if not data.get("ok", True):
        fail(data.get("error", "error del backend"))
    return data


def api_post(body):
    token = read_env(os.path.join(CONFIG_DIR, "global.env")).get("ADMIN_TOKEN")
    if not token:
        fail("falta ADMIN_TOKEN: guárdalo en la configuración para crear o editar hospitales")
    req = urllib.request.Request(api_url(), data=json.dumps({"token": token, **body}).encode(),
                                 headers={"Content-Type": "text/plain;charset=utf-8"}, method="POST")
    try:
        # Apps Script responde 302; urllib lo sigue como GET hasta la respuesta real
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.load(r)
    except Exception as e:
        fail(f"no se pudo enviar al backend: {e}")
    if not data.get("ok"):
        fail(data.get("error", "error del backend"))
    return data


def is_online(ts, now_ms):
    if not ts:
        return False
    try:
        t = datetime.datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp() * 1000
    except ValueError:
        return False
    return abs(now_ms - t) < 60000


def list_hospitals():
    hospitals = api_get("hospitals").get("hospitals", [])
    latest = api_get("latest_all")
    now_ms = datetime.datetime.fromisoformat(latest["now"].replace("Z", "+00:00")).timestamp() * 1000 \
        if latest.get("now") else time.time() * 1000
    by_id = {r.get("hospital_id"): r for r in latest.get("rows", [])}
    inv = load_inventory()
    out = []
    for h in hospitals:
        row = by_id.get(h["id"]) or {}
        units = [{"unit_id": u.get("unit_id"), "unit_type": u.get("unit_type"), "ultimo": u.get("timestamp"),
                  "en_linea": is_online(u.get("timestamp"), now_ms)} for u in row.get("units", [])]
        out.append({**{k: h.get(k) for k in ("id", "nombre", "ciudad", "direccion", "activo", "lat", "lon",
                                           "equipment", "thresholds", "created_at")},
                    "ultimo": row.get("timestamp"), "en_linea": is_online(row.get("timestamp"), now_ms),
                    "unidades": units,
                    "equipos_inventario": sum(1 for e in inv if e["hospital_id"] == h["id"]),
                    "wifi_guardado": os.path.exists(os.path.join(CONFIG_DIR, "wifi", f"{h['id']}.env"))})
    return out


def cmd_hosp_listar(args):
    items = list_hospitals()
    if args.json:
        print(json.dumps(items, ensure_ascii=False))
        return
    for h in items:
        print(f"- {h['nombre']} ({h.get('ciudad') or 'sin ciudad'}) · {h['id']} · "
              f"{'EN LÍNEA' if h['en_linea'] else 'sin señal'} · {len(h['unidades'])} equipo(s)")


def duplicate_groups(hospitals):
    parent = list(range(len(hospitals)))

    def root(i):
        while parent[i] != i:
            i = parent[i]
        return i
    for i in range(len(hospitals)):
        for j in range(i + 1, len(hospitals)):
            if similar(hospitals[i], hospitals[j]):
                parent[root(j)] = root(i)
    groups = {}
    for i, h in enumerate(hospitals):
        groups.setdefault(root(i), []).append(h)
    return [g for g in groups.values() if len(g) > 1]


def cmd_hosp_duplicados(args):
    items = list_hospitals()
    groups = duplicate_groups(items)
    bad = [h for h in items if not UUID_RE.match(str(h["id"]).strip())]
    if args.json:
        print(json.dumps({"grupos": groups, "ids_dudosos": bad}, ensure_ascii=False))
        return
    print(f"Grupos de posibles duplicados: {len(groups)}")
    for g in groups:
        print("- " + " | ".join(f"{h['nombre']} ({h['id']})" for h in g))
    for h in bad:
        print(f"ID sin formato UUID: {h['nombre']} → {h['id']}")


def cmd_hosp_crear(args):
    existing = api_get("hospitals").get("hospitals", [])
    cand = {"nombre": args.nombre, "ciudad": args.ciudad or ""}
    hid = (args.id or "").strip()
    for h in existing:
        if hid and str(h["id"]).strip() == hid:
            fail(f"ya existe un hospital con ese id: {h['nombre']}")
        if norm_name(h["nombre"]) == norm_name(args.nombre) and norm_name(h.get("ciudad")) == norm_name(args.ciudad):
            fail(f"ya existe: {h['nombre']} ({h.get('ciudad')}), id {h['id']}")
    parecidos = [h for h in existing if similar(h, cand)]
    if parecidos and not args.confirmar_distinto:
        fail("hay hospitales con nombre parecido (¿es el mismo?): " +
             "; ".join(f"{h['nombre']} ({h.get('ciudad') or 'sin ciudad'}), id {h['id']}" for h in parecidos) +
             ". Si es otro hospital, repite con --confirmar-distinto.")
    if (args.lat is None) != (args.lon is None):
        fail("indica latitud y longitud juntas")
    body = {"action": "add_hospital", "nombre": args.nombre.strip(), "ciudad": (args.ciudad or "").strip(),
            "direccion": (args.direccion or "").strip(), "activo": True,
            "thresholds": {"o2_purity_warn": args.pureza_alerta, "o2_purity_critical": args.pureza_critica},
            "equipment": {"psa_enabled": args.psa, "compressor_enabled": args.compresor,
                          "vacuum_enabled": args.vacio}}
    if hid:
        body["id"] = hid
    if args.lat is not None:
        body["lat"], body["lon"] = args.lat, args.lon
    res = api_post(body)
    out = {"id": res.get("id"), "nombre": body["nombre"], "id_generado": not hid}
    if args.json:
        print(json.dumps(out, ensure_ascii=False))
    else:
        print(f"Hospital creado: {body['nombre']} · id {res.get('id')}")
        if not hid:
            print("Carga este id en SIGGAM como sensorMspbsId del hospital.")


def cmd_hosp_equipos(args):
    h = next((x for x in api_get("hospitals").get("hospitals", []) if str(x["id"]).strip() == args.id), None)
    if not h:
        fail(f"no se encontró el hospital {args.id}")
    eq = {"psa_enabled": True, "compressor_enabled": True, "vacuum_enabled": True, **(h.get("equipment") or {})}
    for key, val in (("psa_enabled", args.psa), ("compressor_enabled", args.compresor), ("vacuum_enabled", args.vacio)):
        if val is not None:
            eq[key] = val
    api_post({"action": "update_hospital", "id": h["id"], "equipment": eq})
    print(f"Equipos de {h['nombre']}: PSA {'sí' if eq['psa_enabled'] else 'no'}, "
          f"compresor {'sí' if eq['compressor_enabled'] else 'no'}, vacío {'sí' if eq['vacuum_enabled'] else 'no'}")


def cmd_firmware_mpy(args):
    if not os.path.isfile(args.desde) or not args.desde.endswith(".bin"):
        fail("indica el archivo .bin de MicroPython (ESP32_GENERIC) descargado de micropython.org")
    dest_dir = os.path.join(CONFIG_DIR, "micropython")
    os.makedirs(dest_dir, exist_ok=True)
    for old in glob.glob(os.path.join(dest_dir, "*.bin")):
        os.remove(old)
    shutil.copyfile(args.desde, os.path.join(dest_dir, os.path.basename(args.desde)))
    print(f"Firmware MicroPython guardado: {os.path.basename(args.desde)}")


# ── CLI ────────────────────────────────────────────────────────────────────

def main():
    p = argparse.ArgumentParser(description="Alta y programación de ESP32 (monitor de gases medicinales)")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("check", help="verificar (e instalar) herramientas y puertos")
    s.add_argument("--install", action="store_true")
    s.add_argument("--sensores", action="store_true", help="incluir esptool y mpremote")
    s.add_argument("--json", action="store_true")
    s.set_defaults(fn=cmd_check)

    s = sub.add_parser("config-global", help="guardar API_URL, DEVICE_TOKEN y ADMIN_TOKEN (tokens ocultos)")
    s.add_argument("--api-url")
    s.add_argument("--device-token", action="store_true", help="pedir (o leer por stdin) el DEVICE_TOKEN")
    s.add_argument("--admin-token", action="store_true", help="pedir (o leer por stdin) el ADMIN_TOKEN")
    s.set_defaults(fn=cmd_config_global)

    s = sub.add_parser("wifi", help="guardar el WiFi de un hospital (la contraseña se pide oculta)")
    s.add_argument("--hospital-id", required=True)
    s.add_argument("--ssid")
    s.set_defaults(fn=cmd_wifi)

    s = sub.add_parser("importar", help="importar configuración de un secrets.h que ya funciona")
    s.add_argument("--desde", required=True)
    s.add_argument("--hospital-id", help="hospital al que pertenece el WiFi de ese secrets.h")
    s.set_defaults(fn=cmd_importar)

    s = sub.add_parser("estado", help="mostrar la configuración guardada (sin secretos)")
    s.add_argument("--json", action="store_true")
    s.set_defaults(fn=cmd_estado)

    s = sub.add_parser("siguiente-unidad", help="próximo UNIT_ID libre de un tipo en un hospital")
    s.add_argument("--hospital-id", required=True)
    s.add_argument("--tipo", required=True, choices=list(UNIT_PREFIX))
    s.set_defaults(fn=cmd_siguiente)

    for name, fn, help_ in (("generar-plc", cmd_generar_plc, "carpeta de una pasarela PLC (Arduino + ENC28J60)"),
                            ("generar-sensores", cmd_generar_sensores, "carpeta de un equipo de sensores (MicroPython)")):
        s = sub.add_parser(name, help=help_)
        s.add_argument("--hospital-id", required=True)
        s.add_argument("--hospital-nombre", required=True)
        s.add_argument("--unidad", required=True, help="UNIT_ID, p. ej. O2-2")
        s.add_argument("--marca", required=True, help="marca de la planta, p. ej. BOGE")
        s.add_argument("--eth-ip", type=int, default=50 if name == "generar-plc" else 20,
                       help="último número de la IP del ESP32 en la red del PLC")
        s.add_argument("--carpeta", help="nombre de la carpeta (por defecto <hospital>_<unidad>)")
        s.add_argument("--salida", help="directorio donde crear la carpeta")
        s.add_argument("--reemplazar", action="store_true")
        if name == "generar-plc":
            s.add_argument("--tipo", default="o2", choices=["o2"])
            s.add_argument("--plc-ip", type=int, default=10, help="último número de la IP del PLC")
        else:
            s.add_argument("--tipo", default="", choices=["", "o2", "air", "vacuum"],
                           help="vacío = mide todos los tipos de la planta")
            s.add_argument("--leer-plc", action="store_true", help="también leer PLC BOGE (requiere W5500)")
        s.set_defaults(fn=fn)

    s = sub.add_parser("subir", help="compilar y subir la carpeta de un equipo al ESP32 conectado")
    s.add_argument("--carpeta", required=True)
    s.add_argument("--puerto")
    s.add_argument("--firmware", help="(sensores) .bin de MicroPython")
    s.add_argument("--solo-archivos", action="store_true", help="(sensores) no reinstalar MicroPython")
    s.set_defaults(fn=cmd_subir)

    s = sub.add_parser("actualizar", help="copiar el firmware actual del repo a la carpeta de un equipo")
    s.add_argument("--carpeta", required=True)
    s.set_defaults(fn=cmd_actualizar)

    s = sub.add_parser("verificar", help="leer el monitor serie y comprobar que envía datos")
    s.add_argument("--puerto")
    s.add_argument("--carpeta", help="carpeta del equipo (para comparar y actualizar el inventario)")
    s.add_argument("--segundos", type=int, default=90)
    s.add_argument("--log", help="analizar un archivo con la salida serie en lugar del puerto")
    s.add_argument("--sin-reiniciar", action="store_true", help="no reiniciar el ESP32 al empezar")
    s.set_defaults(fn=cmd_verificar)

    s = sub.add_parser("inventario", help="listar los equipos generados")
    s.add_argument("--hospital-id")
    s.add_argument("--json", action="store_true")
    s.set_defaults(fn=cmd_inventario)

    s = sub.add_parser("hospitales", help="consultar, crear y configurar hospitales en el backend")
    hs = s.add_subparsers(dest="hcmd", required=True)
    h = hs.add_parser("listar", help="hospitales con su estado y equipos")
    h.add_argument("--json", action="store_true")
    h.set_defaults(fn=cmd_hosp_listar)
    h = hs.add_parser("duplicados", help="posibles duplicados e IDs dudosos")
    h.add_argument("--json", action="store_true")
    h.set_defaults(fn=cmd_hosp_duplicados)
    h = hs.add_parser("crear", help="crear un hospital (requiere ADMIN_TOKEN)")
    h.add_argument("--nombre", required=True)
    h.add_argument("--ciudad", default="")
    h.add_argument("--direccion", default="")
    h.add_argument("--id", help="sensorMspbsId de SIGGAM si ya existe; si no, lo genera el backend")
    h.add_argument("--lat", type=float)
    h.add_argument("--lon", type=float)
    h.add_argument("--psa", action=argparse.BooleanOptionalAction, default=True)
    h.add_argument("--compresor", action=argparse.BooleanOptionalAction, default=False)
    h.add_argument("--vacio", action=argparse.BooleanOptionalAction, default=False)
    h.add_argument("--pureza-alerta", type=float, default=93)
    h.add_argument("--pureza-critica", type=float, default=90)
    h.add_argument("--confirmar-distinto", action="store_true")
    h.add_argument("--json", action="store_true")
    h.set_defaults(fn=cmd_hosp_crear)
    h = hs.add_parser("equipos", help="activar/desactivar PSA, compresor y vacío (requiere ADMIN_TOKEN)")
    h.add_argument("--id", required=True)
    h.add_argument("--psa", action=argparse.BooleanOptionalAction, default=None)
    h.add_argument("--compresor", action=argparse.BooleanOptionalAction, default=None)
    h.add_argument("--vacio", action=argparse.BooleanOptionalAction, default=None)
    h.set_defaults(fn=cmd_hosp_equipos)

    s = sub.add_parser("firmware-mpy", help="guardar el .bin de MicroPython para equipos de sensores")
    s.add_argument("--desde", required=True)
    s.set_defaults(fn=cmd_firmware_mpy)

    args = p.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
