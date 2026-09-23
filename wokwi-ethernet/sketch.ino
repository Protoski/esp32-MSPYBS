/**
 * ============================================================
 * MONITOR PLANTA GASES MEDICINALES — ESP32 + Ethernet W5500
 * HR911105A (RJ45 con magnéticos) + W5500 (controlador SPI)
 * ============================================================
 *
 * LIBRERÍAS REQUERIDAS:
 *   - Ethernet         (IDE: "Ethernet" de Arduino)
 *   - ArduinoJson ≥6.x (Benoit Blanchon)
 *
 * PINOUT W5500 → ESP32 (VSPI):
 *   W5500  ESP32
 *   VCC  → 3.3V
 *   GND  → GND
 *   SCK  → GPIO18
 *   MOSI → GPIO23
 *   MISO → GPIO19
 *   CS   → GPIO5
 *   INT  → GPIO26  (opcional, para wake-on-LAN)
 *   RST  → GPIO27
 *
 * LED estado red (GPIO2): encendido = Ethernet OK
 * ============================================================
 */

#include <SPI.h>
#include <Ethernet.h>
#include <EthernetClient.h>
#include <ArduinoJson.h>

// ── PINES SPI ──────────────────────────────────────────────
const int PIN_ETH_CS  = 5;
const int PIN_ETH_RST = 27;
const int PIN_ETH_INT = 26;
const int PIN_LED_LAN = 2;

// ── DIRECCIÓN MAC (única por dispositivo) ──────────────────
byte mac[] = { 0xDE, 0xAD, 0xBE, 0xEF, 0xFE, 0xED };

// ── IP estática (respaldo si DHCP falla) ──────────────────
IPAddress ipStatic(192, 168, 1, 177);

// ── BACKEND ───────────────────────────────────────────────
const char* SERVER_HOST = "script.google.com";
const int   SERVER_PORT = 443;
const char* SCRIPT_PATH = "/macros/s/AKfycby0PXjgE7OZu17b162eEKmWzk0J6px7W4fBaiIZbzZ43eXq12_7NUfOlQ46drYPidcn/exec";
const char* HOSPITAL_ID = "247957b8-c92e-44f7-8858-819515a14731";

// ── INTERVALO Y ESTADO ────────────────────────────────────
const unsigned long SEND_INTERVAL_MS     = 5000;
const unsigned long PSA_HALF_CYCLE_MS    = 60000;

unsigned long lastSendTime    = 0;
unsigned long cycleStart      = 0;
int           psaCycle        = 0;
float         compressorHours = 1234.5;
bool          ethernetOK      = false;

// ── PROTOTIPOS ────────────────────────────────────────────
bool  initEthernet();
void  sendData();
float readO2Flow();
float readTowerAPressure();
float readTowerBPressure();
float readO2TankPressure();
float readO2Purity();
float readPsaDewPoint();
String readCompressorStatus();
float readAirLinePressure();
float readAirDewPoint();
String readVacuumPumpStatus();
float readVacuumLevel();

// ============================================================
void setup() {
  Serial.begin(115200);
  delay(400);
  Serial.println("\n=== Monitor Gases — Ethernet W5500 ===");

  pinMode(PIN_LED_LAN, OUTPUT);
  digitalWrite(PIN_LED_LAN, LOW);

  // Fuerza reset hardware del W5500 antes de SPI
  pinMode(PIN_ETH_RST, OUTPUT);
  digitalWrite(PIN_ETH_RST, LOW);
  delay(50);
  digitalWrite(PIN_ETH_RST, HIGH);
  delay(200);

  Ethernet.init(PIN_ETH_CS);
  ethernetOK = initEthernet();

  cycleStart = millis();
}

// ============================================================
void loop() {
  Ethernet.maintain(); // renueva DHCP lease si es necesario

  // Verifica link cada ciclo
  bool linkUp = (Ethernet.linkStatus() == LinkON);
  digitalWrite(PIN_LED_LAN, linkUp ? HIGH : LOW);

  if (!linkUp && ethernetOK) {
    Serial.println("[ETH] Link caído. Reintentando...");
    ethernetOK = initEthernet();
  }

  // Semiciclo PSA
  if (millis() - cycleStart >= PSA_HALF_CYCLE_MS) {
    psaCycle   = (psaCycle == 0) ? 1 : 0;
    cycleStart = millis();
    Serial.printf("[PSA] Torre %s adsorbiendo\n", psaCycle == 0 ? "A" : "B");
  }

  // Envío periódico
  if (millis() - lastSendTime >= SEND_INTERVAL_MS) {
    lastSendTime = millis();
    compressorHours += (SEND_INTERVAL_MS / 3600000.0);
    if (ethernetOK) {
      sendData();
    } else {
      Serial.println("[ETH] Sin red — datos no enviados.");
    }
  }
}

