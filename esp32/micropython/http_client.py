"""Cliente HTTPS minimo (sin dependencias externas) para postear a Apps Script.

Los Web Apps de Google Apps Script responden a un POST con un redirect
301/302 hacia script.googleusercontent.com. Seguir ese redirect
reenviando el mismo POST devuelve "400 Bad Request" (asi lo confirma el
firmware Arduino original de este proyecto) - hay que seguirlo con GET.

Nota de seguridad: MicroPython en ESP32 no valida el certificado del
servidor por defecto (no trae el paquete de CAs). El contenido viaja
cifrado igual, pero no se verifica la identidad del servidor. Es la
limitacion tipica de los microcontroladores; aceptable para telemetria
no critica, pero vale saberlo.
"""

import gc
import socket
import ssl

_REDIRECT_CODES = (301, 302, 303, 307, 308)


def _parse_url(url):
    assert url.startswith("https://"), "solo se soporta https"
    rest = url[len("https://"):]
    if "/" in rest:
        host, path = rest.split("/", 1)
        path = "/" + path
    else:
        host, path = rest, "/"
    return host, path


def _raw_request(host, path, method, body=None):
    # Cada handshake TLS reserva un bloque grande de memoria. Si el socket no
    # se cierra SIEMPRE (incluso cuando algo falla a mitad de camino), ese
    # bloque queda huerfano y la placa termina colgandose despues de unos
    # ciclos. De ahi el try/finally y el gc.collect() previo.
    gc.collect()
    addr = socket.getaddrinfo(host, 443)[0][-1]
    sock = None
    try:
        sock = socket.socket()
        sock.settimeout(20)
        sock.connect(addr)
        sock = ssl.wrap_socket(sock, server_hostname=host)

        if body is not None:
            req = (
                "{method} {path} HTTP/1.1\r\n"
                "Host: {host}\r\n"
                "Content-Type: text/plain;charset=utf-8\r\n"
                "Content-Length: {length}\r\n"
                "Connection: close\r\n\r\n"
                "{body}"
            ).format(method=method, path=path, host=host, length=len(body), body=body)
        else:
            req = (
                "{method} {path} HTTP/1.1\r\n"
                "Host: {host}\r\n"
                "Connection: close\r\n\r\n"
            ).format(method=method, path=path, host=host)
        sock.write(req.encode())

        # acumular en lista y unir una sola vez: concatenar bytes en cada
        # vuelta fragmenta el heap innecesariamente
        trozos = []
        while True:
            chunk = sock.read(512)
            if not chunk:
                break
            trozos.append(chunk)
        response = b"".join(trozos)
    finally:
        if sock is not None:
            try:
                sock.close()
            except Exception:
                pass
        gc.collect()

    header, _, payload = response.partition(b"\r\n\r\n")
    status_line = header.split(b"\r\n")[0].decode()
    status_code = int(status_line.split(" ")[1])

    location = None
    for line in header.split(b"\r\n"):
        if line.lower().startswith(b"location:"):
            location = line.split(b":", 1)[1].strip().decode()
    return status_code, location, payload


def post_json(url, body):
    """Envia el POST y NO sigue el redirect.

    Comprobado empiricamente: Apps Script ejecuta doPost y guarda la fila
    ANTES de responder el 302; el redirect solo sirve para entregar el texto
    de la respuesta. Al no seguirlo ahorramos un handshake TLS completo por
    ciclo -- que es justo lo que fragmenta la memoria del ESP32 y terminaba
    colgando la placa. Un 302 aca significa "guardado con exito".
    """
    host, path = _parse_url(url)
    status, location, payload = _raw_request(host, path, "POST", body=body)
    if status in _REDIRECT_CODES:
        return status, b"(302: guardado, redirect no seguido a proposito)"
    return status, payload
