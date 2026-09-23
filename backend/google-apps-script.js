/**
 * SISTEMA DE MONITOREO — PLANTA DE GASES MEDICINALES
 * Google Apps Script v2.1.0 — Multi-hospital + ubicación en mapa
 *
 * HOJAS REQUERIDAS: "Registros" y "Hospitales" (ejecutar initAll() una vez)
 */

const SHEET_ID = 'REEMPLAZAR_CON_TU_SHEET_ID';
const SH_DATA  = 'Registros';
const SH_HOSP  = 'Hospitales';
const MAX_ROWS = 500;    // registros maximos a devolver en una consulta de historial
const SCAN_ROWS = 20000; // filas a escanear hacia atras para encontrar los de un hospital

// ── AUTENTICACION ───────────────────────────────────────────
// Los valores reales viven en Extensiones > Propiedades del script >
// Propiedades del script (Project Settings > Script Properties), NUNCA
// en este archivo, para poder tenerlo en un repo publico sin exponerlos.
// DEVICE_TOKEN: lo manda cada ESP32 junto con sus lecturas (action=data).
// ADMIN_TOKEN: lo manda el panel de administracion del frontend.
function deviceToken_() { return PropertiesService.getScriptProperties().getProperty('DEVICE_TOKEN'); }
function adminToken_()  { return PropertiesService.getScriptProperties().getProperty('ADMIN_TOKEN'); }

function checkToken_(body, expected) {
  if (!expected) return err_('Servidor mal configurado: falta el token en Script Properties.');
  if (body.token !== expected) return err_('No autorizado.');
  return null; // null = token correcto, seguir adelante
}

function ok_(data)  { return out_(Object.assign({ ok: true  }, data)); }
function err_(msg)  { return out_({ ok: false, error: msg }); }
function out_(data) { return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON); }

function doGet(e) {
  try {
    const action = (e.parameter && e.parameter.action) || 'data';
    if (action === 'hospitals')  return getHospitals_();
    if (action === 'latest_all') return getLatestAll_();
    if (action === 'data')       return getData_(e.parameter && e.parameter.hospital_id, e.parameter && e.parameter.unit_id);
    return err_('Acción desconocida: ' + action);
  } catch(ex) { Logger.log('doGet ERROR: ' + ex.message); return err_(ex.message); }
}

function doPost(e) {
  try {
    const body   = JSON.parse((e.postData && e.postData.contents) || '{}');
    const action = body.action || 'data';

    if (action === 'data') {
      const authErr = checkToken_(body, deviceToken_());
      if (authErr) return authErr;
      return postData_(body);
    }

    if (action === 'verify_token') {
      const authErr = checkToken_(body, adminToken_());
      return authErr || ok_({ message: 'Token valido.' });
    }

    const adminActions = ['add_hospital', 'update_hospital', 'toggle_hospital', 'delete_hospital'];
    if (adminActions.indexOf(action) !== -1) {
      const authErr = checkToken_(body, adminToken_());
      if (authErr) return authErr;
      if (action === 'add_hospital')    return addHospital_(body);
      if (action === 'update_hospital') return updateHospital_(body);
      if (action === 'toggle_hospital') return toggleHospital_(body);
      if (action === 'delete_hospital') return deleteHospital_(body);
    }

    return err_('Acción desconocida: ' + action);
  } catch(ex) { Logger.log('doPost ERROR: ' + ex.message); return err_(ex.message); }
}

// Columnas A-N: formato original. Desde la O: datos del PLC BOGE, con los
// mismos nombres que envían los firmwares (contrato plc_*). Solo se añaden
// al final para no desplazar columnas que ya leen el dashboard y SIGGAM.
const LEGACY_COLS = 14;
const PLC_FIELDS = [
  'plc_online', 'plc_plant_state', 'plc_plant_state_label',
  'plc_o2_content_pct', 'plc_gas_flow_nm3h', 'plc_gas_pressure_barg',
  'plc_air_inlet_pressure_barg', 'plc_gas_temp_c', 'plc_air_inlet_temp_c',
  'plc_gas_dewpoint_c', 'plc_air_inlet_dewpoint_c',
  'plc_service_hours_total', 'plc_service_hours_partial',
  'plc_flow_total_nm3', 'plc_flow_partial_nm3',
  'plc_alarms', 'plc_faults', 'plc_alarms_ack', 'plc_valves', 'plc_life_bit',
];
const PLC_JSON_FIELDS = ['plc_alarms_ack', 'plc_valves'];
// Un hospital puede tener varios equipos, cada uno con su ESP32: unit_id
// (ej. "O2-1", "VAC-2") y unit_type ("o2" | "air" | "vacuum"). Vacíos en
// equipos antiguos, que cuentan como un único equipo de todos los tipos.
const UNIT_FIELDS = ['unit_id', 'unit_type'];
const UNIT_TYPES = ['o2', 'air', 'vacuum'];
const EXTRA_FIELDS = PLC_FIELDS.concat(UNIT_FIELDS);
const DATA_COLS = LEGACY_COLS + EXTRA_FIELDS.length;
const ONLINE_MS = 60000;

