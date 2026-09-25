// Configuración de ESTE equipo. Copia como equipo.h en la carpeta del sketch,
// o genérala con: python3 tools/equipos/equipos.py generar-plc ...
#pragma once

// id del hospital = sensorMspbsId de SIGGAM (el mismo en todos sus equipos)
const char* HOSPITAL_ID = "PONER_ID_DEL_HOSPITAL";
// Equipo dentro del hospital: O2-1, O2-2, VAC-1...
const char* UNIT_ID     = "O2-1";
// "o2", "air" o "vacuum"
const char* UNIT_TYPE   = "o2";

// Opcional: último número de la IP del ESP32 en la red del PLC (100.100.200.X).
// Cambiar solo si varios ESP32 comparten el mismo switch.
// #define ETH_IP_LAST_OCTET 50
// Opcional: último número de la IP del PLC (de fábrica 10).
// #define PLC_IP_LAST_OCTET 10
