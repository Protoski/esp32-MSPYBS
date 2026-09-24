# API de Estado de Plantas — MSPYBS

API REST de solo lectura para consultar el estado de las plantas de gases
medicinales (O₂, Aire Médico, Vacío) monitoreadas por este sistema. Los datos
provienen de sensores ESP32 que reportan cada 5 segundos a un Google Sheet.

Base URL:
```
https://script.google.com/macros/s/AKfycby0PXjgE7OZu17b162eEKmWzk0J6px7W4fBaiIZbzZ43eXq12_7NUfOlQ46drYPidcn/exec
```

Todas las consultas son `GET` y devuelven JSON. No requieren autenticación.

> ⚠️ Esta URL también acepta operaciones de escritura (`POST`) usadas por los
> dispositivos ESP32 (`action=data`) y el panel de administración interno
> (`add_hospital`, `update_hospital`, `toggle_hospital`, `delete_hospital`).
> Todas las acciones de escritura requieren un campo `token` en el cuerpo del
> POST, verificado contra `DEVICE_TOKEN` / `ADMIN_TOKEN` en las Propiedades
> del script (Extensiones → Propiedades del proyecto → Propiedades del
> script) — nunca están en este repositorio. Este documento cubre **solo las
> acciones de lectura**, que siguen siendo públicas por diseño (alimentan el
> dashboard).

---

## 1. Listar plantas — `action=hospitals`

```
GET {BASE_URL}?action=hospitals
```

Devuelve todas las plantas registradas (activas e inactivas).

**Respuesta:**
```json
{
  "ok": true,
  "hospitals": [
    {
      "id": "247957b8-c92e-44f7-8858-819515a14731",
      "nombre": "Hospital de Clínicas",
      "ciudad": "Asunción",
      "direccion": "",
      "activo": true,
      "thresholds": {
        "o2_purity_warn": 93,
        "o2_purity_critical": 90,
        "air_pressure_min": 4.5,
        "air_pressure_max": 5.5,
        "vacuum_min_mmhg": -400
      },
      "equipment": { "compressor_enabled": true, "vacuum_enabled": true, "psa_enabled": true },
      "created_at": "2026-01-01T00:00:00.000Z",
      "lat": null,
      "lon": null
    }
  ]
}
```

## 2. Último dato de todas las plantas — `action=latest_all`

```
GET {BASE_URL}?action=latest_all
```

Devuelve la lectura más reciente de **cada** planta que alguna vez envió
datos, más `now` (hora del servidor — úsala para calcular el estado, no la
hora del navegador/cliente).

**Respuesta:**
```json
{
  "ok": true,
  "count": 2,
  "rows": [
    {
      "timestamp": "2026-08-13T14:48:50.000Z",
      "hospital_id": "247957b8-c92e-44f7-8858-819515a14731",
      "o2_flow_m3h": 3.19,
      "tower_a_pressure_bar": 5.01,
      "tower_b_pressure_bar": 0.27,
      "o2_tank_pressure_bar": 4.23,
      "o2_purity_pct": 94.87,
      "psa_dewpoint_c": -42.3,
      "compressor_status": "ON",
      "compressor_hours": 1235,
      "air_line_pressure_bar": 5.02,
      "air_dewpoint_c": -46.6,
      "vacuum_pump_status": "ON",
      "vacuum_level_mmhg": -579
    }
  ],
  "now": "2026-08-13T14:49:19.700Z"
}
```

## 3. Historial de una planta — `action=data`

```
GET {BASE_URL}?action=data&hospital_id=247957b8-c92e-44f7-8858-819515a14731
```

Devuelve hasta las últimas 500 lecturas de una planta específica (mismo
formato de fila que arriba). Si se omite `hospital_id`, devuelve el
historial mezclado de todas las plantas.

---

## Cómo calcular EN LÍNEA / SIN SEÑAL

No hay un campo `online` en la respuesta — se calcula en el cliente
comparando el `timestamp` del último dato contra `now`:

```js
const ageMs = new Date(now).getTime() - new Date(row.timestamp).getTime();
const isOnline = ageMs < 60_000 && ageMs > -60_000; // menos de 60s de diferencia
```

Reglas:
- Si la planta está `activo: false` en `hospitals`, trátala siempre como
  **sin señal** aunque tenga datos recientes (está dada de baja).
- Si no aparece en `latest_all` (nunca envió datos), es **sin señal**.
- Usa siempre el `now` que devuelve el servidor, no la hora local del
  navegador — evita falsos positivos por reloj desincronizado.

