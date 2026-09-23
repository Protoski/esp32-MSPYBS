"""Cliente Modbus TCP minimo, SOLO LECTURA.

Implementa unicamente la funcion 0x03 (Read Holding Registers). A proposito
no existe en este archivo ninguna funcion de escritura (Write Single/Multiple
Register, Write Coil, etc.): es la garantia de diseno de que este gateway
JAMAS pueda enviarle un comando al PLC, solo leer sus registros.

No depende de librerias externas, solo del modulo `socket` (disponible
tanto en MicroPython como en CPython, asi que tambien sirve para probar
esto en una PC contra un simulador Modbus antes de subirlo a la placa).
"""

import socket

_READ_HOLDING_REGISTERS = 0x03
_MBAP_HEADER_LEN = 7  # transaction(2) + protocol(2) + length(2) + unit_id(1)


class ModbusError(Exception):
    pass


def read_holding_registers(ip, port, unit_id, start_addr, quantity, timeout_s=5):
    """Lee `quantity` holding registers desde `start_addr` (offset 0-based).

    Para el registro Modicon "40001" usar start_addr=0 (40001 - 40001 = 0).
    Devuelve una lista de `quantity` enteros sin signo de 16 bits.
    """
    if not (1 <= quantity <= 125):
        raise ValueError("quantity debe estar entre 1 y 125")

    transaction_id = 1
    pdu = (
        bytes([_READ_HOLDING_REGISTERS])
        + start_addr.to_bytes(2, "big")
        + quantity.to_bytes(2, "big")
    )
    mbap = (
        transaction_id.to_bytes(2, "big")
        + (0).to_bytes(2, "big")            # protocol id, siempre 0 para Modbus
        + (len(pdu) + 1).to_bytes(2, "big")  # longitud restante: unit_id + pdu
        + bytes([unit_id])
    )
    request = mbap + pdu

    addr = socket.getaddrinfo(ip, port)[0][-1]
    sock = socket.socket()
    sock.settimeout(timeout_s)
    try:
        sock.connect(addr)
        sock.write(request)

        expected_len = _MBAP_HEADER_LEN + 2 + 2 * quantity  # header + fc+bytecount + datos
        chunks = []
        received = 0
        while received < expected_len:
            chunk = sock.read(expected_len - received)
            if not chunk:
                break
            chunks.append(chunk)
            received += len(chunk)
        response = b"".join(chunks)
    finally:
        sock.close()

    if len(response) < _MBAP_HEADER_LEN + 2:
        raise ModbusError("respuesta vacia o incompleta del PLC (%d bytes)" % len(response))

    function_code = response[7]
    if function_code & 0x80:
        exception_code = response[8] if len(response) > 8 else -1
        raise ModbusError("PLC devolvio excepcion Modbus 0x%02X" % exception_code)
    if function_code != _READ_HOLDING_REGISTERS:
        raise ModbusError("function code inesperado en la respuesta: 0x%02X" % function_code)

    byte_count = response[8]
    data = response[9:9 + byte_count]
    if len(data) < byte_count:
        raise ModbusError(
            "datos incompletos (esperados %d bytes, recibidos %d)" % (byte_count, len(data))
        )

    registers = []
    for i in range(0, byte_count, 2):
        registers.append((data[i] << 8) | data[i + 1])
    return registers
