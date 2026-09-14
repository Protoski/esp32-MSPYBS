"""Conexion WiFi y portal cautivo de configuracion.

Si no hay WiFi guardado (o falla la conexion), la placa levanta su propio
punto de acceso "PlantaO2-Config" con una pagina web para cargar todos
los parametros sin reflashear nunca.
"""

import network
import socket
import time
import config as cfgmod

AP_SSID = "PlantaO2-Config"
AP_PASSWORD = "planta1234"  # minimo 8 caracteres, WPA2


def is_connected():
    return network.WLAN(network.STA_IF).isconnected()


def connect_sta(cfg, timeout_s=15):
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)
    if wlan.isconnected():
        return True
    wlan.connect(cfg["wifi_ssid"], cfg["wifi_pass"])
    deadline = time.time() + timeout_s
    while not wlan.isconnected() and time.time() < deadline:
        time.sleep_ms(300)
    return wlan.isconnected()


def _urldecode(s):
    s = s.replace("+", " ")
    out = ""
    i = 0
    while i < len(s):
        if s[i] == "%" and i + 2 < len(s):
            out += chr(int(s[i + 1:i + 3], 16))
            i += 3
        else:
            out += s[i]
            i += 1
    return out


def _parse_form(body):
    fields = {}
    for pair in body.split("&"):
        if "=" not in pair:
            continue
        k, v = pair.split("=", 1)
        fields[_urldecode(k)] = _urldecode(v)
    return fields


def _render_form(cfg):
    analog_rows = ""
    for name, s in cfg["analog"].items():
        analog_rows += (
            "<tr><td>{n}</td>"
            "<td><input name='min__{n}' value='{mn}' size='6'></td>"
            "<td><input name='max__{n}' value='{mx}' size='6'></td></tr>"
        ).format(n=name, mn=s["min"], mx=s["max"])

    return """<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Config Planta O2</title>
<style>body{{font-family:sans-serif;max-width:480px;margin:20px auto;padding:0 12px}}
input{{width:100%;padding:6px;margin:4px 0 12px;box-sizing:border-box}}
table{{width:100%;border-collapse:collapse}}
td{{padding:4px;border-bottom:1px solid #ddd}}
button{{width:100%;padding:12px;background:#1a73e8;color:#fff;border:0;border-radius:4px;font-size:16px}}
</style></head><body>
<h2>Configuracion - Monitor Planta O2</h2>
<form method="POST" action="/guardar">
<label>Red WiFi (SSID)</label><input name="wifi_ssid" value="{ssid}">
<label>Contrasena WiFi</label><input name="wifi_pass" type="password" value="{wpass}">
<label>ID de hospital</label><input name="hospital_id" value="{hid}">
<label>URL del Google Apps Script</label><input name="sheet_url" value="{url}">
<label>Token del dispositivo</label><input name="device_token" value="{token}">
<label>Intervalo de envio (segundos)</label><input name="send_interval_s" value="{interval}">
<h3>Rango de cada sensor (valor a 4mA / a 20mA)</h3>
<table><tr><th>Sensor</th><th>4mA</th><th>20mA</th></tr>{rows}</table>
<button type="submit">Guardar y reiniciar</button>
</form></body></html>""".format(
        ssid=cfg["wifi_ssid"], wpass=cfg["wifi_pass"], hid=cfg["hospital_id"],
        url=cfg["sheet_url"], token=cfg.get("device_token", ""),
        interval=cfg["send_interval_s"], rows=analog_rows,
    )


def start_ap_and_serve(cfg):
    ap = network.WLAN(network.AP_IF)
    ap.active(True)
    ap.config(essid=AP_SSID, password=AP_PASSWORD, authmode=network.AUTH_WPA2_PSK)
    print("Portal de configuracion activo.")
    print("Conectate a la red WiFi '%s' (clave: %s)" % (AP_SSID, AP_PASSWORD))
    print("y abri http://%s en el navegador." % ap.ifconfig()[0])

    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind(("0.0.0.0", 80))
    s.listen(2)

    while True:
        conn, addr = s.accept()
        try:
            request = conn.recv(2048).decode()
            first_line = request.split("\r\n", 1)[0]

            if first_line.startswith("POST /guardar"):
                body = request.split("\r\n\r\n", 1)[1] if "\r\n\r\n" in request else ""
                fields = _parse_form(body)
                cfg["wifi_ssid"] = fields.get("wifi_ssid", cfg["wifi_ssid"])
                cfg["wifi_pass"] = fields.get("wifi_pass", cfg["wifi_pass"])
                cfg["hospital_id"] = fields.get("hospital_id", cfg["hospital_id"])
                cfg["sheet_url"] = fields.get("sheet_url", cfg["sheet_url"])
                cfg["device_token"] = fields.get("device_token", cfg.get("device_token", ""))
                try:
                    cfg["send_interval_s"] = int(fields.get("send_interval_s", cfg["send_interval_s"]))
                except ValueError:
                    pass
                for name in cfg["analog"]:
                    mn = fields.get("min__" + name)
                    mx = fields.get("max__" + name)
                    if mn is not None:
                        cfg["analog"][name]["min"] = float(mn)
                    if mx is not None:
                        cfg["analog"][name]["max"] = float(mx)
                cfgmod.save(cfg)
                conn.send("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n"
                          "<h2>Guardado. Reiniciando la placa...</h2>")
                conn.close()
                time.sleep(1)
                import machine
                machine.reset()

            else:
                html = _render_form(cfg)
                conn.send("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n" + html)
                conn.close()
        except Exception as e:
            print("Error en el portal:", e)
            conn.close()
