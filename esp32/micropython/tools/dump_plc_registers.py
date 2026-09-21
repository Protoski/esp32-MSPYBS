#!/usr/bin/env python3
"""
Herramienta de diagnostico: lee los holding registers 40001-40041 del PLC
BOGE (Modbus TCP) y los imprime crudos, para poder compararlos contra el
HMI/tablero del PLC y calibrar el mapeo en config.py (plc_registers).

SOLO LECTURA: usa la misma logica de modbus_tcp.py (function code 0x03),
no escribe nada al PLC.

Uso (Python 3 normal, sin dependencias):
    python3 dump_plc_registers.py --ip 100.100.200.10 --port 501 --unit 1

Con --watch repite la lectura cada N segundos (Ctrl+C para salir), util
para ver los registros cambiar en vivo mientras se opera el PLC.
"""

import argparse
import socket
import time

READ_HOLDING_REGISTERS = 0x03


def read_holding_registers(ip, port, unit_id, start_addr, quantity, timeout_s=5):
    transaction_id = 1
    pdu = (
        bytes([READ_HOLDING_REGISTERS])
        + start_addr.to_bytes(2, "big")
        + quantity.to_bytes(2, "big")
    )
    mbap = (
        transaction_id.to_bytes(2, "big")
        + (0).to_bytes(2, "big")
        + (len(pdu) + 1).to_bytes(2, "big")
        + bytes([unit_id])
    )
    request = mbap + pdu

    with socket.create_connection((ip, port), timeout=timeout_s) as sock:
        sock.sendall(request)
        expected_len = 7 + 2 + 2 * quantity
        chunks = []
        received = 0
        while received < expected_len:
            chunk = sock.recv(expected_len - received)
            if not chunk:
                break
            chunks.append(chunk)
            received += len(chunk)
        response = b"".join(chunks)

    if len(response) < 9:
        raise RuntimeError(f"respuesta vacia o incompleta ({len(response)} bytes)")

    function_code = response[7]
    if function_code & 0x80:
        raise RuntimeError(f"PLC devolvio excepcion Modbus 0x{response[8]:02X}")
    if function_code != READ_HOLDING_REGISTERS:
        raise RuntimeError(f"function code inesperado: 0x{function_code:02X}")

    byte_count = response[8]
    data = response[9:9 + byte_count]
    return [int.from_bytes(data[i:i + 2], "big") for i in range(0, byte_count, 2)]


def show(registers, start_reg=40001):
    print(f"{'Registro':<10} {'Offset':<8} {'Sin signo':<12} {'Con signo':<12} {'Hex':<8}")
    for i, val in enumerate(registers):
        signed = val - 0x10000 if val >= 0x8000 else val
        print(f"{start_reg + i:<10} {i:<8} {val:<12} {signed:<12} 0x{val:04X}")


def main():
    parser = argparse.ArgumentParser(description="Volcado de registros Modbus del PLC BOGE.")
    parser.add_argument("--ip", default="100.100.200.10")
    parser.add_argument("--port", type=int, default=501)
    parser.add_argument("--unit", type=int, default=1)
    parser.add_argument("--start", type=int, default=0, help="offset 0-based (40001 -> 0)")
    parser.add_argument("--count", type=int, default=41)
    parser.add_argument("--watch", type=float, default=0, help="repetir cada N segundos")
    args = parser.parse_args()

    while True:
        try:
            registers = read_holding_registers(args.ip, args.port, args.unit, args.start, args.count)
            print(f"\n--- {time.strftime('%H:%M:%S')} ---")
            show(registers, start_reg=40001 + args.start)
        except Exception as e:
            print(f"ERROR: {e}")

        if args.watch <= 0:
            break
        time.sleep(args.watch)


if __name__ == "__main__":
    main()
