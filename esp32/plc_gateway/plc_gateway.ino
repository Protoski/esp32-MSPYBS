/**
 * ============================================================
 * GATEWAY PLC BOGE -> BACKEND  (ESP32 dedicado, Arduino)
 * ============================================================
 *
 * ESP32 SEGUNDO Y SEPARADO del que ya lee los sensores 4-20mA/digitales
 * (ese sigue en MicroPython, sin tocar -- ver ../micropython/). Este
 * equipo tiene un unico trabajo: leer el PLC BOGE (Siemens S7-1200) por
 * Modbus TCP a traves de un modulo Ethernet ENC28J60, y reenviar esos
 * datos al mismo backend por WiFi.
 *
 * ⚠️ NO COMPILADO NI PROBADO CONTRA HARDWARE REAL. Este sandbox no tiene
 * acceso al gestor de paquetes de Arduino/PlatformIO (misma restriccion
 * de red que bloquea otros dominios externos), asi que no pude verificar
 * que compile. Revisar con cuidado antes de flashear, especialmente los
 * pines del ENC28J60 y los nombres exactos de la API de la libreria.
 *
 * Librerias requeridas (Arduino Library Manager):
 *   - EthernetENC (por Juraj Andrassy) -- driver ENC28J60 con la misma
 *     API que Ethernet.h estandar. NO usar "UIPEthernet": tiene bugs de
 *     compatibilidad conocidos en ESP32.
 *   - ArduinoJson >= 6.x (Benoit Blanchon)
 *   - WiFi.h / WiFiClientSecure.h / HTTPClient.h (incluidas en el core ESP32)
 *
 * GARANTIA DE SOLO LECTURA: la unica funcion Modbus implementada en este
 * archivo es 0x03 (Read Holding Registers). No existe codigo de escritura
 * (Write Single/Multiple Register, Write Coil) -- es imposible que este
 * firmware le envie un comando al PLC (ni start, ni stop, ni reset).
 * ============================================================
 */

#include <SPI.h>
#include <EthernetENC.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// ── CONFIGURACIÓN DE RED WIFI (hacia internet / backend) ───
const char* WIFI_SSID     = "TU_RED_WIFI";
const char* WIFI_PASSWORD = "TU_CONTRASENA_WIFI";

// ── BACKEND (Google Apps Script) ──────────────────
const char* API_URL       = "TU_URL_DE_APPS_SCRIPT";
const char* HOSPITAL_ID   = "TU_HOSPITAL_ID";
const char* DEVICE_TOKEN  = "TU_DEVICE_TOKEN";
const unsigned long SEND_INTERVAL_MS = 60000; // cada 60s, igual que el otro ESP32

// ── ENC28J60 (Ethernet dedicada, aislada, hacia el PLC) ─────
// SPI por defecto del ESP32 (VSPI): SCK=18, MISO=19, MOSI=23. Solo el CS
// es realmente "configurable" -- ajustar segun el cableado real.
#define ENC28J60_CS_PIN 5

// Direccion MAC "localmente administrada" (bit 0x02 en el primer byte) --
// cualquier valor sirve mientras sea unico en esta red aislada de 2
// dispositivos (PLC + este ESP32).
byte ETH_MAC[] = {0x02, 0x00, 0x00, 0x00, 0x00, 0x01};
IPAddress ETH_IP(100, 100, 200, 20);
IPAddress ETH_SUBNET(255, 255, 255, 0);
// Sin gateway real: la red del PLC es una isla. Se pasa la propia IP
// como "gateway" solo para satisfacer la firma de Ethernet.begin(), no
// se usa para rutear a ningun lado.
IPAddress ETH_GATEWAY(100, 100, 200, 20);
IPAddress ETH_DNS(0, 0, 0, 0);

// ── PLC BOGE (Siemens S7-1200 CPU 1214C) -- Modbus TCP ──────
IPAddress PLC_IP(100, 100, 200, 10);
const uint16_t PLC_PORT = 501;
const uint8_t  PLC_UNIT_ID = 1;
const uint16_t PLC_REGISTER_COUNT = 41; // holding registers 40001-40041
const unsigned long PLC_READ_INTERVAL_MS = 3000; // 2-5s pedido
const int PLC_MAX_RETRIES = 3;
bool PLC_DEBUG_DUMP = true; // imprime los 41 registros crudos por Serial

