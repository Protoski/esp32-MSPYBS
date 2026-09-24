# Contexto del proyecto MSPYBS — Monitor de plantas de gases medicinales

Instrucciones y contexto para Claude Code. Responder en español. El repositorio es
público: nunca escribir aquí ni en commits contraseñas WiFi, `ADMIN_TOKEN`,
`DEVICE_TOKEN` ni la URL de implementación de Apps Script.

## Arquitectura

```
PLC Siemens S7-1200 (generador O2 BOGE) --Modbus TCP / cable LAN--> ENC28J60 --SPI--> ESP32
ESP32 --WiFi / HTTPS--> Google Apps Script (backend/google-apps-script.js) --> Google Sheets
Dashboard Next.js (frontend/, Vercel: esp32-mspybs.vercel.app) <-- GET Apps Script
SIGGAM (sistema externo del MSPBS) <-- GET Apps Script (backend/API.md)
Servidor MCP (mcp-server/) <-- Claude Code local del usuario
```

- Un hospital puede tener **varios equipos** (varias plantas de O2 BOGE, compresores,
  bombas de vacío), **cada uno con su propio ESP32**. Todos usan el mismo
  `HOSPITAL_ID` y se distinguen por `UNIT_ID` (`O2-1`, `O2-2`, `VAC-1`…) y
  `UNIT_TYPE` (`o2` | `air` | `vacuum`).
- El `id` del hospital es el `sensorMspbsId` de SIGGAM (uno por hospital, no por
  equipo). No cambia nunca después de creado.

## Hardware

- Módulo Ethernet: **ENC28J60** con conector HanRun HR911105A (no es W5500).
  Librería Arduino **EthernetENC** (Juraj Andrassy).
- Cableado ENC28J60 → ESP32: VCC→3V3 (nunca 5V), GND→GND, SCK→18, SI→23, SO→19,
  CS→5, RESET→27, INT→26 (opcional), CLKOUT y WOL sin conectar.
- Red del PLC (sin DHCP): PLC `100.100.200.10:501`, Modbus nodo 1; ESP32 con IP
  fija `100.100.200.50`, máscara /24. Registros 40001–40041 (manual BOGE HMI
  S7-1200 596.1430.04, págs. 42 y 51-55). Contadores de 32 bits con la fórmula de
  BOGE `UR*32768+LR`; alarmas y fallos como máscara `(UR<<16)|LR`.
- Diagnóstico de cableado SPI: `esp32/diagnostico_enc28j60/`.

## Firmware

- `esp32/plant_monitor.ino`: pasarela PLC → backend (Arduino). Envía los campos
  originales más el contrato `plc_*` (mismo que `esp32/micropython/`), `unit_id`,
  `unit_type` y `token`. Si el PLC no responde envía `plc_online:false` con el
  último dato válido; nunca inventa ceros.
- `HOSPITAL_ID`, `UNIT_ID`, `UNIT_TYPE` están en el `.ino`; WiFi, `API_URL` y
  `DEVICE_TOKEN` en `secrets.h` (ignorado por git, plantilla `secrets.example.h`).
- Arduino compila todos los `.ino` de una carpeta: **una carpeta por ESP32**, con un
  solo `.ino` del mismo nombre que la carpeta más su `secrets.h`
  (p. ej. `~/Escritorio/luque_O2_1/luque_O2_1.ino`).
- Monitor serie a 115200. La placa se flashea desde el PC del usuario (Arduino IDE
  o arduino-cli con Claude Code local); la sesión en la nube no tiene USB.

## Backend (Apps Script)

- Hoja `Registros`: columnas A–N originales; desde la O, `plc_*` y luego
  `unit_id`, `unit_type` (se añaden solas en el primer envío).
- `latest_all`: una fila por hospital (resumen de sus equipos en línea: peor
  pureza entre las plantas que producen, caudal total, peor aire y vacío) más
  `units[]` con la última lectura de cada equipo. `data` acepta `unit_id`.
- `add_hospital` rechaza id repetido o mismo nombre+ciudad (sin mayúsculas,
  tildes ni espacios).
