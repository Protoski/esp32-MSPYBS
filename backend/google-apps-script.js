/**
 * ============================================================
 * SISTEMA DE MONITOREO - PLANTA DE GASES MEDICINALES
 * Backend: Google Apps Script  |  Versión: 1.0.0
 * ============================================================
 *
 * INSTRUCCIONES DE DESPLIEGUE:
 *  1. Abre script.google.com y crea un nuevo proyecto.
 *  2. Pega este código completo.
 *  3. Reemplaza SHEET_ID con el ID de tu Google Spreadsheet.
 *  4. Ve a Implementar > Nueva implementación > Aplicación web.
 *  5. Acceso: "Cualquier persona" (para que el ESP32 y Vercel puedan acceder).
 *  6. Copia la URL de implementación y úsala como variable de entorno en Vercel.
 * ============================================================
 */

// ── CONFIGURACIÓN ─────────────────────────────────────────
const SHEET_ID   = 'REEMPLAZAR_CON_TU_SHEET_ID'; // ← pega aquí el ID del Spreadsheet
const SHEET_NAME = 'Registros';                  // nombre de la hoja de cálculo
const MAX_ROWS   = 100;                          // filas máximas que devuelve el GET

/**
 * Construye las cabeceras CORS que necesita el navegador cuando
 * el frontend (Vercel) consulta desde un dominio diferente.
 * Google Apps Script requiere adjuntarlas al objeto ContentService.
 */
function buildCorsHeaders_() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

/**
 * Responde con JSON añadiendo cabeceras CORS.
 * @param {Object} data - Objeto a serializar como JSON.
 * @param {number} [status=200] - Código de estado lógico (informativo).
 */
function jsonResponse_(data) {
  const output = ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
  // Apps Script no permite setear status HTTP 4xx/5xx directamente
  // en doPost/doGet; se embebe el status en el payload.
  return output;
}

// ── doPost: RECIBE DATOS DEL ESP32 ─────────────────────────
/**
 * Endpoint POST  →  /exec
 * El ESP32 envía un JSON con todas las variables de la planta.
 * Esta función valida el payload e inserta una nueva fila en la hoja.
 *
 * Payload esperado (application/json):
 * {
 *   "o2_flow_m3h":          2.5,
 *   "tower_a_pressure_bar": 5.2,
 *   "tower_b_pressure_bar": 0.8,
 *   "o2_tank_pressure_bar": 3.1,
 *   "o2_purity_pct":        95.4,
 *   "psa_dewpoint_c":       -40.0,
 *   "compressor_status":    "ON",
 *   "compressor_hours":     1234,
 *   "air_line_pressure_bar":5.0,
 *   "air_dewpoint_c":       -45.0,
 *   "vacuum_pump_status":   "ON",
 *   "vacuum_level_mmhg":    -550.0
 * }
 */
function doPost(e) {
  try {
    const raw     = e.postData ? e.postData.contents : '{}';
    const payload = JSON.parse(raw);

    const sheet = SpreadsheetApp
      .openById(SHEET_ID)
      .getSheetByName(SHEET_NAME);

    if (!sheet) {
      return jsonResponse_({ ok: false, error: `Hoja "${SHEET_NAME}" no encontrada.` });
    }

    // Inserta fila al final; la columna A (Timestamp) se rellena automáticamente
    sheet.appendRow([
      new Date(),                               // A  Timestamp
      payload.o2_flow_m3h          ?? '',       // B  Caudal O2
      payload.tower_a_pressure_bar ?? '',       // C  Presión Torre A
      payload.tower_b_pressure_bar ?? '',       // D  Presión Torre B
      payload.o2_tank_pressure_bar ?? '',       // E  Presión Tanque O2
      payload.o2_purity_pct        ?? '',       // F  Pureza O2
      payload.psa_dewpoint_c       ?? '',       // G  Dew Point PSA
      payload.compressor_status    ?? '',       // H  Estado Compresor
      payload.compressor_hours     ?? '',       // I  Horas Compresor
      payload.air_line_pressure_bar?? '',       // J  Presión Línea Aire
      payload.air_dewpoint_c       ?? '',       // K  Dew Point Aire Médico
      payload.vacuum_pump_status   ?? '',       // L  Estado Bomba Vacío
      payload.vacuum_level_mmhg    ?? '',       // M  Nivel Vacío
    ]);

    return jsonResponse_({ ok: true, timestamp: new Date().toISOString() });

  } catch (err) {
    Logger.log('doPost ERROR: ' + err.message);
    return jsonResponse_({ ok: false, error: err.message });
  }
}

