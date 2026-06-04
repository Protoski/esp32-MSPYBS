/**
 * ============================================================
 * MONITOR DE PLANTA DE GASES MEDICINALES - ESP32
 * Firmware v1.0.0  |  Arduino IDE / PlatformIO
 * ============================================================
 * Librerías requeridas (instalar desde el Gestor de Librerías):
 *   - ArduinoJson  ≥ 6.x  (Benoit Blanchon)
 *   - WiFi.h       (incluida en el core ESP32)
 *   - HTTPClient.h (incluida en el core ESP32)
 *
 * NOTAS IMPORTANTES:
 *  - Google Apps Script responde a un POST con un redirect 302
 *    hacia script.googleusercontent.com. Seguirlo automáticamente
 *    reenvía el POST y provoca "400 Bad Request", por eso aquí el
 *    redirect se sigue manualmente con un GET (ver sendData()).
 *  - En producción, reemplaza los valores simulados por lecturas
 *    reales de tus sensores (ADC, Modbus, I2C, etc.).
 * ============================================================
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// ── CONFIGURACIÓN DE RED ────────────────────────────────────
const char* WIFI_SSID     = "ONYX";
const char* WIFI_PASSWORD = "oingenieria2019";

// ── URL DEL BACKEND (Google Apps Script) ───────────────────
const char* API_URL = "https://script.google.com/macros/s/AKfycby0PXjgE7OZu17b162eEKmWzk0J6px7W4fBaiIZbzZ43eXq12_7NUfOlQ46drYPidcn/exec";

// ── ID DEL HOSPITAL ────────────────────────────────────────
// Crea un hospital desde el panel admin y copia aquí su ID
const char* HOSPITAL_ID = "247957b8-c92e-44f7-8858-819515a14731";

// ── INTERVALO DE ENVÍO ─────────────────────────────────────
const unsigned long SEND_INTERVAL_MS = 5000; // cada 5 segundos

// ── VARIABLES GLOBALES DE ESTADO ───────────────────────────
unsigned long lastSendTime    = 0;
float         compressorHours = 1234.5; // Contador de horas acumuladas
bool          pumpRunning     = true;
bool          compRunning     = true;

// ── SIMULACIÓN DE CICLO PSA ────────────────────────────────
// La PSA alterna: Torre A en adsorción (alta presión) mientras
// Torre B regenera (baja presión), y viceversa cada ~60 segundos.
int   psaCycle          = 0;    // 0 = Torre A adsorbiendo, 1 = Torre B adsorbiendo
unsigned long cycleStart = 0;
const unsigned long PSA_HALF_CYCLE_MS = 60000; // 60 s por semiciclo

// ── PROTOTIPOS ──────────────────────────────────────────────
void  connectWiFi();
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
  delay(500);
  Serial.println("\n=== Monitor Planta Gases Medicinales ===");

  connectWiFi();
  cycleStart = millis();
}

// ============================================================
void loop() {
  // Reconexión automática si cae la WiFi
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WiFi] Conexión perdida. Reconectando...");
    connectWiFi();
  }

  // Actualiza el semiciclo PSA
  if (millis() - cycleStart >= PSA_HALF_CYCLE_MS) {
    psaCycle   = (psaCycle == 0) ? 1 : 0;
    cycleStart = millis();
    Serial.printf("[PSA] Semiciclo cambiado → Torre %s adsorbiendo\n",
                  psaCycle == 0 ? "A" : "B");
  }

  // Envía datos al intervalo definido
  if (millis() - lastSendTime >= SEND_INTERVAL_MS) {
    lastSendTime = millis();
    compressorHours += (SEND_INTERVAL_MS / 3600000.0); // incrementa horas
    sendData();
  }
}

// ============================================================
// CONEXIÓN WIFI
// ============================================================
void connectWiFi() {
  Serial.printf("[WiFi] Conectando a %s", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[WiFi] Conectado  IP: %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("\n[WiFi] ERROR: No se pudo conectar.");
  }
}

// ============================================================
// ENVÍO DE DATOS AL BACKEND
// ============================================================
void sendData() {
  // Construye el documento JSON (capacidad generosa para evitar truncamiento)
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

  String jsonBody;
  serializeJson(doc, jsonBody);

  Serial.println("[HTTP] Enviando payload:");
  Serial.println(jsonBody);

  // ⚡ Google Apps Script responde a un POST con un redirect 302 hacia
  // script.googleusercontent.com. El seguimiento automático de redirects
  // del ESP32 reenvía el POST a esa URL, que devuelve "400 Bad Request".
  // Solución: seguir el redirect manualmente:
  //   1) POST a /exec con redirects DESACTIVADOS  → leemos cabecera Location
  //   2) GET a la URL de Location                 → respuesta real del script
  WiFiClientSecure client;
  client.setInsecure();              // sin validación de certificado (suficiente aquí)

  HTTPClient http;
  http.begin(client, API_URL);
  http.addHeader("Content-Type", "text/plain;charset=utf-8");
  http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);

  // Pedimos que se nos exponga la cabecera Location del redirect
  const char* headerKeys[] = { "Location" };
  http.collectHeaders(headerKeys, 1);

  int httpCode = http.POST(jsonBody);
  Serial.printf("[HTTP] POST código: %d\n", httpCode);

  if (httpCode == HTTP_CODE_FOUND || httpCode == HTTP_CODE_MOVED_PERMANENTLY ||
      httpCode == HTTP_CODE_SEE_OTHER || httpCode == HTTP_CODE_TEMPORARY_REDIRECT) {
    // Redirect esperado → seguirlo con un GET manual
    String location = http.header("Location");
    http.end();
    Serial.println("[HTTP] Redirect → " + location);

    if (location.length() > 0) {
      WiFiClientSecure client2;
      client2.setInsecure();
      HTTPClient http2;
      http2.begin(client2, location);
      http2.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
      int code2 = http2.GET();
      if (code2 > 0) {
        Serial.printf("[HTTP] OK %d | Respuesta: %s\n", code2, http2.getString().c_str());
      } else {
        Serial.printf("[HTTP] ERROR GET: %s\n", http2.errorToString(code2).c_str());
      }
      http2.end();
    } else {
      Serial.println("[HTTP] ERROR: redirect sin cabecera Location");
    }
  } else if (httpCode > 0) {
    // Sin redirect (poco común) → ya tenemos la respuesta
    Serial.printf("[HTTP] Respuesta directa: %s\n", http.getString().c_str());
    http.end();
  } else {
    Serial.printf("[HTTP] ERROR POST: %s\n", http.errorToString(httpCode).c_str());
    http.end();
  }
}

// ============================================================
// LECTURAS DE SENSORES (simuladas con variaciones realistas)
// En producción: reemplaza random/sin por lectura real del sensor.
// ============================================================

/**
 * Caudal de O2 producido (m³/h)
 * Rango normal operativo: 2.0 – 4.5 m³/h
 */
