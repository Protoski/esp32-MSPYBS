# Firmware MicroPython — Monitor de Planta

Firmware vigente del ESP32. Reemplaza a `../plant_monitor.ino` (que era un
simulador con credenciales hardcodeadas y quedó solo como referencia).

## Arquitectura de datos

Dos fuentes de datos activas **al mismo tiempo**, sin que una reemplace a
la otra:

1. **Sensores locales** — 9 transmisores 4-20mA (vía 3x ADS1115) + 4
   contactos digitales aislados. Lectura no invasiva, siempre activa.
2. **PLC BOGE** (Siemens S7-1200 CPU 1214C) por **Modbus TCP, solo
   lectura**, a través de una interfaz **Ethernet dedicada** (módulo
   W5500), completamente separada de la WiFi. Se puede apagar con
   `"read_plc": false` en la config, quedando solo el modo sensores.

Ambas fuentes se combinan en un único JSON y se envían al mismo backend
(Google Apps Script) con el mecanismo HTTP que ya existía — no se agregó
ningún transporte nuevo (ni MQTT, ni tópicos, ni URLs inventadas).

- **Sin credenciales en el código.** WiFi, `hospital_id`, URL del Apps
  Script y token del dispositivo se cargan desde un portal web propio y
  quedan solo en la memoria de la placa (`/config.json`).

## Topología de red

```
[Internet] ←WiFi→ [ESP32] ←Ethernet (W5500)→ [Switch] ←Ethernet→ [PLC BOGE]
                                                              100.100.200.10/24
                                                   ESP32 en esa red: 100.100.200.20/24
```

- La red del PLC es una **isla**: solo el PLC y el ESP32 (a través de un
  switch), **sin gateway configurado a propósito** — no debe poder
  rutear hacia ningún otro lado.
- El WiFi sigue siendo el único camino a internet (backend en Google
  Apps Script). MicroPython soporta ambas interfaces activas a la vez;
  cada una enruta solo el tráfico de su propia subred.
- **No usar WiFi para hablar con el PLC.** El ESP32 necesita Ethernet
  físico: módulo **W5500 por SPI** (recomendado, cualquier ESP32 sirve)
  o **LAN8720 por RMII** (requiere pines específicos, solo en boards que
  ya traen esa interfaz, ej. WT32-ETH01). Este firmware usa W5500 vía
  `eth_plc.py` con `network.WIZNET5K`.
- Antes de fijar `100.100.200.20` como IP del ESP32, confirmar que esa
  IP esté libre en esa red.

### Pines del W5500 (ajustar en `config.py`)

Los valores en `DEFAULTS` (`eth_spi_id`, `eth_pin_sck/mosi/miso/cs/rst`)
son un ejemplo razonable, **no están validados contra hardware real** —
no hay forma de probar esto sin el módulo físico. Confirmar contra el
cableado real antes de subir el firmware.

## PLC BOGE — Modbus TCP (solo lectura)

| Parámetro | Valor |
|---|---|
| PLC | BOGE, Siemens S7-1200 CPU 1214C DC/DC/DC |
| IP | `100.100.200.10` /24 |
| Protocolo | Modbus TCP |
| Puerto | `501` |
| Unit ID | `1` |
| Función Modbus | únicamente `0x03` (Read Holding Registers) |
| Registros | `40001–40041` (41 registros, offset 0-based = registro − 40001) |
| Cadencia de lectura del PLC | `plc_read_interval_s` (2-5s), independiente del intervalo de envío al backend |

### Garantía de solo lectura

`modbus_tcp.py` implementa **únicamente** la función 0x03. No existe en
el código ninguna función de escritura (Write Single/Multiple Register,
Write Coil, etc.) — es imposible que este firmware le envíe un comando
al PLC (ni start, ni stop, ni reset de contadores, ni cambios de
configuración), solo puede leer sus registros.

### Mapa de registros — confirmado con documentación BOGE

Validado además contra una lectura real: horas de servicio = 8.379 h,
totalizador de flujo = 91.965 Nm³, estado de planta = 0, sin alarmas ni
fallos, válvulas cerradas.