// ── doGet: ENTREGA DATOS AL FRONTEND ───────────────────────
/**
 * Endpoint GET  →  /exec
 * Devuelve las últimas MAX_ROWS filas como array JSON.
 * El frontend en Vercel consulta este endpoint cada 5 segundos.
 *
 * Respuesta:
 * {
 *   "ok": true,
 *   "count": 100,
 *   "rows": [ { ...campos }, ... ]
 * }
 */
function doGet(e) {
  try {
    const sheet = SpreadsheetApp
      .openById(SHEET_ID)
      .getSheetByName(SHEET_NAME);

    if (!sheet) {
      return jsonResponse_({ ok: false, error: `Hoja "${SHEET_NAME}" no encontrada.` });
    }

    const lastRow   = sheet.getLastRow();
    const headerRow = 1;
    const dataRows  = lastRow - headerRow;          // filas con datos reales

    if (dataRows <= 0) {
      return jsonResponse_({ ok: true, count: 0, rows: [] });
    }

    // Toma las últimas MAX_ROWS filas (sin encabezado)
    const rowsToRead = Math.min(dataRows, MAX_ROWS);
    const startRow   = lastRow - rowsToRead + 1;

    const range  = sheet.getRange(startRow, 1, rowsToRead, 13); // 13 columnas
    const values = range.getValues();

    const rows = values.map((row) => ({
      timestamp:             row[0]  ? new Date(row[0]).toISOString() : null,
      o2_flow_m3h:           row[1],
      tower_a_pressure_bar:  row[2],
      tower_b_pressure_bar:  row[3],
      o2_tank_pressure_bar:  row[4],
      o2_purity_pct:         row[5],
      psa_dewpoint_c:        row[6],
      compressor_status:     row[7],
      compressor_hours:      row[8],
      air_line_pressure_bar: row[9],
      air_dewpoint_c:        row[10],
      vacuum_pump_status:    row[11],
      vacuum_level_mmhg:     row[12],
    }));

    return jsonResponse_({ ok: true, count: rows.length, rows });

  } catch (err) {
    Logger.log('doGet ERROR: ' + err.message);
    return jsonResponse_({ ok: false, error: err.message });
  }
}

// ── FUNCIÓN DE INICIALIZACIÓN DE HOJA ──────────────────────
/**
 * Ejecuta esta función UNA sola vez desde el editor de Apps Script
 * para crear automáticamente la fila de encabezados en la hoja.
 * Menú superior: Ejecutar > initSheet
 */
function initSheet() {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  let   sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }

  const headers = [
    'Timestamp',
    'Caudal_O2_m3h',
    'Presion_Torre_A_bar',
    'Presion_Torre_B_bar',
    'Presion_Tanque_O2_bar',
    'Pureza_O2_pct',
    'DewPoint_PSA_C',
    'Estado_Compresor',
    'Horas_Compresor',
    'Presion_Linea_Aire_bar',
    'DewPoint_Aire_C',
    'Estado_Bomba_Vacio',
    'Nivel_Vacio_mmHg',
  ];

  // Escribe encabezados en fila 1 y los formatea
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold')
    .setBackground('#1e293b')
    .setFontColor('#f1f5f9');

  // Formatea la columna de timestamp como fecha/hora legible
  sheet.getRange(2, 1, 1000, 1).setNumberFormat('yyyy-MM-dd HH:mm:ss');

  Logger.log('✅ Hoja inicializada correctamente con ' + headers.length + ' columnas.');
}