function ensureExtraHeaders_(sheet) {
  if (sheet.getMaxColumns() >= DATA_COLS &&
      sheet.getRange(1, DATA_COLS).getValue() === EXTRA_FIELDS[EXTRA_FIELDS.length - 1]) return;
  if (sheet.getMaxColumns() < DATA_COLS) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), DATA_COLS - sheet.getMaxColumns());
  }
  sheet.getRange(1, LEGACY_COLS + 1, 1, EXTRA_FIELDS.length).setValues([EXTRA_FIELDS])
    .setFontWeight('bold').setBackground('#0f172a').setFontColor('#38bdf8');
}

// Campos que el equipo no envía quedan vacíos (se devuelven como null).
function extraCell_(body, key) {
  var v = body[key];
  if (v === undefined || v === null) return '';
  if (key === 'unit_id') return String(v).trim();
  if (key === 'unit_type') {
    v = String(v).trim().toLowerCase();
    return UNIT_TYPES.indexOf(v) !== -1 ? v : '';
  }
  if (PLC_JSON_FIELDS.indexOf(key) !== -1) return JSON.stringify(v);
  return v;
}

// Lee las filas de datos sin fallar si la hoja aún no tiene las columnas PLC.
function readDataRows_(sheet, start, last) {
  var width = Math.min(DATA_COLS, sheet.getMaxColumns());
  var vals = sheet.getRange(start, 1, last - start + 1, width).getValues();
  if (width < DATA_COLS) {
    vals.forEach(function(r) { while (r.length < DATA_COLS) r.push(''); });
  }
  return vals;
}

function postData_(body) {
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SH_DATA);
  if (!sheet) return err_('Hoja ' + SH_DATA + ' no encontrada.');
  ensureExtraHeaders_(sheet);
  // Guardamos el timestamp como texto ISO (UTC). Si se guarda como objeto
  // Date, Google Sheets lo reinterpreta segun la zona horaria de la hoja al
  // leerlo, desfasandolo varias horas y rompiendo la deteccion de conexion.
  var row = [
    new Date().toISOString(), body.hospital_id||'', body.o2_flow_m3h||0,
    body.tower_a_pressure_bar||0, body.tower_b_pressure_bar||0,
    body.o2_tank_pressure_bar||0, body.o2_purity_pct||0,
    body.psa_dewpoint_c||0, body.compressor_status||'',
    body.compressor_hours||0, body.air_line_pressure_bar||0,
    body.air_dewpoint_c||0, body.vacuum_pump_status||'', body.vacuum_level_mmhg||0,
  ];
  EXTRA_FIELDS.forEach(function(k) { row.push(extraCell_(body, k)); });
  sheet.appendRow(row);
  return ok_({ timestamp: new Date().toISOString() });
}

function getData_(hospitalId, unitId) {
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SH_DATA);
  if (!sheet) return ok_({ count: 0, rows: [], now: new Date().toISOString() });
  var last = sheet.getLastRow();
  if (last < 2) return ok_({ count: 0, rows: [], now: new Date().toISOString() });
  // Escanea muchas filas hacia atras para encontrar registros aunque el
  // equipo lleve tiempo sin enviar (sus filas quedan empujadas hacia arriba).
  var start = Math.max(2, last - SCAN_ROWS + 1);
  var vals  = readDataRows_(sheet, start, last);
  var unitCol = LEGACY_COLS + EXTRA_FIELDS.indexOf('unit_id');
  var rows  = vals.filter(function(r) {
    return (!hospitalId || r[1] === hospitalId) && (!unitId || String(r[unitCol]) === unitId);
  }).slice(-MAX_ROWS).map(rowToObj_);
  return ok_({ count: rows.length, rows: rows, now: new Date().toISOString() });
}

