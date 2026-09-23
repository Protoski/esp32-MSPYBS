# Gateway PLC BOGE → Backend (ESP32 dedicado, Arduino)

Un **segundo ESP32**, separado del que ya lee los sensores 4-20mA/entradas
digitales (ese sigue en MicroPython, sin cambios — ver `../micropython/`).
Este equipo hace una sola cosa: lee el PLC BOGE por Modbus TCP a través de
un módulo Ethernet **ENC28J60**, y reenvía los datos por WiFi al mismo
backend (Google Apps Script).

## Por qué un segundo ESP32 y por qué ENC28J60

- El módulo Ethernet disponible localmente es **ENC28J60**, no W5500. En
  MicroPython el soporte de ENC28J60 no es oficial/confiable; en
  **Arduino** sí existe una librería madura (`EthernetENC`), así que este
  firmware puntual se hizo en Arduino en vez de MicroPython.
- En vez de migrar todo el sistema existente (que ya funciona) a Arduino,
  se separó en un segundo equipo dedicado solo al PLC — así el ESP32 de
  sensores no se toca ni se arriesga.

## ⚠️ No compilado ni probado contra hardware real

Este sandbox no tiene acceso al gestor de paquetes de Arduino/PlatformIO
(la misma restricción de red que bloquea otros dominios externos), así
que **no pude compilar el sketch completo**. Sí se verificó por separado,
con `gcc` puro, que la aritmética de decodificación (fórmula de 32 bits
de BOGE, interpretación con signo, máscaras de bits) da los resultados
correctos contra los valores reales confirmados (8.379 h, 91.965 Nm³).
Antes de flashear:

1. Revisar que los nombres de la API de `EthernetENC` (`Ethernet.init`,
   `Ethernet.begin(mac, ip, dns, gateway, subnet)`, `EthernetClient`)
   coincidan con la versión de la librería que instale el Library Manager.
2. Confirmar el pin CS del ENC28J60 (`ENC28J60_CS_PIN`, hoy GPIO 5) y que
   el resto de pines SPI (18/19/23) coincidan con el cableado real.
3. Compilar y revisar errores antes de subir a la placa.

## Librerías requeridas (Arduino Library Manager)

- **EthernetENC** (Juraj Andrassy) — driver del ENC28J60 con la misma API
  que `Ethernet.h` estándar. **No usar `UIPEthernet`**: tiene bugs de
  compatibilidad conocidos en ESP32.
- **ArduinoJson** ≥ 6.x (Benoit Blanchon)
- `WiFi.h`, `WiFiClientSecure.h`, `HTTPClient.h` — incluidas en el core ESP32

## Red

Mismo diseño que el ESP32 de sensores: WiFi para internet/backend,
Ethernet dedicada y aislada para el PLC (sin gateway real).

| | |
|---|---|
| IP de este ESP32 en la red del PLC | `100.100.200.20` /24 |
| PLC | `100.100.200.10:501`, unit 1, Modbus TCP |
| Función Modbus | únicamente `0x03` (Read Holding Registers) — **solo lectura**, garantizado por diseño (no hay código de escritura en el archivo) |
| Registros | `40001–40041`, mismo mapa documentado en `../micropython/README.md` |

## Limitación actual del backend

Este gateway manda los campos con prefijo `plc_*` (`plc_o2_content_pct`,
`plc_alarms`, `plc_valves`, etc.) en el mismo POST `action=data` que ya
usa el otro ESP32. El backend actual (`backend/google-apps-script.js`,
función `postData_`) **solo guarda las columnas que ya tenía definidas**
— los campos `plc_*` viajan en el JSON pero hoy se ignoran silenciosamente
al escribir la fila del Sheet. Además, como cada ESP32 hace su propio
POST, van a aparecer como filas separadas para el mismo `hospital_id` (una
con los datos de sensores, otra con `plc_online` y los campos `plc_*` pero
sensores en 0).

Esto es aceptable para ver los datos por Serial/depuración ahora mismo,
pero si querés que los datos del PLC queden guardados de verdad en el
Sheet y visibles en el dashboard, hace falta extender el backend
(columnas nuevas + lógica para fusionar ambas fuentes por `hospital_id`).
No lo hice todavía porque no era parte de lo pedido — avisame si querés
que lo agregue.

## Separación entre falla de comunicación y estado de seguridad

Igual criterio que el otro ESP32: si el PLC no responde tras agotar los
reintentos (backoff 1s→2s→4s...→10s tope), se marca `plc_online: false` y se
reenvían los **últimos datos válidos** conocidos — nunca se fabrican
ceros ni se reporta `alarms=0` como si la planta estuviera bien. El
`life_bit` (registro 40041) se usa para avisar por Serial si el programa
del PLC parece colgado (Modbus responde pero el valor no cambia), sin
confundirlo con una alarma real.
