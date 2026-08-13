# API de Estado de Plantas — MSPYBS

API REST de solo lectura para consultar el estado de las plantas de gases
medicinales (O₂, Aire Médico, Vacío) monitoreadas por este sistema. Los datos
provienen de sensores ESP32 que reportan cada 5 segundos a un Google Sheet.

Base URL:
```
https://script.google.com/macros/s/AKfycby0PXjgE7OZu17b162eEKmWzk0J6px7W4fBaiIZbzZ43eXq12_7NUfOlQ46drYPidcn/exec
```

Todas las consultas son `GET` y devuelven JSON. No requieren autenticación.

> ⚠️ Esta URL también acepta operaciones de escritura (`POST`) usadas por el
> panel de administración interno. Este documento cubre **solo las acciones
> de lectura** — no expongas ni uses las acciones de escritura desde una web
> pública de terceros.

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
