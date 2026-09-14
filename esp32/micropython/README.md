# Firmware MicroPython — Monitor de Planta

Firmware vigente del ESP32. Reemplaza a `../plant_monitor.ino` (que era un
simulador con credenciales hardcodeadas y quedó solo como referencia).

## Diferencias con el firmware Arduino anterior

- **Sin credenciales en el código.** WiFi, `hospital_id`, URL del Apps Script
  y token del dispositivo se cargan desde un portal web propio y quedan solo
  en la memoria de la placa (`/config.json`), nunca en este repositorio.
- **Lee sensores reales** (9 canales 4-20mA vía 3x ADS1115 + 4 entradas
  digitales aisladas), con valores simulados como respaldo mientras el
  hardware no esté conectado.
- **Manda el token** que el backend ahora exige para `action=data`.

## Instalación

```bash
# 1. Grabar MicroPython (una sola vez)
esptool --port /dev/ttyUSB0 erase-flash
esptool --port /dev/ttyUSB0 --baud 460800 write-flash 0x1000 ESP32_GENERIC-*.bin

# 2. Copiar el firmware
for f in *.py; do mpremote connect /dev/ttyUSB0 fs cp $f :$f; done
```

Al primer arranque (o manteniendo presionado BOOT/GPIO0) la placa levanta un
punto de acceso **`PlantaO2-Config`** (clave `planta1234`); conectándose a él
y abriendo `http://192.168.4.1` se cargan todos los parámetros sin reflashear.

## Decisiones de diseño no obvias

**No se sigue el redirect del Apps Script.** Google responde al POST con un
302 hacia `script.googleusercontent.com`, pero el script **ya ejecutó y
guardó la fila** antes de emitirlo — verificado empíricamente. Seguir ese
redirect implicaba un segundo handshake TLS por ciclo, que era justo lo que
fragmentaba el heap hasta colgar la placa. **Un 302 aquí significa éxito.**

**Recuperación automática.** MicroPython no compacta el heap, así que una vez
fragmentado mbedTLS no consigue su bloque contiguo y no se recupera solo. Por
eso: `try/finally` que cierra el socket siempre, `gc.collect()` en cada ciclo,
reinicio tras 3 fallos seguidos, y un watchdog de 2 minutos por si algo se
cuelga de forma imprevista. El equipo tiene que poder recuperarse solo sin que
nadie viaje al hospital.

**Las entradas digitales usan lógica invertida.** El optoacoplador conduce
cuando el contacto de 24V está activo, tirando el GPIO a masa contra el
pull-up. Por eso `invert` en la configuración de cada señal digital.
