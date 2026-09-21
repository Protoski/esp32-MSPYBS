"""Interfaz Ethernet dedicada (W5500 por SPI) para llegar a la red aislada
del PLC BOGE.

Se mantiene COMPLETAMENTE separada de la conexion WiFi: WiFi sigue
llevando el trafico a internet (Google Apps Script); esta interfaz solo
sabe llegar a la subred 100.100.200.0/24 donde vive el PLC. MicroPython
soporta varias interfaces de red activas al mismo tiempo -- el socket
hacia el PLC se enruta solo, porque es la unica interfaz que conoce esa
subred (a proposito no se configura gateway: la red del PLC es una isla,
no debe poder salir a ningun lado mas que al propio ESP32).

⚠️ No hay forma de probar este archivo sin el hardware real (modulo W5500
+ ESP32 fisicos). Los pines de SPI/CS/RST en config.py son un ejemplo
razonable, pero hay que confirmarlos contra el cableado real antes de
subir el firmware.
"""

_nic = None


def start(cfg):
    """Activa el W5500 con IP estatica y sin gateway/DNS. Devuelve el
    objeto NIC (network.WIZNET5K) para poder consultar su estado despues."""
    global _nic
    from machine import Pin, SPI
    import network

    spi = SPI(
        cfg["eth_spi_id"],
        baudrate=cfg.get("eth_baudrate", 2_000_000),
        sck=Pin(cfg["eth_pin_sck"]),
        mosi=Pin(cfg["eth_pin_mosi"]),
        miso=Pin(cfg["eth_pin_miso"]),
    )
    cs_pin = Pin(cfg["eth_pin_cs"], Pin.OUT)

    rst_pin_num = cfg.get("eth_pin_rst")
    if rst_pin_num is not None:
        nic = network.WIZNET5K(spi, cs_pin, Pin(rst_pin_num, Pin.OUT))
    else:
        nic = network.WIZNET5K(spi, cs_pin)

    nic.active(True)
    # Sin gateway ni DNS ("0.0.0.0"): esta red no debe rutear a ningun lado,
    # solo hablar Modbus TCP directo con el PLC.
    nic.ifconfig((cfg["eth_esp32_ip"], cfg["eth_esp32_mask"], "0.0.0.0", "0.0.0.0"))

    _nic = nic
    return nic


def is_linked():
    """True si el link fisico Ethernet esta activo (cable conectado, switch
    encendido). No implica que el PLC responda Modbus, solo que hay
    conectividad de capa fisica."""
    if _nic is None:
        return False
    try:
        return bool(_nic.isconnected())
    except Exception:
        return False


def ifconfig():
    if _nic is None:
        return None
    try:
        return _nic.ifconfig()
    except Exception:
        return None