| Registro(s) | Campo | Tipo / escala |
|---|---|---|
| 40001 | `o2_content_pct` | u16 — escala depende del rango del analizador, **confirmar** |
| 40002 | `gas_flow_nm3h` | u16 / 10 |
| 40003 | `gas_pressure_barg` | u16 / 10 |
| 40004 | `air_inlet_pressure_barg` | u16 / 10 |
| 40005 | `gas_temp_c` | s16 (con signo) / 10 |
| 40006 | `air_inlet_temp_c` | s16 / 10 |
| 40007 | `gas_dewpoint_c` | s16 / 10 |
| 40008 | `air_inlet_dewpoint_c` | s16 / 10 |
| 40009–40011 | (no documentados) | se ignoran |
| 40012, 40013 | `service_hours_total` | 32 bits BOGE: `alto×32768 + bajo` |
| 40014, 40015 | `service_hours_partial` | ídem |
| 40016, 40017 | `flow_total_nm3` | ídem |
| 40018, 40019 | `flow_partial_nm3` | ídem |
| 40020, 40021 | `alarms` | máscara de bits: `(alto<<16)\|bajo` |
| 40022, 40023 | `faults` | ídem |
| 40024–40026 | `alarms_ack` | 3 palabras crudas |
| 40027 | `plant_state` | enum (ver abajo) |
| 40028–40036 | `valves` | 9 registros, 0=cerrada / 1=abierta |
| 40037–40040 | (no documentados) | se ignoran |
| 40041 | `life_bit` | heartbeat propio del PLC |

**Estados de planta (`plant_state`):**

| Código | Significado |
|---|---|
| 0 | Lista para comenzar |
| 1 | Funcionando |
| 2 | Apagado en progreso |
| 3 | Espera en progreso |
| 4 | Espera completada |
| 11 | Reinicio automático tras corte eléctrico |

⚠️ **`o2_content_pct` (registro 40001)** es el único campo cuya escala
no está confirmada — depende del rango configurado en el analizador de
O₂ del PLC. Usar el modo diagnóstico (`plc_debug_dump: true` en la
config, o `tools/dump_plc_registers.py`) comparando contra el HMI para
ajustar `scale` en `config.py` si hace falta.

⚠️ La fórmula de 32 bits de BOGE (`alto×32768 + bajo`) **no es** el
shift estándar `<<16` de otros fabricantes — está validada empíricamente
contra los valores reales de arriba, pero antes de usar estos números
para facturación o reportes formales, volver a confirmarla contra más
lecturas.

### Separación entre falla de comunicación y estado de seguridad de la planta

Si el ESP32 no logra leer el PLC (red caída, PLC apagado, etc.), **no se
inventan valores** ni se reporta `alarms=0`/`faults=0` como si todo
estuviera bien. En su lugar:

- Se reintenta la lectura con espera progresiva (`plc_max_retries`,
  backoff 1s→2s→4s...→10s tope).
- Si se agotan los reintentos, se marca `plc_online: false` en el
  payload enviado al backend, conservando el **último dato válido**
  conocido (nunca se pisa con ceros ni con un estado inventado).
- El `life_bit` (40041) permite además detectar si el *programa* del PLC
  se colgó aunque Modbus siga respondiendo: si no cambia durante varias
  lecturas seguidas, se imprime un aviso por Serial (no se reporta como
  alarma — es solo una señal de "revisar", separada de las alarmas
  reales que reporta el propio PLC).

## Herramienta de diagnóstico

`tools/dump_plc_registers.py` — se corre desde cualquier PC en la red del
PLC (Python 3 normal, sin dependencias ni ESP32) para volcar los 41
registros crudos y compararlos contra el HMI. Ver comentarios en el
archivo para el uso.

## Instalación

```bash
# 1. Grabar MicroPython (una sola vez)
esptool --port /dev/ttyUSB0 erase-flash
esptool --port /dev/ttyUSB0 --baud 460800 write-flash 0x1000 ESP32_GENERIC-*.bin

# 2. Copiar el firmware
for f in *.py; do mpremote connect /dev/ttyUSB0 fs cp $f :$f; done
mpremote connect /dev/ttyUSB0 fs cp -r tools :tools
```

Al primer arranque (o manteniendo presionado BOOT/GPIO0) la placa levanta un
punto de acceso **`PlantaO2-Config`** (clave `planta1234`); conectándose a él
y abriendo `http://192.168.4.1` se cargan todos los parámetros (WiFi,
backend, y ahora también IP/puerto del PLC y IP propia en esa red) sin
reflashear.

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

**Cadencias independientes.** La lectura del PLC (2-5s) y el envío al
backend (típicamente 60s) corren en ciclos separados dentro del mismo
`while True`, para poder cumplir la cadencia de Modbus pedida sin mandar
un HTTP POST cada pocos segundos.