float readO2Flow() {
  return 3.2f + (random(-30, 30) / 100.0f);
}

/**
 * Presión Torre A (bar)
 * Durante adsorción: ~4.8-5.5 bar  |  Regeneración: ~0.2-0.6 bar
 */
float readTowerAPressure() {
  if (psaCycle == 0) {
    // Torre A adsorbiendo → presión alta
    return 5.1f + (random(-20, 20) / 100.0f);
  } else {
    // Torre A regenerando → presión baja
    return 0.3f + (random(-5, 15) / 100.0f);
  }
}

/**
 * Presión Torre B (bar)
 * Inverso a Torre A por diseño de la PSA
 */
float readTowerBPressure() {
  if (psaCycle == 1) {
    // Torre B adsorbiendo → presión alta
    return 5.1f + (random(-20, 20) / 100.0f);
  } else {
    // Torre B regenerando → presión baja
    return 0.3f + (random(-5, 15) / 100.0f);
  }
}

/**
 * Presión tanque de almacenamiento de O2 (bar)
 * Rango normal: 2.5 – 6.0 bar
 */
float readO2TankPressure() {
  return 4.2f + (random(-40, 40) / 100.0f);
}

/**
 * Pureza de Oxígeno (%)
 * Umbral crítico: <93%  |  Alarma grave: <90%
 * Simulación: oscila levemente alrededor de 95.5%
 */
float readO2Purity() {
  return 95.5f + (random(-80, 20) / 100.0f);
}

/**
 * Punto de rocío del aire de entrada a la PSA (°C)
 * Valores normales: -30 a -50 °C  (más negativo = más seco = mejor)
 */
float readPsaDewPoint() {
  return -42.0f + (random(-20, 20) / 10.0f);
}

/**
 * Estado del compresor de aire (ON / OFF / FAULT)
 */
String readCompressorStatus() {
  // Simula falla esporádica con probabilidad 1/200
  if (random(200) == 0) return "FAULT";
  return compRunning ? "ON" : "OFF";
}

/**
 * Presión de la línea de aire médico (bar)
 * Rango normal: 4.5 – 5.5 bar (según normativa HTM 02-01)
 */
float readAirLinePressure() {
  return 5.0f + (random(-25, 25) / 100.0f);
}

/**
 * Punto de rocío del aire médico final (°C)
 * Debe ser < -46 °C según ISO 7396-1
 */
float readAirDewPoint() {
  return -47.5f + (random(-15, 15) / 10.0f);
}

/**
 * Estado de la bomba de vacío (ON / OFF / FAULT)
 */
String readVacuumPumpStatus() {
  if (random(300) == 0) return "FAULT";
  return pumpRunning ? "ON" : "OFF";
}

/**
 * Nivel de vacío del tanque/línea (mmHg)
 * Valores negativos: vacío médico nominal = -500 a -600 mmHg
 * (según ISO 7396-1: mínimo -400 mmHg en punto de uso)
 */
float readVacuumLevel() {
  return -550.0f + (random(-30, 30) / 1.0f);
}