// ============================================================
// ESTADO DEL PLC (se conserva el ultimo dato valido ante fallos)
// ============================================================
struct PlcData {
  bool valid = false;
  float o2ContentPct = 0;
  float gasFlowNm3h = 0;
  float gasPressureBarg = 0;
  float airInletPressureBarg = 0;
  float gasTempC = 0;
  float airInletTempC = 0;
  float gasDewpointC = 0;
  float airInletDewpointC = 0;
  uint32_t serviceHoursTotal = 0;
  uint32_t serviceHoursPartial = 0;
  uint32_t flowTotalNm3 = 0;
  uint32_t flowPartialNm3 = 0;
  uint32_t alarms = 0;
  uint32_t faults = 0;
  uint16_t alarmsAck[3] = {0, 0, 0};
  uint16_t plantState = 0;
  uint16_t valves[9] = {0};
  uint16_t lifeBit = 0;
};

PlcData plcData;
bool plcOnline = false;
uint16_t lastLifeBit = 0xFFFF;
bool haveLastLifeBit = false;
int lifeBitUnchangedCycles = 0;
const int LIFE_BIT_STALE_WARN_AFTER = 5;

unsigned long lastPlcPollMs = 0;
unsigned long lastSendMs = 0;
int fallosSeguidos = 0;
const int MAX_FALLOS_SEGUIDOS = 3;

// ============================================================
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n=== Gateway PLC BOGE -> Backend ===");

  connectWiFi();

  Serial.println("[ETH] Iniciando ENC28J60...");
  Ethernet.init(ENC28J60_CS_PIN);
  Ethernet.begin(ETH_MAC, ETH_IP, ETH_DNS, ETH_GATEWAY, ETH_SUBNET);
  delay(500);
  if (Ethernet.hardwareStatus() == EthernetNoHardware) {
    Serial.println("[ETH] ERROR: no se detecto el modulo ENC28J60. Revisar cableado SPI/CS.");
  } else {
    Serial.print("[ETH] OK. IP local: ");
    Serial.println(Ethernet.localIP());
  }
}

// ============================================================
void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WiFi] Conexion perdida. Reconectando...");
    connectWiFi();
  }

  unsigned long now = millis();

  if (now - lastPlcPollMs >= PLC_READ_INTERVAL_MS) {
    lastPlcPollMs = now;
    pollPlcOnce();
  }

  if (now - lastSendMs >= SEND_INTERVAL_MS) {
    lastSendMs = now;
    sendToBackend();
  }
}

// ============================================================
// WIFI (hacia internet / backend) -- igual criterio que el otro ESP32
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
// MODBUS TCP -- SOLO LECTURA (function code 0x03)
// ============================================================
// Devuelve true si se pudo leer; llena `out` con PLC_REGISTER_COUNT
// registros. No implementa NINGUNA funcion de escritura Modbus.
bool modbusReadHoldingRegisters(uint16_t* out, uint16_t count) {
  EthernetClient client;
  if (!client.connect(PLC_IP, PLC_PORT)) {
    Serial.println("  [PLC][ERROR] no se pudo conectar (TCP connect fallo)");
    return false;
  }
  client.setTimeout(3000);

  uint8_t request[12];
  request[0] = 0x00; request[1] = 0x01; // transaction id
  request[2] = 0x00; request[3] = 0x00; // protocol id (siempre 0)
  request[4] = 0x00; request[5] = 0x06; // longitud restante (unit+fc+addr+qty)
  request[6] = PLC_UNIT_ID;
  request[7] = 0x03;                    // function code: Read Holding Registers
  request[8] = 0x00; request[9] = 0x00; // start address = 0 (registro 40001)
  request[10] = (count >> 8) & 0xFF;
  request[11] = count & 0xFF;

  client.write(request, sizeof(request));

  const uint16_t expectedLen = 9 + 2 * count; // cabecera(7) + fc+bytecount(2) + datos
  uint8_t response[9 + 2 * 41];
  uint16_t received = 0;
  unsigned long deadline = millis() + 3000;
  while (received < expectedLen && millis() < deadline) {
    if (client.available()) {
      int n = client.read(response + received, expectedLen - received);
      if (n > 0) received += n;
    } else {
      delay(5);
    }
  }
  client.stop();

  if (received < 9) {
    Serial.println("  [PLC][ERROR] respuesta vacia o incompleta del PLC");
    return false;
  }

  uint8_t functionCode = response[7];
  if (functionCode & 0x80) {
    Serial.printf("  [PLC][ERROR] PLC devolvio excepcion Modbus 0x%02X\n", response[8]);
    return false;
  }
  if (functionCode != 0x03) {
    Serial.printf("  [PLC][ERROR] function code inesperado: 0x%02X\n", functionCode);
    return false;
  }

  uint8_t byteCount = response[8];
  if (received < 9 + byteCount) {
    Serial.println("  [PLC][ERROR] datos incompletos en la respuesta");
    return false;
  }

  for (uint16_t i = 0; i < count; i++) {
    out[i] = (response[9 + i * 2] << 8) | response[10 + i * 2];
  }
  return true;
}

