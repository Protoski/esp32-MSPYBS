# Demo Wokwi: ESP32 + W5500 + HR911105A (Ethernet)

## Cómo probarlo en Wokwi

1. Ve a https://wokwi.com/projects/new/esp32
2. Reemplaza el contenido de `diagram.json` con el de este archivo.
3. Reemplaza el contenido de `sketch.ino` con el de este archivo.
4. Instala en Wokwi las librerías: **Ethernet** (Arduino) y **ArduinoJson** ≥6.x.
5. Start simulation → el Serial Monitor mostrará la IP asignada y los POSTs enviados.

---

## Esquema de conexión real (Hardware)

```
HR911105A (RJ45 con magnéticos integrados)
          │
          │ par trenzado cat.5/6
          ▼
    ┌──────────────┐
    │   W5500      │  ← controlador Ethernet SPI (5V tolerante, opera a 3.3V)
    │  (SPI slave) │
    └──────┬───────┘
           │  SPI + control
           ▼
    ┌──────────────┐
    │   ESP32      │
    │  DevKit V1   │
    └──────────────┘

W5500 pin  │  ESP32 GPIO  │  Notas
───────────┼──────────────┼──────────────────────────────
VCC        │  3.3V        │  NO conectar a 5V (daña el ESP32)
GND        │  GND         │
SCK        │  GPIO18      │  VSPI clock
MOSI       │  GPIO23      │  VSPI MOSI
MISO       │  GPIO19      │  VSPI MISO
CS / SSEL  │  GPIO5       │  Chip Select activo-LOW
RST        │  GPIO27      │  Reset activo-LOW
INT        │  GPIO26      │  Interrupción (opcional)
```

---

## Módulos comunes que usan HR911105A + W5500

| Módulo         | Voltaje | Notas                              |
|----------------|---------|------------------------------------|
| WIZnet W5500   | 3.3V    | El más usado, SPI a 80MHz          |
| Ebyte E30-TTL  | 3.3V    | Con antena, para redes industriales|
| WeAct W5500    | 3.3V    | Compacto, con LEDs de estado       |

---

## Nota sobre HTTPS / TLS

El W5500 no tiene aceleración TLS en hardware. Para enviar HTTPS a
Google Apps Script (como hace el `plant_monitor.ino` con WiFiClientSecure)
tienes tres opciones:

1. **Proxy HTTP→HTTPS local**: Raspberry Pi / servidor con nginx redirige el POST del
   ESP32 hacia script.google.com via HTTPS.
2. **SSL offloading en red local** (balanceador, router con Squid).
3. **Mantener WiFi para HTTPS**: usa Ethernet como red primaria para alta disponibilidad
   y WiFi solo para el POST HTTPS al script. Ambas interfaces pueden coexistir.
