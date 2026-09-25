---
name: nuevo-equipo
description: Dar de alta y programar un ESP32 del monitor de gases medicinales (pasarela PLC BOGE o equipo de sensores 4-20 mA de cualquier marca), incluido crear el hospital compatible con SIGGAM, generar la carpeta del firmware, subirlo por USB y verificar que envía datos. Usar cuando el usuario quiera instalar, configurar, programar, flashear o actualizar un ESP32 o un equipo nuevo de un hospital.
---

# Alta y programación de un equipo ESP32

Guía al usuario de principio a fin. Se ejecuta en su PC (tiene el ESP32 por USB y
el servidor MCP `mspybs-plantas`). Responder en español, un paso a la vez, y
esperar confirmación antes de crear hospitales, generar carpetas o subir firmware.

Motor: `python3 tools/equipos/equipos.py <subcomando>` (desde la raíz del repo).
Si el usuario prefiere hacerlo con ventanas y botones, ofrecer la interfaz gráfica:
`python3 tools/equipos/equipos_gui.py` (mismos pasos: Configuración, Hospitales,
Equipos → Nuevo equipo, Subir, Verificar).
Nunca escribir tokens ni contraseñas en el chat ni en comandos: el script los pide
oculto cuando el usuario ejecuta él mismo `! python3 tools/equipos/equipos.py ...`.

## 0. Modo

Preguntar qué quiere hacer:
- **Equipo nuevo** → pasos 1 a 7.
- **Actualizar el firmware** de un equipo ya instalado → sección "Actualizar".
- **Diagnosticar** un equipo que no envía → conectar por USB y ir al paso 6.

## 1. Preparación

1. `git pull` para tener el firmware y el skill actuales.
2. `python3 tools/equipos/equipos.py check`. Si falta algo, pedir permiso y ejecutar
   `check --install` (añadir `--sensores` si el equipo será de sensores).
   Si avisa de permisos sobre `/dev/ttyUSB0`: `sudo usermod -aG dialout $USER` y
   cerrar sesión.
3. Si falta la configuración global, pedir al usuario que ejecute él mismo:
   `! python3 tools/equipos/equipos.py config-global` (pide la URL de
   `NEXT_PUBLIC_API_URL` en Vercel y el `DEVICE_TOKEN` de Apps Script, oculto).
   Si ya tiene un `secrets.h` que funciona (p. ej. `~/Escritorio/luque_O2_1/`), usar
   `importar --desde <ruta>/secrets.h --hospital-id <id>`.

## 2. Hospital

1. Buscar con el MCP (`list_plants_status`, `get_plant_status`). Si hay dudas de
   duplicados, `check_hospitals`.
2. Si no existe:
   - Preguntar si **SIGGAM ya tiene un `sensorMspbsId`** para ese hospital. Si lo
     tiene, se usa como `id`; si no, `create_hospital` genera uno y hay que recordar
     al usuario cargarlo en SIGGAM.
   - Dirección y coordenadas: buscarlas y **mostrarlas para que el usuario las
     confirme**. Nunca inventar coordenadas; si no se encuentran, pedirlas (Google
     Maps: clic derecho sobre el edificio).
   - Equipos iniciales: solo los que se van a monitorear.
   - Si `create_hospital` avisa de un nombre parecido, mostrarlo y preguntar.
3. Anotar `hospital_id` y nombre para los pasos siguientes.

## 3. Equipo

Preguntar:
- **Qué mide**: planta de O₂ (`o2`), compresor/aire medicinal (`air`) o bomba de
  vacío (`vacuum`).
- **Marca y modelo** de la planta.
- **Tipo de ESP32** (decidir con el usuario):

| Caso | Firmware | Subcomando |
|---|---|---|
| Planta de O₂ **BOGE** con acceso al PLC (cable LAN) | Pasarela PLC, Arduino + ENC28J60 | `generar-plc` |
| Cualquier otra marca, compresores, vacío, o sin acceso al PLC | Sensores 4-20 mA, MicroPython | `generar-sensores` |

  Solo BOGE tiene perfil de PLC (mapa de registros Modbus). Para otra marca con PLC
  accesible, ofrecer añadir su perfil más adelante si el usuario consigue el manual
  con el mapa Modbus; mientras tanto, sensores. Un equipo de sensores que además lee
  un PLC BOGE (`--leer-plc`) necesita módulo **W5500** (MicroPython no soporta
  ENC28J60).