function getLatestAll_() {
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SH_DATA);
  if (!sheet) return ok_({ count: 0, rows: [], now: new Date().toISOString() });
  var last = sheet.getLastRow();
  if (last < 2) return ok_({ count: 0, rows: [], now: new Date().toISOString() });
  var start = Math.max(2, last - SCAN_ROWS + 1);
  var vals  = readDataRows_(sheet, start, last);
  var unitCol = LEGACY_COLS + EXTRA_FIELDS.indexOf('unit_id');
  // Última lectura de cada equipo, agrupada por hospital
  var byHosp = {};
  vals.forEach(function(r) {
    if (!r[1]) return;
    var h = byHosp[r[1]] || (byHosp[r[1]] = {});
    h[String(r[unitCol] || '')] = r;
  });
  var nowMs = Date.now();
  var rows = Object.keys(byHosp).map(function(hid) {
    var units = Object.keys(byHosp[hid]).map(function(k) { return rowToObj_(byHosp[hid][k]); });
    units.sort(function(a, b) { return String(a.unit_id || '').localeCompare(String(b.unit_id || '')); });
    var summary = units.length === 1 ? Object.assign({}, units[0]) : summarizeUnits_(units, nowMs);
    summary.units = units;
    return summary;
  });
  return ok_({ count: rows.length, rows: rows, now: new Date(nowMs).toISOString() });
}

function isOnline_(u, nowMs) {
  var t = u.timestamp ? new Date(u.timestamp).getTime() : 0;
  return Math.abs(nowMs - t) < ONLINE_MS;
}

function hasType_(u, type) { return !u.unit_type || u.unit_type === type; }

function purityEvaluable_(u) {
  if (u.plc_online === false) return false;
  return u.plc_plant_state === null || u.plc_plant_state === undefined || Number(u.plc_plant_state) === 1;
}

// Elige el equipo "peor" según compare(a, b) < 0 => a es peor.
function worst_(list, compare) {
  return list.reduce(function(w, u) { return (w === null || compare(u, w) < 0) ? u : w; }, null);
}

// Resumen de un hospital con varios equipos, con la misma forma que una
// lectura individual (compatible con quien lee una fila por hospital):
// pureza y datos PLC de la planta de O2 en peor estado, caudal de O2 sumado,
// peor presión de aire y peor vacío. Solo cuentan los equipos en línea; si
// no hay ninguno, se usan todos.
function summarizeUnits_(units, nowMs) {
  var online = units.filter(function(u) { return isOnline_(u, nowMs); });
  var pool = online.length ? online : units;
  var latest = worst_(units, function(a, b) { return String(b.timestamp).localeCompare(String(a.timestamp)); });
  var s = Object.assign({}, latest);
  s.unit_id = null;
  s.unit_type = null;

  var o2 = pool.filter(function(u) { return hasType_(u, 'o2'); });
  if (o2.length) {
    var producing = o2.filter(purityEvaluable_);
    var rep = producing.length
      ? worst_(producing, function(a, b) { return Number(a.o2_purity_pct) - Number(b.o2_purity_pct); })
      : worst_(o2, function(a, b) { return String(b.timestamp).localeCompare(String(a.timestamp)); });
    ['o2_purity_pct', 'tower_a_pressure_bar', 'tower_b_pressure_bar', 'o2_tank_pressure_bar',
     'psa_dewpoint_c'].concat(PLC_FIELDS).forEach(function(k) { s[k] = rep[k]; });
    s.o2_flow_m3h = o2.reduce(function(t, u) { return t + (Number(u.o2_flow_m3h) || 0); }, 0);
  }

  var air = pool.filter(function(u) { return hasType_(u, 'air'); });
  if (air.length) {
    var a = worst_(air, function(x, y) { return Number(x.air_line_pressure_bar) - Number(y.air_line_pressure_bar); });
    s.air_line_pressure_bar = a.air_line_pressure_bar;
    s.air_dewpoint_c = Math.max.apply(null, air.map(function(u) { return Number(u.air_dewpoint_c) || -999; }));
    s.compressor_status = statusOf_(air, 'compressor_status');
    s.compressor_hours = Math.max.apply(null, air.map(function(u) { return Number(u.compressor_hours) || 0; }));
  }

  var vac = pool.filter(function(u) { return hasType_(u, 'vacuum'); });
  if (vac.length) {
    // mmHg negativos: el valor más alto (menos negativo) es el peor vacío
    s.vacuum_level_mmhg = Math.max.apply(null, vac.map(function(u) { return Number(u.vacuum_level_mmhg); }));
    s.vacuum_pump_status = statusOf_(vac, 'vacuum_pump_status');
  }
  return s;
}

