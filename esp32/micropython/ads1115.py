"""Driver minimo para el ADC ADS1115 (16 bits, I2C), lectura single-ended."""

_CONVERSION = 0x00
_CONFIG = 0x01

# PGA: rango de entrada +-4.096V. Con resistencia shunt de 150 ohm,
# 4-20mA cae en 0.6V-3.0V, bien dentro de este rango con margen.
_PGA_4_096V = 0x01

_MUX_SINGLE = {0: 0x04, 1: 0x05, 2: 0x06, 3: 0x07}
_DR_128SPS = 0x04

LSB_VOLTS = 4.096 / 32768  # volts por cuenta, para PGA +-4.096V


class ADS1115:
    def __init__(self, i2c, address=0x48):
        self.i2c = i2c
        self.address = address

    def read_voltage(self, channel):
        if channel not in (0, 1, 2, 3):
            raise ValueError("canal debe ser 0-3")
        config = 0x8000
        config |= _MUX_SINGLE[channel] << 12
        config |= _PGA_4_096V << 9
        config |= 1 << 8  # single-shot
        config |= _DR_128SPS << 5
        config |= 0x0003  # deshabilita el comparador
        self.i2c.writeto_mem(self.address, _CONFIG, config.to_bytes(2, "big"))
        # conversion tarda ~8ms a 128SPS, esperamos con margen
        import time
        time.sleep_ms(10)
        raw = self.i2c.readfrom_mem(self.address, _CONVERSION, 2)
        value = int.from_bytes(raw, "big")
        if value > 32767:
            value -= 65536
        return value * LSB_VOLTS
