#!/usr/bin/env python3
"""Interfaz gráfica (web local) para equipos.py.

Uso:  python3 tools/equipos/equipos_gui.py        (abre el navegador)
      python3 tools/equipos/equipos_gui.py --no-browser --port 8765

Solo escucha en 127.0.0.1. Cada arranque genera un token que exige toda llamada a
la API y se rechazan peticiones con otro Host u Origin, para que ninguna página web
externa pueda usarla. Toda la lógica la hace equipos.py (subprocesos); los secretos
se le pasan por stdin y nunca vuelven al navegador.
"""

import argparse
import json
import os
import secrets
import subprocess
import sys
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
EQUIPOS = os.path.join(HERE, "equipos.py")
GUI_DIR = os.path.join(HERE, "gui")
sys.path.insert(0, HERE)
import equipos  # noqa: E402  (serial_ports, CONFIG_DIR, inventario)

TOKEN = secrets.token_urlsafe(24)
STATIC = {"/": ("index.html", "text/html; charset=utf-8"),
          "/app.js": ("app.js", "application/javascript; charset=utf-8"),
          "/style.css": ("style.css", "text/css; charset=utf-8"),
          "/logo-mspbs.jpg": (os.path.join("..", "..", "..", "frontend", "public", "logo-mspbs.jpg"), "image/jpeg")}

JOBS = {}
JOBS_LOCK = threading.Lock()
BUSY = threading.Lock()   # un solo trabajo a la vez (USB)


# ── ejecución de equipos.py ────────────────────────────────────────────────

def run_equipos(args, stdin_lines=None, timeout=120):
    """Ejecuta equipos.py y devuelve (código, stdout, stderr)."""
    inp = "".join(f"{l}\n" for l in stdin_lines) if stdin_lines else ""
    r = subprocess.run([sys.executable, EQUIPOS] + args, input=inp, capture_output=True,
                       text=True, timeout=timeout, cwd=os.path.dirname(os.path.dirname(HERE)))
    return r.returncode, r.stdout, r.stderr


def result(code, out, err, parse_json=False):
    if code != 0 and not (parse_json and out.strip().startswith(("{", "["))):
        msg = (err.strip().splitlines() or out.strip().splitlines() or ["error"])[-1]
        return {"ok": False, "error": msg.replace("ERROR: ", "")}
    if parse_json:
        try:
            return {"ok": True, "data": json.loads(out.strip().splitlines()[-1])}
        except (ValueError, IndexError):
            return {"ok": False, "error": "respuesta inesperada de equipos.py"}
    return {"ok": True, "salida": out.strip()}


def start_job(title, args, stdin_lines=None):
    if not BUSY.acquire(blocking=False):
        return {"ok": False, "error": "ya hay un trabajo en curso; espera a que termine"}
    job_id = secrets.token_hex(4)
    job = {"id": job_id, "titulo": title, "estado": "en_curso", "codigo": None, "lineas": [],
           "inicio": time.strftime("%H:%M:%S")}
    with JOBS_LOCK:
        JOBS[job_id] = job

    def worker():
        try:
            p = subprocess.Popen([sys.executable, "-u", EQUIPOS] + args, stdin=subprocess.PIPE,
                                 stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1,
                                 cwd=os.path.dirname(os.path.dirname(HERE)))
            if stdin_lines:
                p.stdin.write("".join(f"{l}\n" for l in stdin_lines))
            p.stdin.close()
            for line in p.stdout:
                job["lineas"].append(line.rstrip("\n"))
            p.wait()
            job["codigo"] = p.returncode
            job["estado"] = "ok" if p.returncode == 0 else "error"
            last = next((l for l in reversed(job["lineas"]) if l.startswith("RESULTADO: ")), None)
            if last:
                try:
                    job["resultado"] = json.loads(last[len("RESULTADO: "):])
                except ValueError:
                    pass
        except Exception as e:
            job["lineas"].append(f"ERROR: {e}")
            job["estado"] = "error"
        finally:
            BUSY.release()
    threading.Thread(target=worker, daemon=True).start()
    return {"ok": True, "trabajo": job_id}


def s(v, name):
    if not isinstance(v, str) or not v.strip():
        raise ValueError(f"falta {name}")
    return v.strip()


def opt_flag(args, flag, value):
    if value is True:
        args.append(f"--{flag}")
    elif value is False:
        args.append(f"--no-{flag}")