function statusOf_(list, key) {
  var v = list.map(function(u) { return u[key]; });
  if (v.indexOf('FAULT') !== -1) return 'FAULT';
  if (v.indexOf('ON') !== -1) return 'ON';
  return v.indexOf('OFF') !== -1 ? 'OFF' : '';
}

function rowToObj_(r) {
  // Si ya es texto ISO se devuelve tal cual (sin reconvertir zona horaria);
  // si es un objeto Date (filas antiguas) se normaliza a ISO UTC.
  var ts = null;
  if (r[0]) ts = (typeof r[0] === 'string') ? r[0] : new Date(r[0]).toISOString();
  var obj = {
    timestamp: ts,
    hospital_id: r[1], o2_flow_m3h: r[2], tower_a_pressure_bar: r[3],
    tower_b_pressure_bar: r[4], o2_tank_pressure_bar: r[5], o2_purity_pct: r[6],
    psa_dewpoint_c: r[7], compressor_status: r[8], compressor_hours: r[9],
    air_line_pressure_bar: r[10], air_dewpoint_c: r[11], vacuum_pump_status: r[12], vacuum_level_mmhg: r[13],
  };
  EXTRA_FIELDS.forEach(function(k, i) {
    var v = r[LEGACY_COLS + i];
    if (v === '' || v === undefined) { obj[k] = null; return; }
    if (PLC_JSON_FIELDS.indexOf(k) !== -1) {
      try { v = JSON.parse(v); } catch (e) { v = null; }
    }
    obj[k] = v;
  });
  return obj;
}

function getHospitals_() {
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SH_HOSP);
  if (!sheet) return ok_({ hospitals: [] });
  var last = sheet.getLastRow();
  if (last < 2) return ok_({ hospitals: [] });
  var vals = sheet.getRange(2, 1, last - 1, 14).getValues();
  return ok_({ hospitals: vals.filter(function(r) { return r[0]; }).map(hospRowToObj_) });
}

function addHospital_(body) {
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SH_HOSP);
  if (!sheet) return err_('Hoja ' + SH_HOSP + ' no encontrada.');
  // Permite fijar un id externo (ej. el UUID que ya usa el sistema ESP32/
  // sensorMspbsId en SIGGAM) para que ambos sistemas identifiquen al mismo
  // hospital con el mismo id. Si no se pasa, se genera uno como antes.
  // El id se guarda tal cual (solo sin espacios): SIGGAM compara el texto exacto.
  var id = String(body.id || '').trim() || Utilities.getUuid();
  if (findHospitalRow_(sheet, id)) return err_('Ya existe un hospital con ese id: ' + id);
  var dup = findHospitalByName_(sheet, body.nombre, body.ciudad);
  if (dup) return err_('Ya existe un hospital con ese nombre y ciudad (id ' + dup + ').');
  var th = body.thresholds || {}, eq = body.equipment || {};
  sheet.appendRow([
    id, body.nombre||'', body.ciudad||'', body.direccion||'', body.activo !== false,
    th.o2_purity_warn||93, th.o2_purity_critical||90, th.air_pressure_min||4.5,
    th.air_pressure_max||5.5, th.vacuum_min_mmhg||-400,
    JSON.stringify({ compressor_enabled: eq.compressor_enabled !== false, vacuum_enabled: eq.vacuum_enabled !== false, psa_enabled: eq.psa_enabled !== false }),
    new Date().toISOString(),
    body.lat !== undefined ? body.lat : '', body.lon !== undefined ? body.lon : '',
  ]);
  return ok_({ id: id, message: 'Hospital creado.' });
}

function updateHospital_(body) {
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SH_HOSP);
  var row   = findHospitalRow_(sheet, body.id);
  if (!row) return err_('Hospital no encontrado: ' + body.id);
  var th = body.thresholds || {}, eq = body.equipment || {};
  var cur = sheet.getRange(row, 2, 1, 10).getValues()[0];
  var curEq = {}; try { curEq = JSON.parse(cur[9] || '{}'); } catch(e) {}
  sheet.getRange(row, 2, 1, 10).setValues([[
    body.nombre||cur[0], body.ciudad||cur[1], body.direccion||cur[2],
    body.activo !== undefined ? body.activo : cur[3],
    th.o2_purity_warn||cur[4], th.o2_purity_critical||cur[5],
    th.air_pressure_min||cur[6], th.air_pressure_max||cur[7], th.vacuum_min_mmhg||cur[8],
    JSON.stringify({
      compressor_enabled: eq.compressor_enabled !== undefined ? eq.compressor_enabled : curEq.compressor_enabled,
      vacuum_enabled:     eq.vacuum_enabled     !== undefined ? eq.vacuum_enabled     : curEq.vacuum_enabled,
      psa_enabled:        eq.psa_enabled        !== undefined ? eq.psa_enabled        : curEq.psa_enabled,
    }),
  ]]);
  // Coordenadas opcionales (columnas 13 y 14)
  if (body.lat !== undefined) sheet.getRange(row, 13).setValue(body.lat === null ? '' : body.lat);
  if (body.lon !== undefined) sheet.getRange(row, 14).setValue(body.lon === null ? '' : body.lon);
  return ok_({ message: 'Hospital actualizado.' });
}

