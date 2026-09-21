# Firmware MicroPython — Monitor de Planta

Firmware vigente del ESP32. Reemplaza a `../plant_monitor.ino` (que era un
simulador con credenciales hardcodeadas y quedó solo como referencia).

## Diferencias con el firmware Arduino anterior

- **Sin credenciales en el código.** WiFi, `hospital_id`, URL del Apps Script
  y token del dispositivo se cargan desde un portal web propio y quedan solo
  en la memoria de la placa (`/config.json`), nunca en este repositorio.
- **Fuente de datos configurable** (`data_source` en `config.py` o desde el
  portal web): `"plc"` (por defecto, lee el PLC BOGE por Modbus TCP) o
  `"sensors"` (legacy: 9 canales 4-20mA vía 3x ADS1115 + 4 entradas
  digitales aisladas, con valores simulados como respaldo si el hardware no
  está conectado).
- **Manda el token** que el backend ahora exige para `action=data`.

## Fuente de datos: PLC BOGE (Siemens S7-1200) por Modbus TCP

En vez de leer sensores 4-20mA directo, el ESP32 puede leer todos los datos
de planta desde el PLC BOGE que ya los tiene disponibles, y reenviarlos al
mismo backend. Datos de conexión (ver `config.py`, sección `plc_*`):

| Parámetro   | Valor                |
|-------------|-----------------------|
| PLC         | BOGE, Siemens S7-1200 CPU 1214C |
| IP          | `100.100.200.10` (`/24`) |
| Protocolo   | Modbus TCP            |
| Puerto      | `501`                 |
| Unit ID     | `1`                   |
| Registros   | Holding registers `40001–40041` (41 registros) |

### Garantía de solo lectura

`modbus_tcp.py` implementa **únicamente** la función Modbus 0x03 (Read
Holding Registers). No existe en el código ninguna función de escritura
(Write Single/Multiple Register, Write Coil, etc.) — es imposible que este
firmware le envíe un comando al PLC, solo puede leer. Cumple la regla de
seguridad: **sin inicio, parada, reinicios ni escrituras al PLC.**

### ⚠️ Mapa de registros: hipótesis a confirmar

La tabla `plc_registers` en `config.py` que asocia cada registro con un
campo (`o2_flow_m3h`, `tower_a_pressure_bar`, etc.) es una **hipótesis de
trabajo**, no está confirmada contra la documentación real del programa
BOGE/TIA Portal. Antes de confiar en los valores:

1. Dejar `"plc_debug_dump": True` en la config (viene así por defecto).
2. Correr el firmware y mirar el log Serial — imprime los 41 registros
   crudos en cada ciclo: `[PLC] registros crudos 40001-40041: [...]`.
3. Comparar esos valores contra lo que muestra el HMI/tablero del PLC en
   ese mismo momento (ej. si el HMI dice "Pureza O2: 95.1%", buscar qué
   registro trae 9510 o 951 y ajustar `offset`/`scale` en consecuencia).
4. Ajustar `plc_registers` en `config.py` (offset, scale, signed, words)
   hasta que los valores calculados coincidan con el HMI.
5. Una vez confirmado, se puede poner `"plc_debug_dump": False` para no
   ensuciar el log.

`words: 2` es para valores de 32 bits repartidos en dos registros
consecutivos (ej. `compressor_hours`, si el PLC lo entrega como entero
largo). `signed: True` interpreta el registro como complemento a 2 (para
valores negativos como puntos de rocío o nivel de vacío).

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