### Ejemplo mínimo (JavaScript)

```js
async function getPlantStatuses(baseUrl) {
  const [hRes, lRes] = await Promise.all([
    fetch(`${baseUrl}?action=hospitals`).then(r => r.json()),
    fetch(`${baseUrl}?action=latest_all`).then(r => r.json()),
  ]);
  const latestByHospital = Object.fromEntries(lRes.rows.map(r => [r.hospital_id, r]));

  return hRes.hospitals.map(h => {
    const latest = latestByHospital[h.id];
    const ageMs = latest ? Date.parse(lRes.now) - Date.parse(latest.timestamp) : Infinity;
    const online = h.activo && ageMs < 60_000 && ageMs > -60_000;
    return { id: h.id, nombre: h.nombre, ciudad: h.ciudad, online, latest };
  });
}
```

---

## Referencia rápida de campos por lectura

| Campo | Descripción |
|---|---|
| `o2_flow_m3h` | Caudal de O₂ producido (m³/h) |
| `tower_a_pressure_bar` / `tower_b_pressure_bar` | Presión torres PSA (bar) |
| `o2_tank_pressure_bar` | Presión tanque de O₂ (bar) |
| `o2_purity_pct` | Pureza de O₂ (%) — normal ≥93%, alerta 90–93%, crítico <90% |
| `psa_dewpoint_c` | Punto de rocío entrada PSA (°C) |
| `compressor_status` | `ON` / `OFF` / `FAULT` |
| `compressor_hours` | Horas acumuladas del compresor |
| `air_line_pressure_bar` | Presión línea de aire médico (bar) |
| `air_dewpoint_c` | Punto de rocío aire médico (°C) |
| `vacuum_pump_status` | `ON` / `OFF` / `FAULT` |
| `vacuum_level_mmhg` | Nivel de vacío (mmHg, valores negativos) |

Las plantas que no tienen un equipo (por ejemplo, sin bomba de vacío) envían
`0` en esos campos; consulta `equipment` en `action=hospitals` antes de
interpretarlos.

## Varios equipos por hospital (`unit_id`, `unit_type`, `units`)

Un hospital puede tener varias plantas de O₂, compresores de aire y bombas de
vacío, cada una con su propio ESP32. Todas usan el mismo `hospital_id` (el
`sensorMspbsId` de SIGGAM) y se distinguen por:

| Campo | Descripción |
|---|---|
| `unit_id` | Identificador del equipo dentro del hospital, ej. `O2-1`, `O2-2`, `VAC-1`. `null` en equipos antiguos (un único equipo) |
| `unit_type` | `o2`, `air` o `vacuum`. `null` = el equipo mide todos los tipos (planta completa) |

**`latest_all`** sigue devolviendo **una fila por hospital** (compatible con
clientes existentes). Si el hospital tiene un solo equipo, esa fila es su
última lectura sin cambios. Si tiene varios, es un **resumen** de los equipos
en línea (o de todos, si ninguno lo está):

- Pureza, torres, tanque, punto de rocío PSA y campos `plc_*`: los de la planta
  de O₂ en peor estado entre las que están produciendo (menor pureza); si
  ninguna produce, los de la planta con el dato más reciente.
- `o2_flow_m3h`: suma de todas las plantas de O₂.
- Aire: menor presión de línea, mayor punto de rocío; `compressor_status`
  `FAULT` si alguno está en falla, si no `ON` si alguno está en marcha.
- Vacío: el nivel menos negativo (peor); `vacuum_pump_status` con la misma regla.
- En el resumen, `unit_id` y `unit_type` valen `null`.

Cada fila de `latest_all` trae además **`units`**: la última lectura de cada
equipo del hospital (con su `unit_id`, `unit_type` y sus propios campos). Para
saber si un equipo concreto está en línea, aplica la regla de 60 s a su
`timestamp`.

**`data`** acepta `unit_id` para el historial de un solo equipo:

```
GET {BASE_URL}?action=data&hospital_id=247957b8-...&unit_id=O2-2
```

Sin `unit_id`, devuelve las lecturas de todos los equipos del hospital
mezcladas en orden cronológico, cada una con su `unit_id`.

## Datos del PLC BOGE (`plc_*`)

Las plantas con generador de O₂ BOGE (PLC Siemens S7-1200) envían además estos
campos en cada lectura de `latest_all` y `data`. En equipos sin PLC, y en filas
anteriores a este cambio, valen `null`.