// ============================================================
// DECODIFICACION -- mapa de registros confirmado con documentacion BOGE
// ============================================================
static inline int16_t asSigned16(uint16_t v) {
  return (int16_t)v; // reinterpretacion bit a bit, complemento a 2
}

// Formula propia de BOGE para valores de 32 bits (NO es el shift <<16
// estandar): validada empiricamente contra una lectura real (8379 h de
// servicio, 91965 Nm3 de totalizador).
static inline uint32_t boge32(uint16_t low, uint16_t high) {
  return (uint32_t)high * 32768UL + (uint32_t)low;
}

// Alarmas/fallos son mascaras de bits, no contadores: se combinan con el
// shift estandar de 16 bits.
static inline uint32_t bitmask32(uint16_t low, uint16_t high) {
  return ((uint32_t)high << 16) | low;
}

void decodePlcRegisters(const uint16_t* r, PlcData& d) {
  d.o2ContentPct          = r[0]  * 0.1f; // escala sin confirmar, ver README
  d.gasFlowNm3h           = r[1]  * 0.1f;
  d.gasPressureBarg       = r[2]  * 0.1f;
  d.airInletPressureBarg  = r[3]  * 0.1f;
  d.gasTempC              = asSigned16(r[4]) * 0.1f;
  d.airInletTempC         = asSigned16(r[5]) * 0.1f;
  d.gasDewpointC          = asSigned16(r[6]) * 0.1f;
  d.airInletDewpointC     = asSigned16(r[7]) * 0.1f;
  // r[8..10] (registros 40009-40011): no documentados, se ignoran
  d.serviceHoursTotal     = boge32(r[11], r[12]);
  d.serviceHoursPartial   = boge32(r[13], r[14]);
  d.flowTotalNm3          = boge32(r[15], r[16]);
  d.flowPartialNm3        = boge32(r[17], r[18]);
  d.alarms                = bitmask32(r[19], r[20]);
  d.faults                = bitmask32(r[21], r[22]);
  d.alarmsAck[0] = r[23]; d.alarmsAck[1] = r[24]; d.alarmsAck[2] = r[25];
  d.plantState            = r[26];
  for (int i = 0; i < 9; i++) d.valves[i] = r[27 + i];
  // r[36..39] (registros 40037-40040): no documentados, se ignoran
  d.lifeBit               = r[40];
  d.valid = true;
}

const char* plantStateLabel(uint16_t code) {
  switch (code) {
    case 0:  return "LISTA_PARA_COMENZAR";
    case 1:  return "FUNCIONANDO";
    case 2:  return "APAGADO_EN_PROGRESO";
    case 3:  return "ESPERA_EN_PROGRESO";
    case 4:  return "ESPERA_COMPLETADA";
    case 11: return "REINICIO_AUTOMATICO_TRAS_CORTE";
    default: return "DESCONOCIDO";
  }
}

// ============================================================
// CICLO DE LECTURA DEL PLC -- reintentos con espera progresiva.
// Ante fallo total, NO se fabrican valores: se conserva el ultimo dato
// valido y se marca plcOnline=false (separado del estado de seguridad
// real de la planta, que reporta el propio PLC via alarms/faults).
// ============================================================
void pollPlcOnce() {
  static uint16_t raw[PLC_REGISTER_COUNT];
  int backoffMs = 1000;

  for (int attempt = 0; attempt <= PLC_MAX_RETRIES; attempt++) {
    if (modbusReadHoldingRegisters(raw, PLC_REGISTER_COUNT)) {
      PlcData nuevo;
      decodePlcRegisters(raw, nuevo);
      plcData = nuevo;
      plcOnline = true;

      if (PLC_DEBUG_DUMP) {
        Serial.print("  [PLC] registros crudos 40001-40041:");
        for (int i = 0; i < PLC_REGISTER_COUNT; i++) Serial.printf(" %u", raw[i]);
        Serial.println();
      }

      if (haveLastLifeBit && lastLifeBit == plcData.lifeBit) {
        lifeBitUnchangedCycles++;
        if (lifeBitUnchangedCycles == LIFE_BIT_STALE_WARN_AFTER) {
          Serial.printf("  [PLC][AVISO] life bit sin cambios en %d lecturas -- "
                        "verificar que el programa del PLC siga corriendo\n",
                        lifeBitUnchangedCycles);
        }
      } else {
        lifeBitUnchangedCycles = 0;
      }
      lastLifeBit = plcData.lifeBit;
      haveLastLifeBit = true;
      return;
    }

    Serial.printf("  [PLC][ERROR] intento %d/%d fallo\n", attempt + 1, PLC_MAX_RETRIES + 1);
    if (attempt < PLC_MAX_RETRIES) {
      delay(backoffMs);
      backoffMs = min(backoffMs * 2, 10000);
    }
  }

  plcOnline = false;
  if (!plcData.valid) {
    Serial.println("  [PLC][ERROR] sin datos del PLC todavia -- se omiten campos plc_* de este envio");
  } else {
    Serial.println("  [PLC][ERROR] PLC no responde -- se reenvian los ultimos datos validos marcados como plc_online=false");
  }
}

