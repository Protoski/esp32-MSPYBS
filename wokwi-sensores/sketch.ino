/**
 * ============================================================
 * DEMO Wokwi: Acondicionamiento de señales de sensores
 * industriales para entradas ADC del ESP32 (0-3.3V)
 * ============================================================
 *
 * SENSOR 1 - Presión Torre A (transmisor 4-20mA)
 *   Pin ADC34
 *   Circuito real:
 *     Lazo 4-20mA -> resistencia shunt 250ohm -> 1-5V
 *     Divisor resistivo R1=10k / R2=20k -> escala a 0-3.3V
 *     (factor = R2/(R1+R2) = 0.667)
 *
 * SENSOR 2 - Pureza de O2 (transmisor 0-10V)
 *   Pin ADC35
 *   Circuito real:
 *     Salida 0-10V -> divisor resistivo R3=6.8k / R4=3.3k
 *     -> escala a 0-3.3V (factor = R4/(R3+R4) = 0.327)
 *
 * En la simulación de Wokwi los potenciómetros representan la
 * señal de salida del transmisor (ya convertida a tensión),
 * y los resistores R1-R4 son el divisor real que va antes del
 * pin ADC del ESP32.
 * ============================================================
 */

const int PIN_PRESSURE_A = 34;
const int PIN_O2_PURITY  = 35;

const float ADC_VREF = 3.3f;
const float ADC_MAX  = 4095.0f;

// Resistencia shunt del lazo 4-20mA (Ω)
const float SHUNT_OHMS = 250.0f;

// Divisores resistivos (deben coincidir con diagram.json)
const float DIV1_RATIO = 20000.0f / (10000.0f + 20000.0f); // Sensor 1: R2/(R1+R2)
const float DIV2_RATIO = 3300.0f  / (6800.0f  + 3300.0f);  // Sensor 2: R4/(R3+R4)

// Rango de ingeniería del transmisor de presión (4-20mA -> 0..PRESSURE_MAX_BAR)
const float PRESSURE_MAX_BAR = 10.0f;

void setup() {
  Serial.begin(115200);
  delay(300);

  analogReadResolution(12);          // 0-4095
  analogSetAttenuation(ADC_11db);    // rango completo ~0-3.3V

  Serial.println("=== Demo lectura sensores industriales ===");
}

void loop() {
  float presionBar = readTowerAPressure();
  float purezaPct  = readO2Purity();

  Serial.printf("Presion Torre A: %.2f bar | Pureza O2: %.2f %%\n",
                presionBar, purezaPct);

  delay(1000);
}

// ============================================================
// Sensor 4-20mA -> bar
// ============================================================
float readTowerAPressure() {
  int raw = analogRead(PIN_PRESSURE_A);
  float vAdc = (raw / ADC_MAX) * ADC_VREF;

  // Deshacer el divisor para obtener la tensión real sobre el shunt (1-5V)
  float vLoop = vAdc / DIV1_RATIO;

  // Tensión sobre 250ohm -> corriente del lazo (mA)
  float mA = (vLoop / SHUNT_OHMS) * 1000.0f;
  mA = constrain(mA, 4.0f, 20.0f);

  // Escalado lineal 4-20mA -> 0..PRESSURE_MAX_BAR
  float bar = (mA - 4.0f) / 16.0f * PRESSURE_MAX_BAR;
  return bar;
}

// ============================================================
// Sensor 0-10V -> %
// ============================================================
float readO2Purity() {
  int raw = analogRead(PIN_O2_PURITY);
  float vAdc = (raw / ADC_MAX) * ADC_VREF;

  // Deshacer el divisor para obtener la tensión real del sensor (0-10V)
  float vSensor = vAdc / DIV2_RATIO;
  vSensor = constrain(vSensor, 0.0f, 10.0f);

  // Escalado lineal 0-10V -> 0-100%
  float pct = (vSensor / 10.0f) * 100.0f;
  return pct;
}
