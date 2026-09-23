/**
 * Diagnostico ENC28J60 <-> ESP32 (sin librerias de red)
 * Lee registros del chip por SPI para comprobar cableado y alimentacion.
 * Mismo cableado que plant_monitor.ino: SCK=18, SO=19, SI=23, CS=5, RESET=27
 */

#include <SPI.h>

const int PIN_SCK  = 18;
const int PIN_MISO = 19;
const int PIN_MOSI = 23;
const int PIN_CS   = 5;
const int PIN_RST  = 27;

SPISettings spiCfg(1000000, MSBFIRST, SPI_MODE0);

uint8_t leerCtrl(uint8_t reg, bool dummy = false) {
  SPI.beginTransaction(spiCfg);
  digitalWrite(PIN_CS, LOW);
  SPI.transfer(0x00 | (reg & 0x1F));
  if (dummy) SPI.transfer(0x00);  // registros MAC/MII devuelven un byte basura primero
  uint8_t v = SPI.transfer(0x00);
  digitalWrite(PIN_CS, HIGH);
  SPI.endTransaction();
  return v;
}

void escribirOp(uint8_t op, uint8_t reg, uint8_t dato) {
  SPI.beginTransaction(spiCfg);
  digitalWrite(PIN_CS, LOW);
  SPI.transfer(op | (reg & 0x1F));
  SPI.transfer(dato);
  digitalWrite(PIN_CS, HIGH);
  SPI.endTransaction();
}

void banco(uint8_t b) {
  escribirOp(0xA0, 0x1F, 0x03);  // limpia BSEL en ECON1
  escribirOp(0x80, 0x1F, b);     // fija BSEL
}

uint16_t leerPhy(uint8_t reg) {
  banco(2);
  escribirOp(0x40, 0x14, reg);   // MIREGADR
  escribirOp(0x40, 0x12, 0x01);  // MICMD = MIIRD
  banco(3);
  unsigned long t0 = millis();
  while ((leerCtrl(0x0A, true) & 0x01) && millis() - t0 < 50) {}  // MISTAT.BUSY
  banco(2);
  escribirOp(0x40, 0x12, 0x00);
  uint8_t lo = leerCtrl(0x18, true);  // MIRDL
  uint8_t hi = leerCtrl(0x19, true);  // MIRDH
  return (hi << 8) | lo;
}

void setup() {
  Serial.begin(115200);
  delay(400);
  Serial.println("\n=== Diagnostico ENC28J60 ===");

  pinMode(PIN_CS, OUTPUT);
  digitalWrite(PIN_CS, HIGH);
  pinMode(PIN_RST, OUTPUT);
  digitalWrite(PIN_RST, LOW);
  delay(60);
  digitalWrite(PIN_RST, HIGH);
  delay(50);

  SPI.begin(PIN_SCK, PIN_MISO, PIN_MOSI, PIN_CS);

  SPI.beginTransaction(spiCfg);  // reset por software
  digitalWrite(PIN_CS, LOW);
  SPI.transfer(0xFF);
  digitalWrite(PIN_CS, HIGH);
  SPI.endTransaction();
  delay(20);
}

void loop() {
  uint8_t estat = leerCtrl(0x1D);
  banco(3);
  uint8_t rev = leerCtrl(0x12);  // EREVID
  uint16_t phstat2 = leerPhy(0x11);
  bool link = phstat2 & (1 << 10);

  Serial.printf("ESTAT=0x%02X  EREVID=0x%02X  PHSTAT2=0x%04X\n", estat, rev, phstat2);

  if (rev == 0x00 && estat == 0x00) {
    Serial.println("-> Todo 0x00: SO(MISO) desconectado, chip sin alimentacion o GND sin conectar.");
  } else if (rev == 0xFF && estat == 0xFF) {
    Serial.println("-> Todo 0xFF: revisa CS(GPIO5), SCK(GPIO18) y SI(GPIO23); puede que SO/SI esten cruzados.");
  } else if (!(estat & 0x01)) {
    Serial.println("-> El chip responde pero su oscilador no arranca (CLKRDY=0): alimentacion insuficiente.");
  } else {
    Serial.printf("-> Chip OK (revision 0x%02X). Cable de red: %s\n",
                  rev, link ? "ENLACE ACTIVO" : "SIN ENLACE (revisa cable/router)");
  }
  delay(2000);
}