// ============================================================
// ENVIO AL BACKEND (Google Apps Script) -- mismo mecanismo HTTP que el
// otro ESP32 (redirect 302 seguido manualmente con GET).
// ============================================================
void sendToBackend() {
  StaticJsonDocument<768> doc;
  doc["action"]      = "data";
  doc["token"]       = DEVICE_TOKEN;
  doc["hospital_id"] = HOSPITAL_ID;
  doc["plc_online"]  = plcOnline;

  if (plcData.valid) {
    doc["plc_o2_content_pct"]          = plcData.o2ContentPct;
    doc["plc_gas_flow_nm3h"]           = plcData.gasFlowNm3h;
    doc["plc_gas_pressure_barg"]       = plcData.gasPressureBarg;
    doc["plc_air_inlet_pressure_barg"] = plcData.airInletPressureBarg;
    doc["plc_gas_temp_c"]              = plcData.gasTempC;
    doc["plc_air_inlet_temp_c"]        = plcData.airInletTempC;
    doc["plc_gas_dewpoint_c"]          = plcData.gasDewpointC;
    doc["plc_air_inlet_dewpoint_c"]    = plcData.airInletDewpointC;
    doc["plc_service_hours_total"]     = plcData.serviceHoursTotal;
    doc["plc_service_hours_partial"]   = plcData.serviceHoursPartial;
    doc["plc_flow_total_nm3"]          = plcData.flowTotalNm3;
    doc["plc_flow_partial_nm3"]        = plcData.flowPartialNm3;
    doc["plc_alarms"]                  = plcData.alarms;
    doc["plc_faults"]                  = plcData.faults;
    doc["plc_plant_state"]             = plcData.plantState;
    doc["plc_plant_state_label"]       = plantStateLabel(plcData.plantState);
    JsonArray valves = doc.createNestedArray("plc_valves");
    for (int i = 0; i < 9; i++) valves.add(plcData.valves[i]);
    JsonArray ack = doc.createNestedArray("plc_alarms_ack");
    for (int i = 0; i < 3; i++) ack.add(plcData.alarmsAck[i]);
    doc["plc_life_bit"] = plcData.lifeBit;
  }

  String jsonBody;
  serializeJson(doc, jsonBody);
  Serial.println("[HTTP] Enviando payload:");
  Serial.println(jsonBody);

  // Mismo patron que plant_monitor.ino: Google Apps Script responde al
  // POST con un redirect 302 que hay que seguir manualmente con GET.
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

  const char* headerKeys[] = {"Location"};
  http.collectHeaders(headerKeys, 1);

  int httpCode = http.POST(jsonBody);
  Serial.printf("[HTTP] POST codigo: %d\n", httpCode);

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
        fallosSeguidos = 0;
      } else {
        Serial.printf("[HTTP] ERROR GET: %s\n", http2.errorToString(code2).c_str());
        fallosSeguidos++;
      }
      http2.end();
    }
  } else if (httpCode > 0) {
    Serial.printf("[HTTP] Respuesta directa: %s\n", http.getString().c_str());
    http.end();
    fallosSeguidos = 0;
  } else {
    Serial.printf("[HTTP] ERROR POST: %s\n", http.errorToString(httpCode).c_str());
    http.end();
    fallosSeguidos++;
  }

  if (fallosSeguidos >= MAX_FALLOS_SEGUIDOS) {
    Serial.println("[RESET] demasiados fallos de envio seguidos, reiniciando la placa");
    delay(1000);
    ESP.restart();
  }

  Serial.printf("[MEM] Heap libre: %d bytes\n", ESP.getFreeHeap());
}