function toggleHospital_(body) {
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SH_HOSP);
  var row   = findHospitalRow_(sheet, body.id);
  if (!row) return err_('Hospital no encontrado.');
  sheet.getRange(row, 5).setValue(body.activo);
  return ok_({ message: 'Estado actualizado.' });
}

function deleteHospital_(body) {
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SH_HOSP);
  var row   = findHospitalRow_(sheet, body.id);
  if (!row) return err_('Hospital no encontrado.');
  sheet.deleteRow(row);
  return ok_({ message: 'Hospital eliminado.' });
}

function findHospitalRow_(sheet, id) {
  if (!sheet) return null;
  var last = sheet.getLastRow();
  if (last < 2) return null;
  var ids = sheet.getRange(2, 1, last - 1, 1).getValues();
  id = String(id || '').trim();
  for (var i = 0; i < ids.length; i++) { if (String(ids[i][0]).trim() === id) return i + 2; }
  return null;
}

function normName_(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

// Devuelve el id del hospital con el mismo nombre y ciudad (sin distinguir
// mayúsculas, tildes ni espacios), o null.
function findHospitalByName_(sheet, nombre, ciudad) {
  var n = normName_(nombre), c = normName_(ciudad);
  if (!n) return null;
  var last = sheet.getLastRow();
  if (last < 2) return null;
  var vals = sheet.getRange(2, 1, last - 1, 3).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (vals[i][0] && normName_(vals[i][1]) === n && normName_(vals[i][2]) === c) return vals[i][0];
  }
  return null;
}

function hospRowToObj_(r) {
  var equipment = { compressor_enabled: true, vacuum_enabled: true, psa_enabled: true };
  try { equipment = JSON.parse(r[10] || '{}'); } catch(e) {}
  return {
    id: r[0], nombre: r[1], ciudad: r[2], direccion: r[3],
    activo: r[4] === true || r[4] === 'TRUE',
    thresholds: { o2_purity_warn: Number(r[5])||93, o2_purity_critical: Number(r[6])||90, air_pressure_min: Number(r[7])||4.5, air_pressure_max: Number(r[8])||5.5, vacuum_min_mmhg: Number(r[9])||-400 },
    equipment: equipment, created_at: r[11]||'',
    lat: (r[12] !== '' && r[12] !== undefined && r[12] !== null) ? Number(r[12]) : null,
    lon: (r[13] !== '' && r[13] !== undefined && r[13] !== null) ? Number(r[13]) : null,
  };
}

function initAll() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var d  = ss.getSheetByName(SH_DATA) || ss.insertSheet(SH_DATA);
  var h  = ss.getSheetByName(SH_HOSP) || ss.insertSheet(SH_HOSP);
  styleHeaders_(d, ['Timestamp','hospital_id','Caudal_O2_m3h','Presion_Torre_A_bar','Presion_Torre_B_bar','Presion_Tanque_O2_bar','Pureza_O2_pct','DewPoint_PSA_C','Estado_Compresor','Horas_Compresor','Presion_Linea_Aire_bar','DewPoint_Aire_C','Estado_Bomba_Vacio','Nivel_Vacio_mmHg']);
  ensureExtraHeaders_(d);
  styleHeaders_(h, ['id','nombre','ciudad','direccion','activo','o2_purity_warn','o2_purity_critical','air_pressure_min','air_pressure_max','vacuum_min_mmhg','equipment_json','created_at','lat','lon']);
  Logger.log('✅ Hojas inicializadas.');
}

function styleHeaders_(sheet, headers) {
  sheet.getRange(1,1,1,headers.length).setValues([headers]).setFontWeight('bold').setBackground('#0f172a').setFontColor('#38bdf8');
  sheet.getRange(2,1,1000,1).setNumberFormat('@STRING@');
}