| Campo | Tipo | Descripción |
|---|---|---|
| `plc_online` | bool | `false` si el ESP32 no pudo leer el PLC: los demás `plc_*` son el **último dato válido**, no la lectura actual |
| `plc_plant_state` | int | 0 listo (detenido), 1 funcionando, 2 apagándose, 3 entrando en espera, 4 en espera, 11 rearranque tras corte |
| `plc_plant_state_label` | string | `LISTA_PARA_COMENZAR`, `FUNCIONANDO`, `APAGADO_EN_PROGRESO`, `ESPERA_EN_PROGRESO`, `ESPERA_COMPLETADA`, `REINICIO_AUTOMATICO_TRAS_CORTE` |
| `plc_o2_content_pct` | number | Contenido de O₂ del gas producto (%) |
| `plc_gas_flow_nm3h` | number | Caudal de gas producto (Nm³/h) |
| `plc_gas_pressure_barg` | number | Presión de gas producto (barg) |
| `plc_air_inlet_pressure_barg` | number | Presión de entrada de aire (barg) |
| `plc_gas_temp_c` / `plc_air_inlet_temp_c` | number | Temperatura de gas producto / entrada de aire (°C) |
| `plc_gas_dewpoint_c` / `plc_air_inlet_dewpoint_c` | number | Punto de rocío de gas producto / entrada de aire (°C) |
| `plc_service_hours_total` / `plc_service_hours_partial` | int | Horas de funcionamiento del generador |
| `plc_flow_total_nm3` / `plc_flow_partial_nm3` | int | Flujo acumulado de gas producto (Nm³) |
| `plc_alarms` | int | Máscara de bits: `ALARMS 1` (bits 0-15) y `ALARMS 2` (bits 16-31), manual BOGE pág. 52-53 |
| `plc_faults` | int | Máscara de bits de fallos (`FAULT ARRAY 1/2`). Bit 0 analizador O₂, 1 flujómetro, 2-7 transmisores, 8 compresor, 9 secador, 10 mantenimiento de filtros, 11 mantenimiento de válvulas, 12 alimentación |
| `plc_alarms_ack` | int[3] | Palabras de alarmas reconocidas (registros 40024-40026) |
| `plc_valves` | int[9] | Posición de válvulas POV-101 a POV-110 (0 cerrada, 1 abierta) |
| `plc_life_bit` | int | Reloj de 0,5 Hz del PLC; si deja de alternar, el programa del PLC está detenido |

Con el generador detenido o en espera, los valores de pureza y caudal en 0 son
normales: evalúa la pureza contra los umbrales solo cuando
`plc_plant_state == 1` y `plc_online == true`.

## Presión de torres estimada (`tower_pressure_source`)

El PLC BOGE no publica la presión de cada torre PSA. Hasta instalar sensores,
el firmware la **estima** a partir de la posición de las válvulas
(`plc_valves`) y la presión real de entrada de aire (`plc_air_inlet_pressure_barg`):

| Válvulas abiertas | Torre A | Torre B |
|---|---|---|
| POV-101 (entrada A) + POV-104 (escape B) | presión de entrada | ≈ 0,1 bar |
| POV-102 (entrada B) + POV-103 (escape A) | ≈ 0,1 bar | presión de entrada |
| POV-105/106 (ecualización) | ≈ la mitad | ≈ la mitad |
| Todas cerradas | mantiene el último valor | mantiene el último valor |

`tower_pressure_source` indica el origen de `tower_a_pressure_bar` y
`tower_b_pressure_bar`: `"estimated"` (calculada, **no es una medición**) o
`"measured"` (sensor). `null` en equipos antiguos, que miden con sensores.
No uses valores estimados para alarmas ni informes de cumplimiento.

## Identificadores de planta y SIGGAM

- El `id` de cada planta (`hospital_id` en las lecturas) es el mismo texto que
  SIGGAM usa como `sensorMspbsId`. Compáralo como texto exacto: la mayoría son
  UUID, pero se guardan tal como los asignó SIGGAM.
- Un `id` no cambia nunca después de creado. Si SIGGAM ya tenía uno para la
  planta, se usa ese al darla de alta; si no, se genera un UUID que hay que
  cargar en SIGGAM.
- El backend rechaza altas con un `id` existente o con el mismo nombre y ciudad
  que otra planta (sin distinguir mayúsculas, tildes ni espacios), así que no
  aparecen plantas duplicadas con distinto `id`.

