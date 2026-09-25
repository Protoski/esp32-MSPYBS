# 🏭 MSPYBS — Monitor de Planta de Gases Medicinales

Sistema de monitoreo y registro en tiempo real para plantas de generación de gases medicinales (O₂, Aire Médico y Vacío). Arquitectura IoT full-stack con ESP32, Google Apps Script y Next.js/Vercel.

---

## Arquitectura del Sistema

```
[ESP32 + Sensores]
       │  POST JSON (cada 5 s)
       ▼
[Google Apps Script]  ←── URL como Variable de Entorno
       │  GET JSON (últimas 100 filas)
       ▼
[Frontend Next.js]  ──► Desplegado en Vercel
       │
       ▼
[Google Sheets]  (almacenamiento de datos crudos)
```

---

## Estructura del Repositorio

```
esp32-MSPYBS/
├── backend/
│   └── google-apps-script.js   # Código para pegar en script.google.com
├── esp32/
│   ├── plant_monitor.ino       # Firmware Arduino: PLC BOGE (Modbus TCP, ENC28J60) → WiFi
│   ├── secrets.example.h       # Plantilla de WiFi, URL y DEVICE_TOKEN (copiar a secrets.h)
│   ├── diagnostico_enc28j60/   # Sketch de prueba del cableado SPI del ENC28J60
│   └── micropython/            # Firmware MicroPython: sensores 4-20mA + PLC
├── mcp-server/                 # Servidor MCP: estado de plantas y alta de hospitales
├── frontend/                   # Aplicación Next.js
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx            # Dashboard principal
│   │   └── globals.css
│   ├── components/
│   │   ├── KPICard.tsx         # Tarjetas de indicadores KPI
│   │   ├── PilotLight.tsx      # Luces piloto virtuales
│   │   ├── TimeSeriesChart.tsx # Gráficos Chart.js
│   │   └── StatusBar.tsx       # Barra de estado de conexión
│   ├── lib/
│   │   └── api.ts              # Capa de acceso a datos (fetch)
│   ├── types/
│   │   └── plant.ts            # Tipos TypeScript
│   ├── .env.example            # Plantilla de variables de entorno
│   ├── next.config.js
│   ├── tailwind.config.js
│   └── package.json
└── README.md
```

---

## Sección 1: Base de Datos — Google Sheets

### Diseño de la Fila de Encabezados (Columnas A–M)

| Col | Nombre de Columna        | Tipo     | Descripción                              |
|-----|--------------------------|----------|------------------------------------------|
| A   | `Timestamp`              | DateTime | Fecha y hora de inserción (automática)   |
| B   | `Caudal_O2_m3h`          | Float    | Caudal O₂ producido (m³/h)              |
| C   | `Presion_Torre_A_bar`    | Float    | Presión Torre A PSA (bar)               |
| D   | `Presion_Torre_B_bar`    | Float    | Presión Torre B PSA (bar)               |
| E   | `Presion_Tanque_O2_bar`  | Float    | Presión tanque almacenamiento O₂ (bar)  |
| F   | `Pureza_O2_pct`          | Float    | Pureza de Oxígeno (% O₂)               |
| G   | `DewPoint_PSA_C`         | Float    | Punto de rocío entrada PSA (°C)         |
| H   | `Estado_Compresor`       | String   | ON / OFF / FAULT                        |
| I   | `Horas_Compresor`        | Integer  | Horas de marcha acumuladas              |
| J   | `Presion_Linea_Aire_bar` | Float    | Presión línea aire médico (bar)         |
| K   | `DewPoint_Aire_C`        | Float    | Punto de rocío aire médico (°C)         |
| L   | `Estado_Bomba_Vacio`     | String   | ON / OFF / FAULT                        |
| M   | `Nivel_Vacio_mmHg`       | Float    | Nivel de vacío (mmHg, valores negativos)|

> **Inicialización automática:** Ejecuta la función `initSheet()` desde el editor de Apps Script una sola vez para crear los encabezados con formato.

---

## Guía de Despliegue Paso a Paso

### Paso 1: Configurar Google Sheets

1. Crea un nuevo Google Spreadsheet.
2. Copia el **ID del Spreadsheet** desde la URL:
   ```
   https://docs.google.com/spreadsheets/d/[ESTE_ES_TU_SHEET_ID]/edit
   ```
3. Guárdalo para el siguiente paso.

### Paso 2: Desplegar el Backend (Google Apps Script)

