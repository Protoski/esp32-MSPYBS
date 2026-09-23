/**
 * ============================================================
 * MONITOR DE PLANTA DE GASES MEDICINALES - ESP32
 * Firmware v2.0.0  |  Pasarela PLC -> Google Sheets
 * ============================================================
 *  PLC Siemens S7-1200 (generador O2 BOGE) --LAN/ENC28J60--> ESP32
 *  ESP32 --WiFi/HTTPS--> Google Apps Script
 *
 * Librerías (Gestor de Librerías):
 *   - EthernetENC  (Juraj Andrassy)
 *   - ArduinoJson  >= 6.x (Benoit Blanchon)
 *
 * Cableado ENC28J60 -> ESP32:
 *   VCC->3.3V  GND->GND  SCK->18  SI->23  SO->19  CS->5  RESET->27
 *
 * Modbus TCP según el manual BOGE HMI S7-1200 (596.1430.04, pág. 42 y 51-55):
 *   IP 100.100.200.10, máscara 255.255.255.0, puerto 501, nodo 1
 *   Holding registers 40001..40041
 *
 * Google Apps Script responde al POST con un redirect 302; seguirlo
 * automáticamente reenvía el POST y da "400 Bad Request", por eso el
 * redirect se sigue a mano con un GET (ver sendData()).
 * ============================================================
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <SPI.h>
#include <EthernetENC.h>
#include <ArduinoJson.h>

// WIFI_SSID, WIFI_PASSWORD, API_URL y DEVICE_TOKEN: crea secrets.h a partir
// de secrets.example.h (no se sube al repositorio)
#include "secrets.h"

const char* HOSPITAL_ID = "247957b8-c92e-44f7-8858-819515a14731";
// Equipo dentro del hospital: cada planta de O2 con su propio ESP32 lleva un
// UNIT_ID distinto (O2-1, O2-2...). Mismo HOSPITAL_ID en todos.
const char* UNIT_ID     = "O2-1";
const char* UNIT_TYPE   = "o2";

const unsigned long SEND_INTERVAL_MS = 5000;

// ── ENC28J60 ────────────────────────────────────────────────
const int PIN_ETH_CS  = 5;
const int PIN_ETH_RST = 27;

// Red del PLC (sin DHCP). .1 = punto de acceso BOGE opcional,
// .10 = PLC, .100+ = rango DHCP del punto de acceso.
byte      ETH_MAC[]  = { 0xDE, 0xAD, 0xBE, 0xEF, 0xFE, 0xED };
IPAddress ETH_IP     (100, 100, 200, 50);
IPAddress ETH_MASK   (255, 255, 255, 0);
IPAddress ETH_GW     (100, 100, 200, 1);

// ── MODBUS TCP ──────────────────────────────────────────────
IPAddress      PLC_IP   (100, 100, 200, 10);
const uint16_t PLC_PORT = 501;   // 500 + dirección de esclavo
const uint8_t  PLC_UNIT = 1;

const uint16_t REG_COUNT = 41;   // 40001..40041

// Desplazamiento respecto a 40001
enum Reg : uint8_t {
  R_AT01 = 0,          // O2 gas producto        %/10
  R_FT01 = 1,          // Caudal gas producto    Nm3/h /10
  R_PT01 = 2,          // Presión gas producto   barg /10
  R_PT02 = 3,          // Presión entrada aire   barg /10
  R_TT01 = 4,          // Temp. gas producto     °C /10
  R_TT02 = 5,          // Temp. entrada aire     °C /10
  R_MT01 = 6,          // P. rocío gas producto  °C /10
  R_MT02 = 7,          // P. rocío entrada aire  °C /10
  R_SERVTIME_L = 11,   // Horas totales (L/U)
  R_SERVPART_L = 13,   // Horas parciales (L/U)
  R_FLOWTOTAL_L = 15,  // Flujo total Nm3 (L/U)
  R_FLOWPART_L = 17,   // Flujo parcial Nm3 (L/U)
  R_ALARMS_L = 19,     // Alarmas 1/2 (máscara de bits)
  R_FAULTS_L = 21,     // Fallos 1/2 (máscara de bits)
  R_ACK = 23,          // 3 palabras de alarmas reconocidas
  R_ESTADO  = 26,      // 0 listo, 1 marcha, 2 parando, 3/4 espera, 11 rearranque
  R_VALVES = 27,       // 9 posiciones de válvula
  R_LIFEBIT = 40,
};

const uint32_t FAULT_COMPRESOR = 1UL << 8;

struct DatosPLC {
  double   o2Pct, caudal, presProducto, presAire;
  double   tempProducto, tempAire, rocioProducto, rocioAire;
  uint32_t horasTotales, horasParciales, flujoTotal, flujoParcial;
  uint32_t alarmas, fallos;
  uint16_t alarmasAck[3];
  uint16_t valvulas[9];
  uint16_t lifeBit;
  int      estado;
};

EthernetClient plc;
unsigned long  lastSendTime = 0;
DatosPLC       ultimo;
bool           hayDatos = false;

// ============================================================
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n=== Pasarela PLC BOGE -> Google Sheets ===");

  pinMode(PIN_ETH_RST, OUTPUT);
  digitalWrite(PIN_ETH_RST, LOW);
  delay(60);
  digitalWrite(PIN_ETH_RST, HIGH);
  delay(200);

  Ethernet.init(PIN_ETH_CS);
  Ethernet.begin(ETH_MAC, ETH_IP, ETH_GW, ETH_GW, ETH_MASK);
  Serial.printf("[ETH] IP local: %s  (PLC: %s:%u)\n",
                Ethernet.localIP().toString().c_str(),
                PLC_IP.toString().c_str(), PLC_PORT);

  connectWiFi();
}

// ============================================================
void loop() {
  Ethernet.maintain();

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WiFi] Conexión perdida. Reconectando...");
    connectWiFi();
  }

  if (millis() - lastSendTime < SEND_INTERVAL_MS) return;
  lastSendTime = millis();

  DatosPLC d;
  bool online = leerPLC(d);
  if (online) {
    ultimo = d;
    hayDatos = true;
    imprimirDatos(d);
  } else {
    Serial.println(hayDatos
      ? "[PLC] Sin respuesta: se envía plc_online=false con el último dato válido."
      : "[PLC] Sin respuesta y sin datos previos: se envía solo plc_online=false.");
  }
  if (WiFi.status() == WL_CONNECTED) sendData(online);
}

// ============================================================
// WIFI
// ============================================================
void connectWiFi() {
  Serial.printf("[WiFi] Conectando a %s", WIFI_SSID);
  WiFi.mode(WIFI_STA);
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
// MODBUS TCP (función 03, read holding registers)
// ============================================================
bool leerExacto(uint8_t* buf, size_t n, unsigned long timeoutMs) {
  size_t got = 0;
  unsigned long t0 = millis();
  while (got < n && millis() - t0 < timeoutMs) {
    int avail = plc.available();
    if (avail > 0) {
      got += plc.read(buf + got, min((size_t)avail, n - got));
    } else {
      delay(2);
    }
  }
  return got == n;
}

bool leerRegistros(uint16_t offset, uint16_t cantidad, uint16_t* destino) {
  static uint16_t transId = 0;

  if (!plc.connected()) {
    plc.stop();
    if (plc.connect(PLC_IP, PLC_PORT) != 1) {
      Serial.printf("[PLC] ERROR: no conecta con %s:%u (revisa cable, IP y enlace)\n",
                    PLC_IP.toString().c_str(), PLC_PORT);
      return false;
    }
    Serial.println("[PLC] Conectado por Modbus TCP");
  }

  transId++;
  uint8_t req[12] = {
    (uint8_t)(transId >> 8), (uint8_t)transId,
    0x00, 0x00,                 // protocolo Modbus
    0x00, 0x06,                 // bytes que siguen
    PLC_UNIT, 0x03,
    (uint8_t)(offset >> 8), (uint8_t)offset,
    (uint8_t)(cantidad >> 8), (uint8_t)cantidad
  };
  while (plc.available()) plc.read();
  plc.write(req, sizeof(req));

  uint8_t cab[9];  // MBAP (7) + función + nº bytes / código de excepción
  if (!leerExacto(cab, sizeof(cab), 2000)) {
    Serial.println("[PLC] ERROR: sin respuesta (timeout)");
    plc.stop();
    return false;
  }
  if (cab[7] == 0x83) {
    Serial.printf("[PLC] ERROR: excepción Modbus %u\n", cab[8]);
    return false;
  }
  uint16_t idResp = (cab[0] << 8) | cab[1];
  if (idResp != transId || cab[7] != 0x03 || cab[8] != cantidad * 2) {
    Serial.println("[PLC] ERROR: respuesta inesperada");
    plc.stop();
    return false;
  }

  uint8_t datos[2 * REG_COUNT];
  if (cantidad > REG_COUNT || !leerExacto(datos, cantidad * 2, 2000)) {
    Serial.println("[PLC] ERROR: datos incompletos");
    plc.stop();
    return false;
  }
  for (uint16_t i = 0; i < cantidad; i++) {
    destino[i] = (datos[2 * i] << 8) | datos[2 * i + 1];
  }
  return true;
}

// double: con float, 6.7 se serializa como 6.699999809 en el JSON
double escala10(uint16_t raw) { return (int16_t)raw / 10.0; }

// Contadores: el manual define V = UR x 32768 + LR (no es el <<16 estándar)
uint32_t boge32(const uint16_t* r, uint8_t idxL) {
  return (uint32_t)r[idxL + 1] * 32768UL + r[idxL];
}

// Alarmas y fallos son máscaras de bits: se combinan con <<16
uint32_t bitmask32(const uint16_t* r, uint8_t idxL) {
  return ((uint32_t)r[idxL + 1] << 16) | r[idxL];
}

bool leerPLC(DatosPLC& d) {
  uint16_t r[REG_COUNT];
  if (!leerRegistros(0, REG_COUNT, r)) return false;

  d.o2Pct         = escala10(r[R_AT01]);  // escala del rango 0-95 %
  d.caudal        = escala10(r[R_FT01]);
  d.presProducto  = escala10(r[R_PT01]);
  d.presAire      = escala10(r[R_PT02]);
  d.tempProducto  = escala10(r[R_TT01]);
  d.tempAire      = escala10(r[R_TT02]);
  d.rocioProducto = escala10(r[R_MT01]);
  d.rocioAire     = escala10(r[R_MT02]);
  d.horasTotales   = boge32(r, R_SERVTIME_L);
  d.horasParciales = boge32(r, R_SERVPART_L);
  d.flujoTotal     = boge32(r, R_FLOWTOTAL_L);
  d.flujoParcial   = boge32(r, R_FLOWPART_L);
  d.alarmas        = bitmask32(r, R_ALARMS_L);
  d.fallos         = bitmask32(r, R_FAULTS_L);
  for (int i = 0; i < 3; i++) d.alarmasAck[i] = r[R_ACK + i];
  for (int i = 0; i < 9; i++) d.valvulas[i] = r[R_VALVES + i];
  d.lifeBit        = r[R_LIFEBIT];
  d.estado         = r[R_ESTADO];
  return true;
}

// Mismas etiquetas que el firmware MicroPython (contrato plc_*)
const char* textoEstado(int e) {
  switch (e) {
    case 0:  return "LISTA_PARA_COMENZAR";
    case 1:  return "FUNCIONANDO";
    case 2:  return "APAGADO_EN_PROGRESO";
    case 3:  return "ESPERA_EN_PROGRESO";
    case 4:  return "ESPERA_COMPLETADA";
    case 11: return "REINICIO_AUTOMATICO_TRAS_CORTE";
    default: return "DESCONOCIDO";
  }
}

void imprimirDatos(const DatosPLC& d) {
  Serial.printf("[PLC] Estado: %d (%s)\n", d.estado, textoEstado(d.estado));
  Serial.printf("      O2 %.1f %%  Caudal %.1f Nm3/h  P.prod %.1f bar  P.aire %.1f bar\n",
                d.o2Pct, d.caudal, d.presProducto, d.presAire);
  Serial.printf("      T.prod %.1f C  T.aire %.1f C  Rocío prod %.1f C  Rocío aire %.1f C\n",
                d.tempProducto, d.tempAire, d.rocioProducto, d.rocioAire);
  Serial.printf("      Horas %lu h  Flujo total %lu Nm3  Alarmas 0x%08lX  Fallos 0x%08lX\n",
                (unsigned long)d.horasTotales, (unsigned long)d.flujoTotal,
                (unsigned long)d.alarmas, (unsigned long)d.fallos);
}

// ============================================================
// ENVÍO DE DATOS AL BACKEND
// Campos plc_*: mismo contrato que el firmware MicroPython, los guarda el
// backend y los lee SIGGAM. Los campos originales (o2_purity_pct, etc.) se
// siguen enviando para el dashboard; torres, aire médico y vacío no existen
// en este equipo. Si el PLC no responde se envía plc_online=false con el
// último dato válido (nunca ceros inventados).
// ============================================================
void sendData(bool online) {
  StaticJsonDocument<1536> doc;

  doc["action"]      = "data";
  doc["token"]       = DEVICE_TOKEN;
  doc["hospital_id"] = HOSPITAL_ID;
  doc["unit_id"]     = UNIT_ID;
  doc["unit_type"]   = UNIT_TYPE;
  doc["plc_online"]  = online;

  if (hayDatos) {
    const DatosPLC& d = ultimo;
    doc["o2_purity_pct"]        = d.o2Pct;
    doc["o2_flow_m3h"]          = d.caudal;
    doc["o2_tank_pressure_bar"] = d.presProducto;
    doc["psa_dewpoint_c"]       = d.rocioAire;
    doc["compressor_status"]    = (d.fallos & FAULT_COMPRESOR) ? "FAULT"
                                : (d.estado == 1)               ? "ON" : "OFF";
    doc["compressor_hours"]     = d.horasTotales;

    doc["plc_plant_state"]             = d.estado;
    doc["plc_plant_state_label"]       = textoEstado(d.estado);
    doc["plc_o2_content_pct"]          = d.o2Pct;
    doc["plc_gas_flow_nm3h"]           = d.caudal;
    doc["plc_gas_pressure_barg"]       = d.presProducto;
    doc["plc_air_inlet_pressure_barg"] = d.presAire;
    doc["plc_gas_temp_c"]              = d.tempProducto;
    doc["plc_air_inlet_temp_c"]        = d.tempAire;
    doc["plc_gas_dewpoint_c"]          = d.rocioProducto;
    doc["plc_air_inlet_dewpoint_c"]    = d.rocioAire;
    doc["plc_service_hours_total"]     = d.horasTotales;
    doc["plc_service_hours_partial"]   = d.horasParciales;
    doc["plc_flow_total_nm3"]          = d.flujoTotal;
    doc["plc_flow_partial_nm3"]        = d.flujoParcial;
    doc["plc_alarms"]                  = d.alarmas;
    doc["plc_faults"]                  = d.fallos;
    JsonArray ack = doc.createNestedArray("plc_alarms_ack");
    for (int i = 0; i < 3; i++) ack.add(d.alarmasAck[i]);
    JsonArray valves = doc.createNestedArray("plc_valves");
    for (int i = 0; i < 9; i++) valves.add(d.valvulas[i]);
    doc["plc_life_bit"]                = d.lifeBit;
  }

  String jsonBody;
  serializeJson(doc, jsonBody);

  Serial.println("[HTTP] Enviando payload:");
  Serial.println(jsonBody);

  // Un único cliente TLS reutilizado para POST y GET: dos contextos
  // TLS simultáneos agotan la RAM del ESP32.
  WiFiClientSecure client;
  client.setInsecure();
  client.setHandshakeTimeout(15);

  HTTPClient http;
  http.setReuse(false);
  http.setConnectTimeout(15000);
  http.setTimeout(15000);
  http.begin(client, API_URL);
  http.addHeader("Content-Type", "text/plain;charset=utf-8");
  http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);

  const char* headerKeys[] = { "Location" };
  http.collectHeaders(headerKeys, 1);

  int httpCode = http.POST(jsonBody);
  Serial.printf("[HTTP] POST código: %d\n", httpCode);

  if (httpCode == HTTP_CODE_FOUND || httpCode == HTTP_CODE_MOVED_PERMANENTLY ||
      httpCode == HTTP_CODE_SEE_OTHER || httpCode == HTTP_CODE_TEMPORARY_REDIRECT) {
    String location = http.header("Location");
    http.end();

    if (location.length() > 0) {
      HTTPClient http2;
      http2.setReuse(false);
      http2.setConnectTimeout(15000);
      http2.setTimeout(15000);
      http2.begin(client, location);
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
    Serial.printf("[HTTP] Respuesta directa: %s\n", http.getString().c_str());
    http.end();
  } else {
    Serial.printf("[HTTP] ERROR POST: %s\n", http.errorToString(httpCode).c_str());
    http.end();
  }

  Serial.printf("[MEM] Heap libre: %d bytes\n", ESP.getFreeHeap());
}