// ============================================================
// INICIALIZAR ETHERNET
// ============================================================
bool initEthernet() {
  Serial.print("[ETH] Solicitando IP por DHCP...");
  if (Ethernet.begin(mac, 10000, 4000) == 0) {
    Serial.println(" fallido. Usando IP estática.");
    Ethernet.begin(mac, ipStatic);
  }

  if (Ethernet.localIP() == IPAddress(0, 0, 0, 0)) {
    Serial.println("[ETH] ERROR: No se asignó IP.");
    return false;
  }

  Serial.printf("\n[ETH] IP: %s\n", Ethernet.localIP().toString().c_str());
  return true;
}

// ============================================================
// ENVÍO DE DATOS (HTTP sobre TCP — Google Apps Script)
// Nota: el W5500 no tiene TLS nativo. Para HTTPS usa un
// proxy interno, un ESP32 con WiFiClientSecure, o una
// capa TLS externa (nginx, traefik). El ejemplo usa HTTP
// hacia un endpoint local que reenvía al script.
// En red de producción considera always-SSL.
// ============================================================
void sendData() {
  StaticJsonDocument<512> doc;
  doc["action"]                = "data";
  doc["hospital_id"]           = HOSPITAL_ID;
  doc["o2_flow_m3h"]           = readO2Flow();
  doc["tower_a_pressure_bar"]  = readTowerAPressure();
  doc["tower_b_pressure_bar"]  = readTowerBPressure();
  doc["o2_tank_pressure_bar"]  = readO2TankPressure();
  doc["o2_purity_pct"]         = readO2Purity();
  doc["psa_dewpoint_c"]        = readPsaDewPoint();
  doc["compressor_status"]     = readCompressorStatus();
  doc["compressor_hours"]      = (int)compressorHours;
  doc["air_line_pressure_bar"] = readAirLinePressure();
  doc["air_dewpoint_c"]        = readAirDewPoint();
  doc["vacuum_pump_status"]    = readVacuumPumpStatus();
  doc["vacuum_level_mmhg"]     = readVacuumLevel();

  String body;
  serializeJson(doc, body);

  EthernetClient client;
  client.setTimeout(10000);

  Serial.printf("[ETH] Conectando a %s:%d ...\n", SERVER_HOST, SERVER_PORT);
  if (!client.connect(SERVER_HOST, SERVER_PORT)) {
    Serial.println("[ETH] ERROR: no se pudo conectar al servidor.");
    return;
  }

  // HTTP POST
  client.printf("POST %s HTTP/1.1\r\n", SCRIPT_PATH);
  client.printf("Host: %s\r\n", SERVER_HOST);
  client.printf("Content-Type: text/plain;charset=utf-8\r\n");
  client.printf("Content-Length: %d\r\n", body.length());
  client.printf("Connection: close\r\n\r\n");
  client.print(body);

  // Leer primera línea de respuesta
  unsigned long t0 = millis();
  while (!client.available() && millis() - t0 < 8000) delay(10);

  String statusLine = client.readStringUntil('\n');
  Serial.printf("[ETH] Respuesta: %s\n", statusLine.c_str());
  client.stop();
}

// ============================================================
// LECTURAS DE SENSORES (simuladas — reemplazar por ADC reales)
// ============================================================
float readO2Flow()           { return 3.2f  + (random(-30, 30)  / 100.0f); }
float readO2TankPressure()   { return 4.2f  + (random(-40, 40)  / 100.0f); }
float readO2Purity()         { return 95.5f + (random(-80, 20)  / 100.0f); }
float readPsaDewPoint()      { return -42.0f + (random(-20, 20) / 10.0f);  }
float readAirLinePressure()  { return 5.0f  + (random(-25, 25)  / 100.0f); }
float readAirDewPoint()      { return -47.5f + (random(-15, 15) / 10.0f);  }
float readVacuumLevel()      { return -550.0f + (float)random(-30, 30);    }

float readTowerAPressure() {
  return (psaCycle == 0) ? 5.1f + (random(-20,20)/100.0f)
                         : 0.3f + (random(-5,15) /100.0f);
}
float readTowerBPressure() {
  return (psaCycle == 1) ? 5.1f + (random(-20,20)/100.0f)
                         : 0.3f + (random(-5,15) /100.0f);
}
String readCompressorStatus() {
  if (random(200) == 0) return "FAULT";
  return "ON";
}
String readVacuumPumpStatus() {
  if (random(300) == 0) return "FAULT";
  return "ON";
}
