/**
 * SISTEMA DE MONITOREO — PLANTA DE GASES MEDICINALES
 * Google Apps Script v2.1.0 — Multi-hospital
 *
 * HOJAS REQUERIDAS: "Registros" y "Hospitales" (ejecutar initAll() una vez)
 */

const SHEET_ID = 'REEMPLAZAR_CON_TU_SHEET_ID';
const SH_DATA  = 'Registros';
const SH_HOSP  = 'Hospitales';
const MAX_ROWS = 100;

function ok_(data)  { return out_(Object.assign({ ok: true  }, data)); }
function err_(msg)  { return out_({ ok: false, error: msg }); }
function out_(data) { return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON); }

function doGet(e) {
  try {
    const action = (e.parameter && e.parameter.action) || 'data';
    if (action === 'hospitals')  return getHospitals_();
    if (action === 'latest_all') return getLatestAll_();
    if (action === 'data')       return getData_(e.parameter && e.parameter.hospital_id);
    return err_('Acción desconocida: ' + action);
  } catch(ex) { Logger.log('doGet ERROR: ' + ex.message); return err_(ex.message); }
}

function doPost(e) {
  try {
    const body   = JSON.parse((e.postData && e.postData.contents) || '{}');
    const action = body.action || 'data';
    if (action === 'data')            return postData_(body);
    if (action === 'add_hospital')    return addHospital_(body);
    if (action === 'update_hospital') return updateHospital_(body);
    if (action === 'toggle_hospital') return toggleHospital_(body);
    if (action === 'delete_hospital') return deleteHospital_(body);
    return err_('Acción desconocida: ' + action);
  } catch(ex) { Logger.log('doPost ERROR: ' + ex.message); return err_(ex.message); }
}

function postData_(body) {
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SH_DATA);
  if (!sheet) return err_('Hoja ' + SH_DATA + ' no encontrada.');
  // Guardamos el timestamp como texto ISO (UTC). Si se guarda como objeto
  // Date, Google Sheets lo reinterpreta segun la zona horaria de la hoja al
  // leerlo, desfasandolo varias horas y rompiendo la deteccion de conexion.
  sheet.appendRow([
    new Date().toISOString(), body.hospital_id||'', body.o2_flow_m3h||0,
    body.tower_a_pressure_bar||0, body.tower_b_pressure_bar||0,
    body.o2_tank_pressure_bar||0, body.o2_purity_pct||0,
    body.psa_dewpoint_c||0, body.compressor_status||'',
    body.compressor_hours||0, body.air_line_pressure_bar||0,
    body.air_dewpoint_c||0, body.vacuum_pump_status||'', body.vacuum_level_mmhg||0,
  ]);
  return ok_({ timestamp: new Date().toISOString() });
}

function getData_(hospitalId) {
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SH_DATA);
  if (!sheet) return ok_({ count: 0, rows: [], now: new Date().toISOString() });
  var last = sheet.getLastRow();
  if (last < 2) return ok_({ count: 0, rows: [], now: new Date().toISOString() });
  var start = Math.max(2, last - 500 + 1);
  var vals  = sheet.getRange(start, 1, last - start + 1, 14).getValues();
  var rows  = vals.filter(function(r) { return !hospitalId || r[1] === hospitalId; }).slice(-MAX_ROWS).map(rowToObj_);
  return ok_({ count: rows.length, rows: rows, now: new Date().toISOString() });
}

function getLatestAll_() {
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SH_DATA);
  if (!sheet) return ok_({ count: 0, rows: [], now: new Date().toISOString() });
  var last = sheet.getLastRow();
  if (last < 2) return ok_({ count: 0, rows: [], now: new Date().toISOString() });
  var start = Math.max(2, last - 1000 + 1);
  var vals  = sheet.getRange(start, 1, last - start + 1, 14).getValues();
  var map   = {};
  vals.forEach(function(r) { if (r[1]) map[r[1]] = rowToObj_(r); });
  return ok_({ count: Object.keys(map).length, rows: Object.values(map), now: new Date().toISOString() });
}

function rowToObj_(r) {
  // Si ya es texto ISO se devuelve tal cual (sin reconvertir zona horaria);
  // si es un objeto Date (filas antiguas) se normaliza a ISO UTC.
  var ts = null;
  if (r[0]) ts = (typeof r[0] === 'string') ? r[0] : new Date(r[0]).toISOString();
  return {
    timestamp: ts,
    hospital_id: r[1], o2_flow_m3h: r[2], tower_a_pressure_bar: r[3],
    tower_b_pressure_bar: r[4], o2_tank_pressure_bar: r[5], o2_purity_pct: r[6],
    psa_dewpoint_c: r[7], compressor_status: r[8], compressor_hours: r[9],
    air_line_pressure_bar: r[10], air_dewpoint_c: r[11], vacuum_pump_status: r[12], vacuum_level_mmhg: r[13],
  };
}

function getHospitals_() {
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SH_HOSP);
  if (!sheet) return ok_({ hospitals: [] });
  var last = sheet.getLastRow();
  if (last < 2) return ok_({ hospitals: [] });
  var vals = sheet.getRange(2, 1, last - 1, 12).getValues();
  return ok_({ hospitals: vals.filter(function(r) { return r[0]; }).map(hospRowToObj_) });
}

function addHospital_(body) {
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SH_HOSP);
  if (!sheet) return err_('Hoja ' + SH_HOSP + ' no encontrada.');
  var id = Utilities.getUuid();
  var th = body.thresholds || {}, eq = body.equipment || {};
  sheet.appendRow([
    id, body.nombre||'', body.ciudad||'', body.direccion||'', body.activo !== false,
    th.o2_purity_warn||93, th.o2_purity_critical||90, th.air_pressure_min||4.5,
    th.air_pressure_max||5.5, th.vacuum_min_mmhg||-400,
    JSON.stringify({ compressor_enabled: eq.compressor_enabled !== false, vacuum_enabled: eq.vacuum_enabled !== false, psa_enabled: eq.psa_enabled !== false }),
    new Date().toISOString(),
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
  for (var i = 0; i < ids.length; i++) { if (ids[i][0] === id) return i + 2; }
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
  };
}

function initAll() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var d  = ss.getSheetByName(SH_DATA) || ss.insertSheet(SH_DATA);
  var h  = ss.getSheetByName(SH_HOSP) || ss.insertSheet(SH_HOSP);
  styleHeaders_(d, ['Timestamp','hospital_id','Caudal_O2_m3h','Presion_Torre_A_bar','Presion_Torre_B_bar','Presion_Tanque_O2_bar','Pureza_O2_pct','DewPoint_PSA_C','Estado_Compresor','Horas_Compresor','Presion_Linea_Aire_bar','DewPoint_Aire_C','Estado_Bomba_Vacio','Nivel_Vacio_mmHg']);
  styleHeaders_(h, ['id','nombre','ciudad','direccion','activo','o2_purity_warn','o2_purity_critical','air_pressure_min','air_pressure_max','vacuum_min_mmhg','equipment_json','created_at']);
  Logger.log('✅ Hojas inicializadas.');
}

function styleHeaders_(sheet, headers) {
  sheet.getRange(1,1,1,headers.length).setValues([headers]).setFontWeight('bold').setBackground('#0f172a').setFontColor('#38bdf8');
  sheet.getRange(2,1,1000,1).setNumberFormat('@STRING@');
}
