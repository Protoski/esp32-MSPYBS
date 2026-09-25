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
- El PLC no publica la presión de las torres A/B. El firmware la **estima** con
  las válvulas (sinóptico del manual, pág. 11: POV-101/102 entrada A/B,
  POV-103/104 escape A/B, POV-105/106 ecualización) y PT-02, y la envía con
  `tower_pressure_source: "estimated"`. Al instalar sensores: `TOWER_SOURCE =
  "measured"` y asignar la lectura real. Confirmar el mapeo de válvulas con BOGE.

## Firmware

- `esp32/plant_monitor.ino`: pasarela PLC → backend (Arduino). Envía los campos
  originales más el contrato `plc_*` (mismo que `esp32/micropython/`), `unit_id`,
  `unit_type` y `token`. Si el PLC no responde envía `plc_online:false` con el
  último dato válido; nunca inventa ceros.
- Configuración por equipo en `equipo.h` (`HOSPITAL_ID`, `UNIT_ID`, `UNIT_TYPE`,
  `ETH_IP_LAST_OCTET`, `PLC_IP_LAST_OCTET`; plantilla `equipo.example.h`); sin él no
  compila. WiFi, `API_URL` y `DEVICE_TOKEN` en `secrets.h`. Ambos ignorados por git.
  La MAC del ENC28J60 se deriva del chip (única por ESP32).
- Arduino compila todos los `.ino` de una carpeta: **una carpeta por ESP32**, con un
  solo `.ino` (copia idéntica de `plant_monitor.ino`) del mismo nombre que la
  carpeta, más `equipo.h` y `secrets.h`.
- Solo **BOGE** tiene perfil de PLC. Plantas de **otras marcas**, compresores y
  vacío se monitorean con el ESP32 de **sensores 4-20 mA** (`esp32/micropython/`,
  requiere W5500 si además lee un PLC). Para otra marca con PLC se puede añadir
  un perfil con el mapa Modbus del fabricante.
- ⚠ El firmware MicroPython envía un **valor simulado** si falla la lectura de un
  sensor (`main.py`, "uso valor simulado"); `equipos.py verificar` lo avisa.

## Alta de equipos (skill `/nuevo-equipo`)

Usar el skill `.claude/skills/nuevo-equipo/` desde el Claude Code local del
usuario, o la **interfaz gráfica** `python3 tools/equipos/equipos_gui.py` (web local
en 127.0.0.1 con token por arranque; menús Inicio, Configuración, Hospitales,
Equipos, Registro; ver `tools/equipos/README.md`). Motor común:
`tools/equipos/equipos.py` (check, config-global, wifi, importar, estado,
siguiente-unidad, generar-plc, generar-sensores, subir, actualizar, verificar,
inventario [--eliminar|--exportar], wifi [--eliminar], hospitales
listar/duplicados/crear/editar/activar/desactivar/eliminar/fusionar/exportar/equipos,
firmware-mpy; `--json` en estado, inventario, check y hospitales). `fusionar` replica
`merge_hospitals` del MCP (plan por defecto, `--aplicar` para ejecutar). `global.env` guarda también `ADMIN_TOKEN`
para crear hospitales desde la GUI. Configuración local en `~/.config/mspybs/` (permisos 600):
`global.env` (API_URL, DEVICE_TOKEN), `wifi/<hospital_id>.env` y el inventario
`equipos.json`. Las carpetas de equipos se generan en `~/Escritorio/equipos/`. Los
secretos los ingresa el usuario con `! python3 tools/equipos/equipos.py ...`
(entrada oculta), nunca por el chat.
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
defecto; conserva uno y desactiva el otro, nunca borra), `set_hospital_equipment`
(activa PSA/compresor/vacío de un hospital; dry run por defecto). Variables
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
- Instalar sensores de presión en las torres A/B y pasar a `"measured"`.
- Regenerar con `/nuevo-equipo` (o `equipos.py generar-plc --reemplazar`) la
  carpeta de Luque O2-1, que es anterior a `equipo.h`.
- Revisar el valor simulado del firmware MicroPython ante fallos de lectura.
