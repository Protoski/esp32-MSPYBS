/**
 * Monitor Planta Gases Medicinales - ESP32 + ENC28J60 Ethernet
 * Modulo: ENC28J60 + conector HR911105A
 *
 * Librerias requeridas (Gestor de Librerias Arduino IDE):
 *   1. EthernetENC      (autor: Juraj Andrassy)
 *   2. ArduinoJson      (Benoit Blanchon) version >= 6.x
 *
 * Pinout ENC28J60 -> ESP32:
 *   VCC   -> 3.3V
 *   GND   -> GND
 *   SCK   -> GPIO18
 *   SI    -> GPIO23  (MOSI)
 *   SO    -> GPIO19  (MISO)
 *   CS    -> GPIO5
 *   RESET -> GPIO27
 *   INT   -> GPIO26  (opcional)
 *   CLKOUT, WOL -> sin conectar
 */

#include <SPI.h>
#include <EthernetENC.h>
#include <ArduinoJson.h>

// ---------- Pines ----------
const int PIN_CS    = 5;
const int PIN_RST   = 27;
const int PIN_LED   = 2;   // LED verde = Ethernet link OK

// ---------- Red ----------
byte mac[] = { 0xDE, 0xAD, 0xBE, 0xEF, 0xFE, 0xED };
IPAddress ipFallback(192, 168, 1, 177);

// ---------- Backend ----------
const char* HOST        = "script.google.com";
const int   PORT        = 80;   // HTTP; ver nota TLS al final del archivo
const char* SCRIPT_PATH = "/macros/s/AKfycby0PXjgE7OZu17b162eEKmWzk0J6px7W4fBaiIZbzZ43eXq12_7NUfOlQ46drYPidcn/exec";
const char* HOSPITAL_ID = "247957b8-c92e-44f7-8858-819515a14731";

// ---------- Temporización ----------
const unsigned long SEND_MS     = 5000;
const unsigned long PSA_HALF_MS = 60000;

// ---------- Estado global ----------
unsigned long lastSend    = 0;
unsigned long cycleStart  = 0;
int           psaCycle    = 0;
float         compHours   = 1234.5;
bool          ethOK       = false;

// ===================================================================
void setup() {
  Serial.begin(115200);
  delay(400);
  Serial.println("\n=== Monitor Gases - Ethernet ENC28J60 ===");

  pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_LED, LOW);

  // Reset hardware del ENC28J60
  pinMode(PIN_RST, OUTPUT);
  digitalWrite(PIN_RST, LOW);
  delay(60);
  digitalWrite(PIN_RST, HIGH);
  delay(200);

  Ethernet.init(PIN_CS);
  ethOK = conectarEthernet();

  cycleStart = millis();
}

// ===================================================================
void loop() {
  Ethernet.maintain();

  bool link = (Ethernet.linkStatus() == LinkON);
  digitalWrite(PIN_LED, link ? HIGH : LOW);

  if (!link && ethOK) {
    Serial.println("[ETH] Link caido. Reconectando...");
    ethOK = conectarEthernet();
  }

  // Semiciclo PSA
  if (millis() - cycleStart >= PSA_HALF_MS) {
    psaCycle   = (psaCycle == 0) ? 1 : 0;
    cycleStart = millis();
    Serial.printf("[PSA] Torre %s adsorbiendo\n", psaCycle == 0 ? "A" : "B");
  }

  // Envio periodico
  if (millis() - lastSend >= SEND_MS) {
    lastSend  = millis();
    compHours += (SEND_MS / 3600000.0);
    if (ethOK) enviarDatos();
    else Serial.println("[ETH] Sin red - datos no enviados.");
  }
}

// ===================================================================
bool conectarEthernet() {
  Serial.print("[ETH] Solicitando IP por DHCP...");
  if (Ethernet.begin(mac, 8000, 2000) == 0) {
    Serial.println(" fallo. Usando IP estatica.");
    Ethernet.begin(mac, ipFallback);
  }
  if (Ethernet.localIP() == IPAddress(0, 0, 0, 0)) {
    Serial.println("[ETH] ERROR: sin IP asignada.");
    return false;
  }
  Serial.printf("\n[ETH] IP: %s\n", Ethernet.localIP().toString().c_str());
  return true;
}

// ===================================================================
void enviarDatos() {
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
  doc["compressor_hours"]      = (int)compHours;
  doc["air_line_pressure_bar"] = readAirLinePressure();
  doc["air_dewpoint_c"]        = readAirDewPoint();
  doc["vacuum_pump_status"]    = readVacuumPumpStatus();
  doc["vacuum_level_mmhg"]     = readVacuumLevel();

  String body;
  serializeJson(doc, body);

  EthernetClient client;
  Serial.printf("[ETH] Conectando a %s ...\n", HOST);

  if (!client.connect(HOST, PORT)) {
    Serial.println("[ETH] ERROR: sin conexion al servidor.");
    return;
  }

  client.print(String("POST ") + SCRIPT_PATH + " HTTP/1.1\r\n");
  client.print(String("Host: ") + HOST + "\r\n");
  client.print("Content-Type: text/plain;charset=utf-8\r\n");
  client.print(String("Content-Length: ") + body.length() + "\r\n");
  client.print("Connection: close\r\n\r\n");
  client.print(body);

  unsigned long t0 = millis();
  while (!client.available() && millis() - t0 < 8000) delay(10);

  String resp = client.readStringUntil('\n');
  Serial.printf("[ETH] Respuesta: %s\n", resp.c_str());
  client.stop();
}

// ===================================================================
// Lecturas de sensores (simuladas - reemplazar con ADC reales)
// ===================================================================
float readO2Flow()          { return 3.2f   + (random(-30, 30)  / 100.0f); }
float readO2TankPressure()  { return 4.2f   + (random(-40, 40)  / 100.0f); }
float readO2Purity()        { return 95.5f  + (random(-80, 20)  / 100.0f); }
float readPsaDewPoint()     { return -42.0f + (random(-20, 20)  / 10.0f);  }
float readAirLinePressure() { return 5.0f   + (random(-25, 25)  / 100.0f); }
float readAirDewPoint()     { return -47.5f + (random(-15, 15)  / 10.0f);  }
float readVacuumLevel()     { return -550.0f + (float)random(-30, 30);     }

float readTowerAPressure() {
  return (psaCycle == 0) ? 5.1f + (random(-20, 20) / 100.0f)
                         : 0.3f + (random(-5,  15)  / 100.0f);
}
float readTowerBPressure() {
  return (psaCycle == 1) ? 5.1f + (random(-20, 20) / 100.0f)
                         : 0.3f + (random(-5,  15)  / 100.0f);
}
String readCompressorStatus() { return (random(200) == 0) ? "FAULT" : "ON"; }
String readVacuumPumpStatus() { return (random(300) == 0) ? "FAULT" : "ON"; }

/*
 * NOTA TLS: El ENC28J60 no tiene SSL nativo. Google Apps Script
 * requiere HTTPS (puerto 443). Opciones para produccion:
 *   1. Proxy local HTTP->HTTPS: nginx en Raspberry Pi.
 *   2. Usar WiFi (plant_monitor.ino) para el POST HTTPS.
 *   3. Libreria SSLClient (khoih-prog/SSLClient en GitHub).
 */