# ── API ────────────────────────────────────────────────────────────────────

def api_get(path, q):
    one = lambda k: (q.get(k) or [None])[0]  # noqa: E731
    if path == "/api/estado":
        return result(*run_equipos(["estado", "--json"]), parse_json=True)
    if path == "/api/check":
        return result(*run_equipos(["check", "--json"], timeout=60), parse_json=True)
    if path == "/api/puertos":
        return {"ok": True, "data": equipos.serial_ports()}
    if path == "/api/hospitales":
        return result(*run_equipos(["hospitales", "listar", "--json"], timeout=60), parse_json=True)
    if path == "/api/duplicados":
        return result(*run_equipos(["hospitales", "duplicados", "--json"], timeout=60), parse_json=True)
    if path == "/api/inventario":
        return result(*run_equipos(["inventario", "--json"]), parse_json=True)
    if path == "/api/siguiente":
        r = result(*run_equipos(["siguiente-unidad", "--hospital-id", s(one("hospital_id"), "hospital"),
                                 "--tipo", s(one("tipo"), "tipo")], timeout=60))
        if r["ok"]:
            r["data"] = r.pop("salida").splitlines()[-1]
        return r
    if path in ("/api/exportar/hospitales", "/api/exportar/inventario"):
        args = ["hospitales", "exportar"] if path.endswith("hospitales") else ["inventario", "--exportar", "csv"]
        code, out, err = run_equipos(args, timeout=60)
        if code != 0:
            return result(code, out, err)
        return {"__csv__": out, "__nombre__": f"{path.rsplit('/', 1)[-1]}_{time.strftime('%Y%m%d')}.csv"}
    if path == "/api/trabajos":
        with JOBS_LOCK:
            return {"ok": True, "data": [{k: j[k] for k in ("id", "titulo", "estado", "inicio")}
                                         for j in JOBS.values()][-20:]}
    if path.startswith("/api/trabajos/"):
        job = JOBS.get(path.rsplit("/", 1)[-1])
        if not job:
            return {"ok": False, "error": "trabajo no encontrado"}
        desde = int(one("desde") or 0)
        return {"ok": True, "data": {**{k: v for k, v in job.items() if k != "lineas"},
                                     "lineas": job["lineas"][desde:], "total": len(job["lineas"])}}
    return None


