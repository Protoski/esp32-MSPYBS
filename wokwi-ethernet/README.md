# ESP32 + módulo Ethernet ENC28J60 (conector HR911105A)

El módulo tiene un chip **ENC28J60** (Microchip), un cristal de 25 MHz y el conector
RJ45 **HR911105A** con magnéticos integrados. Se comunica con el ESP32 por SPI.

## Conexión

| Pin del módulo | ESP32   | Notas                                   |
|----------------|---------|-----------------------------------------|
| VCC            | 3.3V    | NO usar 5V                              |
| GND            | GND     |                                         |
| SCK            | GPIO18  |                                         |
| SI             | GPIO23  | MOSI                                    |
| SO             | GPIO19  | MISO                                    |
| CS             | GPIO5   |                                         |
| RESET          | GPIO27  |                                         |
| INT            | GPIO26  | Opcional                                |
| CLKOUT         | —       | Sin conectar                            |
| WOL            | —       | Sin conectar                            |

El ENC28J60 consume unos 150-180 mA. Si el ESP32 se reinicia o el DHCP falla de forma
intermitente, alimenta el módulo con un regulador de 3.3V aparte (GND común).

## Flashear con Arduino IDE

1. Gestor de librerías → instala **EthernetENC** (Juraj Andrassy) y **ArduinoJson**.
2. Abre `sketch.ino` **completo**: selecciona todo (Ctrl+A) en GitHub y pégalo sobre
   un sketch vacío.
3. Placa: **ESP32 Dev Module** → elige el puerto → Subir.
4. Monitor serie a 115200 baudios: debe mostrar `[ETH] IP: ...`.

## Limitaciones

- **Wokwi no tiene un componente ENC28J60**, así que este circuito no se puede simular
  allí. `diagram.json` sirve solo como referencia de cableado.
- El ENC28J60 no tiene TLS. Google Apps Script exige HTTPS, así que el POST por el
  puerto 80 solo recibe un redirect: sirve para comprobar la conectividad, no para
  guardar datos. Para producción, usa WiFi (`esp32/plant_monitor.ino`) para el POST
  HTTPS o pon un proxy HTTP→HTTPS en la red local.