- **UNIT_ID**: proponer `python3 tools/equipos/equipos.py siguiente-unidad
  --hospital-id <id> --tipo <tipo>` y contrastarlo con las unidades que muestra
  `get_plant_status` (un equipo instalado a mano puede no estar en el inventario).
- **Red del PLC** (solo pasarela): cable directo ESP32↔PLC → IP `.50` (por
  defecto). Si comparte switch con otro equipo del mismo hospital → siguiente IP
  libre (`--eth-ip 51`, ...) y avisar que el otro PLC BOGE también viene de fábrica
  con `100.100.200.10`: el técnico de BOGE debe cambiarle la IP (`--plc-ip`).

## 4. WiFi del hospital

`python3 tools/equipos/equipos.py estado` muestra qué hospitales tienen WiFi
guardado. Si falta, pedir al usuario que ejecute él mismo:
`! python3 tools/equipos/equipos.py wifi --hospital-id <id>`
(pide SSID y contraseña; la contraseña oculta). Recordar que el ESP32 solo usa
WiFi de 2,4 GHz.

## 5. Resumen y generación

Mostrar un resumen (hospital, id, UNIT_ID, tipo, marca, firmware, IP, red WiFi por
nombre) y pedir confirmación. Luego:

```
python3 tools/equipos/equipos.py generar-plc --hospital-id <id> --hospital-nombre "<nombre>" \
  --unidad O2-2 --marca BOGE [--eth-ip 51] [--plc-ip 10]
python3 tools/equipos/equipos.py generar-sensores --hospital-id <id> --hospital-nombre "<nombre>" \
  --unidad VAC-1 --tipo vacuum --marca <marca> [--leer-plc --eth-ip 20]
```

La carpeta queda en `~/Escritorio/equipos/<hospital>_<unidad>/`. Para sensores,
recordar revisar los rangos 4-20 mA (`analog` en `config.py`) contra los
transmisores instalados.

## 6. Subir y verificar

1. Pedir que conecte **solo ese ESP32** por USB (con el ENC28J60 o sensores ya
   cableados y el cable LAN al PLC si aplica).
2. `python3 tools/equipos/equipos.py subir --carpeta <carpeta>`
   (sensores: necesita el `.bin` de MicroPython ESP32_GENERIC en
   `~/.config/mspybs/micropython/` o `--firmware`).
3. `python3 tools/equipos/equipos.py verificar --carpeta <carpeta>` (reinicia la
   placa y lee el monitor serie hasta 90 s; sensores: `--segundos 150`).
4. Según `RESULTADO`:

| resultado / aviso | Qué hacer |
|---|---|
| `ok` sin avisos | Seguir al paso 7 |
| `no_autorizado` | `DEVICE_TOKEN` distinto al de Apps Script: repetir `config-global` y regenerar con `--reemplazar` |
| `sin_wifi` | Red o contraseña del hospital, o WiFi de 5 GHz: repetir `wifi` y regenerar |
| `sin_plc` | Cable LAN, IP del PLC, alimentación del ENC28J60; probar `esp32/diagnostico_enc28j60/` |
| `sin_datos` | Volver a verificar con más `--segundos`; revisar que el puerto sea el correcto |
| aviso de hospital/unidad distinta | El ESP32 tiene otro firmware: volver a subir |
| aviso de VALORES SIMULADOS | Un sensor 4-20 mA no responde: revisar cableado; el dashboard mostraría datos falsos |

5. Confirmar con el MCP (`get_plant_status` del hospital) que la unidad aparece
   **en línea**.

## 7. Cierre

- Si es el primer equipo de su tipo en el hospital, activar ese equipo con
  `set_hospital_equipment` (mostrar el plan y aplicar tras confirmación), para que
  el dashboard evalúe sus alarmas.
- `python3 tools/equipos/equipos.py inventario --hospital-id <id>` para mostrar cómo
  queda el hospital.
- Recordar lo pendiente: cargar el `id` en SIGGAM si se generó, etiquetar
  físicamente el ESP32 con su UNIT_ID y guardar la carpeta generada.

## Actualizar el firmware de un equipo instalado

1. `git pull` y `python3 tools/equipos/equipos.py inventario` para elegir el equipo.
2. `python3 tools/equipos/equipos.py actualizar --carpeta <carpeta>` (conserva
   `equipo.h`, `secrets.h` o `config.json`).
3. Conectar ese ESP32 y hacer el paso 6 (sensores: `subir --solo-archivos`).
   Si la carpeta es anterior a `equipo.h` (tiene `HOSPITAL_ID` dentro del `.ino`),
   regenerarla con `generar-plc` usando los mismos datos.