def api_post(path, b):
    if path == "/api/config":
        args, stdin = ["config-global"], []
        if b.get("api_url"):
            args += ["--api-url", s(b["api_url"], "URL")]
        if b.get("dashboard_url"):
            args += ["--dashboard-url", s(b["dashboard_url"], "URL del dashboard")]
        if b.get("device_token"):
            args.append("--device-token")
            stdin.append(s(b["device_token"], "DEVICE_TOKEN"))
        if b.get("admin_token"):
            args.append("--admin-token")
            stdin.append(s(b["admin_token"], "ADMIN_TOKEN"))
        if len(args) == 1:
            return {"ok": False, "error": "no hay nada que guardar"}
        return result(*run_equipos(args, stdin))
    if path == "/api/wifi":
        return result(*run_equipos(["wifi", "--hospital-id", s(b.get("hospital_id"), "hospital"),
                                    "--ssid", s(b.get("ssid"), "SSID")], [b.get("password") or ""]))
    if path == "/api/importar":
        args = ["importar", "--desde", s(b.get("desde"), "archivo")]
        if b.get("hospital_id"):
            args += ["--hospital-id", b["hospital_id"]]
        return result(*run_equipos(args))
    if path == "/api/firmware-mpy":
        return result(*run_equipos(["firmware-mpy", "--desde", s(b.get("desde"), "archivo")]))
    if path == "/api/hospitales":
        args = ["hospitales", "crear", "--json", "--nombre", s(b.get("nombre"), "nombre"),
                "--ciudad", b.get("ciudad") or "", "--direccion", b.get("direccion") or ""]
        if b.get("id"):
            args += ["--id", s(b["id"], "id")]
        if b.get("lat") not in (None, "") and b.get("lon") not in (None, ""):
            args += ["--lat", str(float(b["lat"])), "--lon", str(float(b["lon"]))]
        for flag, key in (("psa", "psa"), ("compresor", "compresor"), ("vacio", "vacio")):
            opt_flag(args, flag, bool(b.get(key)))
        if b.get("pureza_alerta"):
            args += ["--pureza-alerta", str(float(b["pureza_alerta"]))]
        if b.get("pureza_critica"):
            args += ["--pureza-critica", str(float(b["pureza_critica"]))]
        if b.get("confirmar_distinto"):
            args.append("--confirmar-distinto")
        return result(*run_equipos(args, timeout=60), parse_json=True)
    if path == "/api/hospitales/equipos":
        args = ["hospitales", "equipos", "--id", s(b.get("id"), "id")]
        for flag in ("psa", "compresor", "vacio"):
            opt_flag(args, flag, b.get(flag))
        return result(*run_equipos(args, timeout=60))
    if path == "/api/hospitales/editar":
        args = ["hospitales", "editar", "--id", s(b.get("id"), "id")]
        for key in ("nombre", "ciudad", "direccion"):
            if isinstance(b.get(key), str) and b[key].strip():
                args += [f"--{key}", b[key].strip()]
        if b.get("sin_ubicacion"):
            args.append("--sin-ubicacion")
        elif b.get("lat") not in (None, "") and b.get("lon") not in (None, ""):
            args += ["--lat", str(float(b["lat"])), "--lon", str(float(b["lon"]))]
        if b.get("pureza_alerta") not in (None, ""):
            args += ["--pureza-alerta", str(float(b["pureza_alerta"]))]
        if b.get("pureza_critica") not in (None, ""):
            args += ["--pureza-critica", str(float(b["pureza_critica"]))]
        for flag in ("psa", "compresor", "vacio"):
            opt_flag(args, flag, b.get(flag))
        return result(*run_equipos(args, timeout=60))
    if path == "/api/hospitales/activo":
        cmd = "activar" if b.get("activo") else "desactivar"
        return result(*run_equipos(["hospitales", cmd, "--id", s(b.get("id"), "id")], timeout=60))
    if path == "/api/hospitales/eliminar":
        return result(*run_equipos(["hospitales", "eliminar", "--id", s(b.get("id"), "id"),
                                    "--confirmar", s(b.get("confirmar"), "nombre")], timeout=60))
    if path == "/api/hospitales/fusionar":
        args = ["hospitales", "fusionar", "--json", "--conservar", s(b.get("conservar"), "hospital a conservar"),
                "--duplicado", s(b.get("duplicado"), "duplicado")]
        if isinstance(b.get("nombre"), str) and b["nombre"].strip():
            args += ["--nombre", b["nombre"].strip()]
        if b.get("config_del_duplicado"):
            args.append("--config-del-duplicado")
        if b.get("aplicar"):
            args.append("--aplicar")
        return result(*run_equipos(args, timeout=90), parse_json=True)
    if path == "/api/inventario/eliminar":
        args = ["inventario", "--eliminar", "--hospital-id", s(b.get("hospital_id"), "hospital"),
                "--unidad", s(b.get("unidad"), "unidad")]
        if b.get("borrar_carpeta"):
            args.append("--borrar-carpeta")
        return result(*run_equipos(args))
    if path == "/api/wifi/eliminar":
        return result(*run_equipos(["wifi", "--eliminar", "--hospital-id", s(b.get("hospital_id"), "hospital")]))
    if path == "/api/trabajos":
        return start_trabajo(b)
    if path == "/api/abrir":
        carpeta = os.path.abspath(s(b.get("carpeta"), "carpeta"))
        known = {os.path.abspath(e.get("carpeta", "")) for e in equipos.load_inventory()}
        if carpeta not in known or not os.path.isdir(carpeta):
            return {"ok": False, "error": "carpeta desconocida"}
        opener = "open" if sys.platform == "darwin" else "xdg-open"
        subprocess.Popen([opener, carpeta], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return {"ok": True}
    if path == "/api/acceso-directo":
        return crear_acceso_directo()
    return None


def start_trabajo(b):
    tipo = b.get("tipo")
    p = b.get("params") or {}
    if tipo == "instalar":
        args = ["check", "--install"] + (["--sensores"] if p.get("sensores") else [])
        return start_job("Instalar herramientas", args)
    if tipo in ("generar-plc", "generar-sensores"):
        args = [tipo, "--hospital-id", s(p.get("hospital_id"), "hospital"),
                "--hospital-nombre", s(p.get("hospital_nombre"), "nombre del hospital"),
                "--unidad", s(p.get("unidad"), "UNIT_ID").upper(), "--marca", s(p.get("marca"), "marca")]
        if p.get("eth_ip"):
            args += ["--eth-ip", str(int(p["eth_ip"]))]
        if tipo == "generar-plc" and p.get("plc_ip"):
            args += ["--plc-ip", str(int(p["plc_ip"]))]
        if tipo == "generar-sensores":
            args += ["--tipo", p.get("tipo") or ""]
            if p.get("leer_plc"):
                args.append("--leer-plc")
        if p.get("reemplazar"):
            args.append("--reemplazar")
        return start_job(f"Generar {p.get('unidad')}", args)
    if tipo in ("subir", "verificar", "actualizar"):
        args = [tipo, "--carpeta", s(p.get("carpeta"), "carpeta")]
        if tipo != "actualizar" and p.get("puerto"):
            args += ["--puerto", p["puerto"]]
        if tipo == "subir" and p.get("solo_archivos"):
            args.append("--solo-archivos")
        if tipo == "verificar":
            args += ["--segundos", str(int(p.get("segundos") or 90))]
        return start_job(f"{tipo.capitalize()} {os.path.basename(p['carpeta'])}", args)
    return {"ok": False, "error": "tipo de trabajo desconocido"}


def crear_acceso_directo():
    path = os.path.expanduser("~/.local/share/applications/mspybs-equipos.desktop")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write("[Desktop Entry]\nType=Application\nName=MSPYBS Equipos ESP32\n"
                "Comment=Alta de hospitales y programación de ESP32\n"
                f"Exec={sys.executable} {os.path.abspath(__file__)}\nTerminal=false\n"
                "Categories=Development;Utility;\n")
    return {"ok": True, "salida": f"Acceso directo creado: {path}"}


# ── servidor HTTP ──────────────────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):
    server_version = "MSPYBS-Equipos"

    def log_message(self, fmt, *args):
        pass

    def _allowed(self):
        port = self.server.server_address[1]
        hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
        if self.headers.get("Host") not in hosts:
            return False
        origin = self.headers.get("Origin")
        return origin is None or origin in {f"http://{h}" for h in hosts}

    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        data = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _api(self, fn, arg):
        if self.headers.get("X-Token") != TOKEN:
            return self._send(403, {"ok": False, "error": "token inválido"})
        try:
            res = fn(urlparse(self.path).path, arg)
        except (ValueError, KeyError) as e:
            res = {"ok": False, "error": str(e)}
        except subprocess.TimeoutExpired:
            res = {"ok": False, "error": "tiempo de espera agotado"}
        if res is None:
            return self._send(404, {"ok": False, "error": "no encontrado"})
        if "__csv__" in res:
            data = res["__csv__"].encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/csv; charset=utf-8")
            self.send_header("Content-Disposition", f'attachment; filename="{res["__nombre__"]}"')
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        self._send(200, res)

    def do_GET(self):
        if not self._allowed():
            return self._send(403, {"ok": False, "error": "origen no permitido"})
        u = urlparse(self.path)
        if u.path.startswith("/api/"):
            return self._api(api_get, parse_qs(u.query))
        if u.path in STATIC:
            name, ctype = STATIC[u.path]
            path = os.path.normpath(os.path.join(GUI_DIR, name))
            if not os.path.exists(path):
                return self._send(404, b"", "text/plain")
            data = open(path, "rb").read()
            if name == "index.html":
                data = data.replace(b"__TOKEN__", TOKEN.encode())
            return self._send(200, data, ctype)
        self._send(404, b"no encontrado", "text/plain")

    def do_POST(self):
        if not self._allowed():
            return self._send(403, {"ok": False, "error": "origen no permitido"})
        if not self.path.startswith("/api/"):
            return self._send(404, {"ok": False, "error": "no encontrado"})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n) or b"{}") if n <= 1_000_000 else {}
        except ValueError:
            return self._send(400, {"ok": False, "error": "JSON inválido"})
        self._api(api_post, body if isinstance(body, dict) else {})


def main():
    ap = argparse.ArgumentParser(description="Interfaz gráfica de equipos.py")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--no-browser", action="store_true")
    a = ap.parse_args()
    try:
        srv = ThreadingHTTPServer(("127.0.0.1", a.port), Handler)
    except OSError:
        srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    url = f"http://127.0.0.1:{srv.server_address[1]}/"
    print(f"Interfaz de equipos en {url}  (Ctrl+C para cerrar)", flush=True)
    if not a.no_browser:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