- Tokens en Propiedades del script: `ADMIN_TOKEN` (PIN del panel web y del MCP) y
  `DEVICE_TOKEN` (ESP32).
- El código en el repo tiene `SHEET_ID` de ejemplo. Para publicar: pegar el
  código conservando el `SHEET_ID` real y usar **Implementar → Gestionar
  implementaciones → Editar → Nueva versión** (no "Nueva implementación", que
  cambia la URL).
- Hay dos implementaciones activas que escriben en la misma hoja: la nueva, con
  token (la que usan Vercel y los ESP32 actualizados), y una antigua sin token
  (URL terminada en `...PYidcn/exec`). Archivar la antigua cuando ningún equipo
  la use.

## Dashboard

- La pureza solo se evalúa si el generador está produciendo
  (`plc_plant_state == 1` y `plc_online != false`); detenido no es alarma.
- Las alertas de aire y vacío respetan los equipos configurados del hospital.
- Las plantas con PLC muestran estado del generador, presiones, temperaturas,
  puntos de rocío, horas y flujo total (el PLC BOGE no mide torres PSA).

## MCP (`mcp-server/`)

Herramientas: `list_plants_status`, `get_plant_status`, `check_hospitals`
(duplicados por nombre parecido e IDs dudosos), `create_hospital` (bloquea
nombres parecidos salvo `confirm_different`), `merge_hospitals` (dry run por
defecto; conserva uno y desactiva el otro, nunca borra). Variables
`MSPYBS_API_URL` y `MSPYBS_ADMIN_TOKEN` en la config local del cliente. En
Claude Code usar Sonnet si Opus da falsos positivos de seguridad.

## Hospitales conocidos (ids = sensorMspbsId de SIGGAM)

| Hospital | id | Notas |
|---|---|---|
| Hospital General de Luque | `ef03e0fd-2814-4503-909e-c650fc01390f` | Creado el 24-09-2026, sin ID previo en SIGGAM (hay que cargarlo allí). 2 plantas BOGE: `O2-1` conectada; `O2-2` pendiente |
| Hospital Nacional de Itauguá | `247957b8-c92e-44f7-8858-819515a14731` | Era el `HOSPITAL_ID` por defecto del firmware: las lecturas de prueba del PLC de septiembre 2026 quedaron con este id aunque son de la planta de Luque |
| INERAM (nombre largo) | `08a38b2c-ffd6-49d1-ad1b-f4faf85f6c64` | Conservar. Duplicado corto a desactivar: `abfbc9d2-…` |
| Hospital Básico de Guarambaré | `d699169a-a517-4489-bf79-4dc1ba9f21f7` | Conservar. Duplicado corto: `6678668d-…` |
| Hospital Regional de Mariscal Estigarribia | `574a7042-5f62-4e71-9fc5-45bfdc163e0…` | Conservar. Duplicado corto: `20ec1f4d-…`. Confirmar el id completo con SIGGAM (en `provision_hospitals.py` le falta un carácter) |
| Hospital Regional Ciudad del Este | `8e921cd2-e51d-49c9-94ed-5c756fb28ba3` | Conservar. Duplicado corto: `0c522d21-…` |
| Hospital General de Barrio Obrero | `5e473d0e-705…` | |

Los 4 hospitales de nombre corto (creados el 31-08-2026) son duplicados con IDs
aleatorios: se conservan los de nombre largo, que tienen los IDs de SIGGAM,
dirección y coordenadas.

## Pendientes

- Desactivar los 4 duplicados cortos (`merge_hospitals` con keep_id = largo,
  `copy_config_from_duplicate: false`).
- Conectar la segunda planta BOGE de Luque (`UNIT_ID = "O2-2"`; si comparte switch
  con la primera, necesita otra IP/MAC y el PLC otra IP).
- Borrar de `Registros` las filas de prueba guardadas con el id de Itauguá.
- Cargar el id de Luque en SIGGAM y confirmar el de Mcal. Estigarribia.
- Archivar la implementación antigua de Apps Script sin token.
- Valorar cambiar el `HOSPITAL_ID` por defecto del firmware por un valor de
  ejemplo para no enviar por error a Itauguá.
