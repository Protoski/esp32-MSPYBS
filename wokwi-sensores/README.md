# Demo Wokwi: Acondicionamiento de sensores 4-20mA y 0-10V para ESP32

## Cómo probarlo en Wokwi

1. Ve a https://wokwi.com/projects/new/esp32
2. En el editor, abre el archivo `diagram.json` y reemplaza su contenido por el de este `diagram.json`.
3. Abre `sketch.ino` y reemplaza su contenido por el de este `sketch.ino`.
4. Dale a "Start simulation".
5. Mueve los potenciómetros (representan la salida del transmisor) y observa
   en el Monitor Serie cómo cambian la presión (bar) y la pureza de O2 (%).

## Circuitos representados

### Sensor 1 — Transmisor de presión 4-20mA (ADC34)
```
Lazo 4-20mA --[ Shunt 250Ω ]-- GND
                   |
                (1-5V)
                   |
        R1=10kΩ ---+--- R2=20kΩ
                   |
                 ADC34  (0-3.33V)
```

### Sensor 2 — Transmisor de pureza O2 0-10V (ADC35)
```
Salida 0-10V
      |
R3=6.8kΩ --+-- R4=3.3kΩ
           |
         ADC35  (0-3.27V)
```

## Notas importantes para el circuito real

- **Verifica siempre el voltaje máximo en el ADC**: nunca debe superar 3.3V (idealmente
  diseña para ~3.0V máx. para dejar margen y proteger el pin).
- Para mayor precisión, usa resistencias de **1% de tolerancia** en los divisores.
- En el lazo 4-20mA, la resistencia shunt debe ser de **precisión (≥0.1%)** porque
  cualquier error se traduce directamente en error de medición.
- Si el ESP32 y el transmisor industrial no comparten la misma referencia de tierra
  (GND), considera un **aislador/optoacoplador** o un convertidor 4-20mA → I2C/UART
  (ej. módulos con ADS1115) para evitar lazos de tierra y daños al ESP32.
- Las funciones `readTowerAPressure()` y `readO2Purity()` de `sketch.ino` están
  listas para reemplazar las versiones simuladas (`random(...)`) en
  `esp32/plant_monitor.ino`, ajustando los pines y los rangos de ingeniería
  (`PRESSURE_MAX_BAR`, etc.) según cada sensor real.