1. Ve a [script.google.com](https://script.google.com) → **Nuevo proyecto**.
2. Borra el contenido por defecto y pega el código de `backend/google-apps-script.js`.
3. Reemplaza `REEMPLAZAR_CON_TU_SHEET_ID` con el ID de tu Spreadsheet.
4. Ejecuta **`initSheet`** una sola vez (Ejecutar > initSheet) para crear los encabezados.
5. Ve a **Implementar > Nueva implementación**:
   - Tipo: **Aplicación web**
   - Ejecutar como: **Yo**
   - Acceso: **Cualquier persona**
6. Haz clic en **Implementar** y copia la **URL de implementación** (la necesitarás en Vercel).

### Paso 3: Subir el Frontend a GitHub

```bash
# Desde la carpeta raíz del repositorio:
git add .
git commit -m "feat: sistema completo de monitoreo gases medicinales"
git push origin main
```

### Paso 4: Desplegar en Vercel

1. Ve a [vercel.com](https://vercel.com) e importa tu repositorio de GitHub.
2. En la configuración del proyecto, establece:
   - **Root Directory:** `frontend`
   - **Framework Preset:** Next.js
3. **⚠️ CRÍTICO — Variable de entorno:**
   - Ve a **Settings > Environment Variables**
   - Añade la variable:
     ```
     Name:  NEXT_PUBLIC_API_URL
     Value: https://script.google.com/macros/s/TU_DEPLOYMENT_ID/exec
     ```
4. Haz clic en **Deploy**.

> La URL de Google Apps Script **nunca debe aparecer en el código fuente**. Al usar `process.env.NEXT_PUBLIC_API_URL`, Vercel inyecta el valor durante el build sin exponerlo en el repositorio.

### Paso 5: Configurar el ESP32

**Forma recomendada:** en Claude Code (en tu PC, con el ESP32 por USB) usa el skill
`/nuevo-equipo`, o directamente `python3 tools/equipos/equipos.py`: busca o crea el
hospital, genera la carpeta del equipo, sube el firmware y verifica que envía datos.

Forma manual:

1. Copia `esp32/equipo.example.h` como `equipo.h` y completa `HOSPITAL_ID` (el
   `sensorMspbsId` de SIGGAM), `UNIT_ID` y `UNIT_TYPE`.
2. Copia `esp32/secrets.example.h` como `esp32/secrets.h` y completa: red Wi-Fi,
   `API_URL` (el mismo valor que `NEXT_PUBLIC_API_URL` en Vercel) y `DEVICE_TOKEN`
   (Apps Script → Configuración del proyecto → Propiedades del script). `secrets.h` está en
   `.gitignore` y no se sube al repositorio.
3. El firmware lee el PLC S7-1200 del generador BOGE por Modbus TCP a través de un módulo
   ENC28J60 (IP del ESP32 en la LAN: `100.100.200.50`; PLC: `100.100.200.10:501`) y envía
   los datos por WiFi.
4. Instala las librerías desde el Gestor de Librerías: **EthernetENC** (Juraj Andrassy) y
   **ArduinoJson** ≥ 6.x (Benoit Blanchon).
5. Abre `plant_monitor.ino` (con `equipo.h` y `secrets.h` en la misma carpeta), selecciona la placa
   **ESP32 Dev Module** y sube el firmware.

---

## Umbrales de Alarma — Pureza de Oxígeno

| Nivel       | Umbral       | Comportamiento en Dashboard        |
|-------------|-------------|-------------------------------------|
| Normal      | ≥ 93% O₂    | Tarjeta verde                      |
| ⚠ Alerta    | 90–93% O₂   | Tarjeta amarilla                   |
| 🚨 Crítico  | < 90% O₂    | Tarjeta roja parpadeante (animate-pulse) |

---

## Desarrollo Local

```bash
cd frontend
cp .env.example .env.local
# Edita .env.local con tu URL de Apps Script

npm install
npm run dev
# → http://localhost:3000
```

---

## Servidor MCP — Consultar estado de plantas

`mcp-server/` expone un servidor MCP (Model Context Protocol) para que
cualquier usuario, desde un cliente compatible (ej. Claude Desktop), pueda
preguntar si una planta está en línea o sin señal, usando los mismos datos
del Google Sheet. Ver `mcp-server/README.md` para instalación y
configuración.

## Normativas de Referencia

- **ISO 7396-1:2016** — Sistemas de tuberías para gases medicinales.
- **HTM 02-01** — Health Technical Memorandum (UK) — Medical gas pipeline systems.
- **Pureza O₂ medicinal:** ≥ 93% según Farmacopea Europea (Ph. Eur. 0417).
