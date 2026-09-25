'use strict';

const TOKEN = document.querySelector('meta[name="api-token"]').content;
const PLC_BRANDS = ['BOGE'];
const TYPE_TEXT = { o2: 'Planta de O₂', air: 'Aire / compresor', vacuum: 'Bomba de vacío', '': 'Todos' };
const DIAG = {
  ok: ['ok', 'El equipo está enviando datos correctamente.'],
  no_autorizado: ['bad', 'El backend rechazó el token: el DEVICE_TOKEN guardado no coincide con el de Apps Script. Corrígelo en Configuración y regenera el equipo con "Reemplazar".'],
  sin_wifi: ['bad', 'No se conectó al WiFi: revisa la red y la contraseña del hospital (debe ser de 2,4 GHz), guarda el WiFi de nuevo y regenera.'],
  sin_plc: ['bad', 'No responde el PLC: revisa el cable LAN, la IP del PLC y la alimentación del ENC28J60. Puedes probar el cableado con esp32/diagnostico_enc28j60.'],
  sin_datos: ['warn', 'No se vio ningún envío: verifica de nuevo con más tiempo y comprueba que el puerto USB sea el correcto.'],
};

const state = { hospitales: [], inventario: [], estado: null, puertos: [], job: null, jobOffset: 0, map: null, marker: null };

// ── utilidades ─────────────────────────────────────────────────────────────
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false)
    e.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return e;
}
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

async function api(path, body) {
  const opts = { headers: { 'X-Token': TOKEN } };
  if (body !== undefined) {
    opts.method = 'POST';
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  try {
    const r = await fetch(path, opts);
    return await r.json();
  } catch (e) {
    return { ok: false, error: 'No hay conexión con el programa (¿se cerró la terminal?)' };
  }
}

let toastTimer;
function toast(msg, kind = 'ok') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), kind === 'bad' ? 9000 : 4500);
}

function busy(btn, on) { if (btn) btn.disabled = on; }
function fmtDate(iso) { return iso ? new Date(iso).toLocaleString('es-PY', { hour12: false }) : '—'; }
function formData(form) {
  const d = {};
  for (const e of form.elements) {
    if (!e.name) continue;
    if (e.type === 'checkbox') d[e.name] = e.checked;
    else if (e.type === 'radio') { if (e.checked) d[e.name] = e.value; }
    else d[e.name] = e.value.trim();
  }
  return d;
}
function stBadge(ok, yes = 'ok', no = 'falta') { return el('span', { class: ok ? 'st-ok' : 'st-bad' }, ok ? yes : no); }

// ── pestañas ───────────────────────────────────────────────────────────────
function showTab(name) {
  $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${name}`));
  if (name === 'hospitales' && state.map) setTimeout(() => state.map.invalidateSize(), 50);
}
$$('#tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
document.addEventListener('click', (e) => { const g = e.target.closest('[data-goto]'); if (g) showTab(g.dataset.goto); });

// ── inicio ─────────────────────────────────────────────────────────────────
async function loadCheck() {
  const r = await api('/api/check');
  const ul = $('#check-list');
  ul.replaceChildren();
  if (!r.ok) { ul.append(el('li', {}, el('span', { class: 'st-bad' }, r.error))); return; }
  const c = r.data;
  ul.append(
    el('li', {}, 'arduino-cli', stBadge(!!c.arduino_cli, 'instalado', 'falta')),
    el('li', {}, 'Core ESP32', stBadge(c.core_esp32)),
    ...Object.entries(c.librerias || {}).map(([n, ok]) => el('li', {}, `Librería ${n}`, stBadge(ok))),
    el('li', {}, 'esptool (sensores)', el('span', { class: c.esptool ? 'st-ok' : 'muted' }, c.esptool ? 'ok' : 'no instalado')),
    el('li', {}, 'mpremote (sensores)', el('span', { class: c.mpremote ? 'st-ok' : 'muted' }, c.mpremote ? 'ok' : 'no instalado')),
  );
  $('#ports-perm').classList.toggle('hidden', !(c.puertos_sin_permiso || []).length);
}

async function loadPorts() {
  const r = await api('/api/puertos');
  state.puertos = r.ok ? r.data : [];
  const ul = $('#ports-list');
  ul.replaceChildren(...(state.puertos.length ? state.puertos.map((p) => el('li', {}, p, el('span', { class: 'st-ok' }, 'conectado')))
    : [el('li', { class: 'muted' }, 'Ningún ESP32 conectado por USB')]));
  const sel = $('#sel-puerto');
  const prev = sel.value;
  sel.replaceChildren(...(state.puertos.length ? state.puertos.map((p) => el('option', { value: p }, p))
    : [el('option', { value: '' }, 'sin ESP32 conectado')]));
  if (state.puertos.includes(prev)) sel.value = prev;
}

async function loadEstado() {
  const r = await api('/api/estado');
  if (!r.ok) return toast(r.error, 'bad');
  const e = state.estado = r.data;
  $('#cfg-dir').textContent = e.config_dir;
  $('#st-device').textContent = e.device_token ? '· guardado' : '· falta';
  $('#st-admin').textContent = e.admin_token ? '· guardado' : '· falta (necesario para crear hospitales)';
  $('#cfg-url').placeholder = e.api_url_final ? `guardada: …${e.api_url_final}` : 'https://script.google.com/macros/s/…/exec';
  $('#mpy-actual').textContent = e.micropython_bin ? e.micropython_bin.split('/').pop() : 'ninguno';
  $('#config-list').replaceChildren(
    el('li', {}, 'URL del backend', stBadge(!!e.api_url_final, 'guardada')),
    el('li', {}, 'DEVICE_TOKEN', stBadge(e.device_token, 'guardado')),
    el('li', {}, 'ADMIN_TOKEN', stBadge(e.admin_token, 'guardado')),
    el('li', {}, 'WiFi de hospitales', el('span', { class: 'st-ok' }, String(e.wifi.length))),
    el('li', {}, 'Firmware MicroPython', el('span', { class: e.micropython_bin ? 'st-ok' : 'muted' }, e.micropython_bin ? 'listo' : 'no cargado')),
  );
}

$('#btn-instalar').addEventListener('click', async () => {
  const r = await api('/api/trabajos', { tipo: 'instalar', params: { sensores: $('#chk-sensores').checked } });
  if (!r.ok) return toast(r.error, 'bad');
  followJob(r.trabajo, 'Instalar herramientas', () => { loadCheck(); loadPorts(); });
});
$('#btn-refresh-ports').addEventListener('click', () => { loadPorts(); loadCheck(); });
$('#btn-acceso').addEventListener('click', async () => {
  const r = await api('/api/acceso-directo', {});
  toast(r.ok ? r.salida : r.error, r.ok ? 'ok' : 'bad');
});

// ── configuración ──────────────────────────────────────────────────────────
$('#form-config').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  const d = formData(f);
  const body = {};
  if (d.api_url) body.api_url = d.api_url;
  if (d.device_token) body.device_token = d.device_token;
  if (d.admin_token) body.admin_token = d.admin_token;
  if (!Object.keys(body).length) return toast('No hay cambios que guardar', 'bad');
  const r = await api('/api/config', body);
  if (!r.ok) return toast(r.error, 'bad');
  f.reset();
  toast('Configuración guardada');
  await loadEstado();
  loadHospitales();
});
$('#form-importar').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const r = await api('/api/importar', formData(ev.target));
  if (!r.ok) return toast(r.error, 'bad');
  toast(r.salida || 'Importado');
  loadEstado();
  loadHospitales();
});
$('#form-mpy').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const r = await api('/api/firmware-mpy', formData(ev.target));
  toast(r.ok ? r.salida : r.error, r.ok ? 'ok' : 'bad');
  if (r.ok) { ev.target.reset(); loadEstado(); }
});

// ── hospitales ─────────────────────────────────────────────────────────────
async function loadHospitales() {
  const r = await api('/api/hospitales');
  if (!r.ok) {
    $('#tbl-hospitales tbody').replaceChildren(el('tr', {}, el('td', { colspan: 6, class: 'muted' }, r.error)));
    return;
  }
  state.hospitales = r.data.sort((a, b) => a.nombre.localeCompare(b.nombre));
  renderHospitales();
  fillHospitalSelects();
}

function eqBadges(eq = {}) {
  return [['psa_enabled', 'PSA'], ['compressor_enabled', 'Compresor'], ['vacuum_enabled', 'Vacío']]
    .map(([k, t]) => el('span', { class: `badge ${eq[k] !== false ? 'ok' : ''}` }, t));
}

function renderHospitales() {
  const q = $('#h-buscar').value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const rows = state.hospitales.filter((h) => !q || `${h.nombre} ${h.ciudad} ${h.id}`.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q));
  const tb = $('#tbl-hospitales tbody');
  if (!rows.length) return tb.replaceChildren(el('tr', {}, el('td', { colspan: 6, class: 'muted' }, 'Sin hospitales')));
  tb.replaceChildren(...rows.map((h) => el('tr', {},
    el('td', {}, el('b', {}, h.nombre), el('div', { class: 'muted small' }, [h.ciudad, h.direccion].filter(Boolean).join(' · ')),
      el('div', { class: 'id', title: 'Clic para copiar el id', onclick: () => { navigator.clipboard?.writeText(h.id); toast('id copiado'); } }, h.id),
      !h.activo && el('span', { class: 'badge' }, 'inactivo')),
    el('td', {}, el('span', { class: `badge ${h.en_linea ? 'ok' : 'bad'}` }, h.en_linea ? 'En línea' : 'Sin señal'),
      el('div', { class: 'muted small' }, h.ultimo ? `último ${fmtDate(h.ultimo)}` : 'sin datos')),
    el('td', {}, eqBadges(h.equipment)),
    el('td', {}, h.unidades.length ? h.unidades.map((u) => el('span', { class: `badge ${u.en_linea ? 'ok' : 'bad'}`, title: `último ${fmtDate(u.ultimo)}` },
      u.unit_id || 'equipo')) : el('span', { class: 'muted small' }, '—')),
    el('td', {}, el('span', { class: `badge ${h.wifi_guardado ? 'ok' : 'warn'}` }, h.wifi_guardado ? 'guardado' : 'falta')),
    el('td', {}, el('div', { class: 'actions' },
      el('button', { class: 'small', onclick: () => editEquipos(h) }, 'Equipos'),
      el('button', { class: 'small', onclick: () => editWifi(h) }, 'WiFi'),
      el('button', { class: 'small primary', onclick: () => nuevoEquipo(h.id) }, '+ Equipo'))),
  )));
}

function fillHospitalSelects() {
  for (const sel of $$('.sel-hospital')) {
    const prev = sel.value;
    const first = sel.options[0];
    sel.replaceChildren(first, ...state.hospitales.filter((h) => h.activo)
      .map((h) => el('option', { value: h.id }, `${h.nombre}${h.ciudad ? ` (${h.ciudad})` : ''}`)));
    sel.value = prev;
  }
}

$('#h-buscar').addEventListener('input', renderHospitales);
$('#btn-h-refresh').addEventListener('click', loadHospitales);

$('#btn-h-dups').addEventListener('click', async () => {
  const box = $('#dups');
  box.classList.remove('hidden');
  box.replaceChildren(el('p', { class: 'muted' }, 'Revisando…'));
  const r = await api('/api/duplicados');
  if (!r.ok) return box.replaceChildren(el('p', { class: 'st-bad' }, r.error));
  const { grupos, ids_dudosos: bad } = r.data;
  box.replaceChildren(...[
    el('div', { class: 'row between' }, el('h2', {}, 'Revisión de duplicados'),
      el('button', { class: 'small', onclick: () => box.classList.add('hidden') }, 'Cerrar')),
    grupos.length ? el('p', { class: 'muted small' }, 'Conserva el que tenga el ID de SIGGAM (y al que envían sus ESP32) y desactiva el otro desde el panel web o con Claude (merge_hospitals).')
      : el('p', { class: 'st-ok' }, 'No hay posibles duplicados.'),
    ...grupos.map((g) => el('div', { class: 'subcard', style: 'margin-bottom:8px' },
      ...g.map((h) => el('div', {}, el('b', {}, h.nombre), ` (${h.ciudad || 'sin ciudad'}) `, el('span', { class: 'id' }, h.id),
        el('span', { class: 'muted small' }, ` · alta ${fmtDate(h.created_at)} · ${h.lat != null ? 'con ubicación' : 'sin ubicación'} · ${h.ultimo ? 'último dato ' + fmtDate(h.ultimo) : 'nunca recibió datos'}`))))),
    bad.length ? el('p', { class: 'warn' }, 'IDs sin formato UUID (confirmar con SIGGAM): ', bad.map((h) => `${h.nombre}: ${h.id}`).join(' · ')) : null,
  ].filter(Boolean));
});

async function editEquipos(h) {
  const eq = h.equipment || {};
  const box = $('#dups');
  box.classList.remove('hidden');
  const chk = (name, label, on) => el('label', { class: 'inline' }, el('input', { type: 'checkbox', name, checked: on !== false }), label);
  const form = el('form', { class: 'stack' },
    el('div', { class: 'row between' }, el('h2', {}, `Equipos de ${h.nombre}`),
      el('button', { type: 'button', class: 'small', onclick: () => box.classList.add('hidden') }, 'Cerrar')),
    el('p', { class: 'muted small' }, 'El dashboard solo genera alarmas de los equipos activos.'),
    el('div', { class: 'row' }, chk('psa', 'Planta PSA de O₂', eq.psa_enabled), chk('compresor', 'Compresor de aire', eq.compressor_enabled),
      chk('vacio', 'Bomba de vacío', eq.vacuum_enabled)),
    el('div', {}, el('button', { class: 'primary' }, 'Guardar')));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const d = formData(form);
    const r = await api('/api/hospitales/equipos', { id: h.id, psa: d.psa, compresor: d.compresor, vacio: d.vacio });
    toast(r.ok ? r.salida : r.error, r.ok ? 'ok' : 'bad');
    if (r.ok) { box.classList.add('hidden'); loadHospitales(); }
  });
  box.replaceChildren(form);
  box.scrollIntoView({ behavior: 'smooth' });
}

function editWifi(h) {
  const box = $('#dups');
  box.classList.remove('hidden');
  const ssid = el('input', { autocomplete: 'off' }), pass = el('input', { type: 'password', autocomplete: 'new-password' });
  const form = el('form', { class: 'stack' },
    el('div', { class: 'row between' }, el('h2', {}, `WiFi de ${h.nombre}`),
      el('button', { type: 'button', class: 'small', onclick: () => box.classList.add('hidden') }, 'Cerrar')),
    el('p', { class: 'muted small' }, h.wifi_guardado ? 'Ya hay un WiFi guardado; esto lo reemplaza.' : 'Todavía no hay WiFi guardado para este hospital.'),
    el('div', { class: 'grid2 tight' }, el('label', {}, 'Red (SSID)', ssid), el('label', {}, 'Contraseña', pass)),
    el('p', { class: 'muted small' }, 'El ESP32 solo usa WiFi de 2,4 GHz. Se guarda solo en tu PC.'),
    el('div', {}, el('button', { class: 'primary' }, 'Guardar WiFi')));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const r = await api('/api/wifi', { hospital_id: h.id, ssid: ssid.value, password: pass.value });
    toast(r.ok ? r.salida : r.error, r.ok ? 'ok' : 'bad');
    if (r.ok) { box.classList.add('hidden'); await loadEstado(); loadHospitales(); }
  });
  box.replaceChildren(form);
  box.scrollIntoView({ behavior: 'smooth' });
  ssid.focus();
}

// Nuevo hospital + mapa
function initMap() {
  if (state.map || !window.L) {
    if (!window.L) $('#map').replaceChildren(el('p', { class: 'muted pad', style: 'padding:14px' }, 'El mapa no cargó (sin internet); ingresa latitud y longitud a mano.'));
    return;
  }
  state.map = L.map('map').setView([-23.5, -58.4], 6);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(state.map);
  state.map.on('click', (e) => setLatLon(e.latlng.lat, e.latlng.lng, false));
}
function setLatLon(lat, lon, pan = true) {
  const f = $('#form-hospital');
  f.lat.value = lat.toFixed(6);
  f.lon.value = lon.toFixed(6);
  if (!state.map) return;
  if (state.marker) state.marker.setLatLng([lat, lon]); else state.marker = L.marker([lat, lon]).addTo(state.map);
  if (pan) state.map.setView([lat, lon], 16);
}
function updateGmapsLink() {
  const f = $('#form-hospital');
  $('#lnk-gmaps').href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${f.nombre.value} ${f.ciudad.value} Paraguay`)}`;
}
$('#btn-h-nuevo').addEventListener('click', () => {
  $('#form-hospital').classList.remove('hidden');
  initMap();
  setTimeout(() => state.map?.invalidateSize(), 60);
  updateGmapsLink();
  $('#form-hospital').nombre.focus();
});
$('#btn-h-cancelar').addEventListener('click', () => { $('#form-hospital').classList.add('hidden'); });
['nombre', 'ciudad'].forEach((n) => $('#form-hospital').elements[n].addEventListener('input', updateGmapsLink));
['lat', 'lon'].forEach((n) => $('#form-hospital').elements[n].addEventListener('change', () => {
  const f = $('#form-hospital');
  const lat = parseFloat(f.lat.value.replace(',', '.')), lon = parseFloat(f.lon.value.replace(',', '.'));
  if (Number.isFinite(lat) && Number.isFinite(lon)) setLatLon(lat, lon);
}));

$('#form-hospital').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  const d = formData(f);
  d.lat = d.lat.replace(',', '.');
  d.lon = d.lon.replace(',', '.');
  if (!d.lat || !d.lon) {
    if (!confirm('No indicaste la ubicación. ¿Crear el hospital sin coordenadas? (no aparecerá en el mapa del dashboard)')) return;
  }
  const btn = f.querySelector('button.primary');
  busy(btn, true);
  const r = await api('/api/hospitales', d);
  busy(btn, false);
  if (!r.ok) {
    if (/parecido/.test(r.error)) {
      $('#lbl-distinto').classList.remove('hidden');
      return toast(r.error.replace(/Si es otro hospital, repite con --confirmar-distinto\./,
        'Si es el mismo, no lo crees. Si es otro hospital, marca "Confirmo que es un hospital distinto" y vuelve a crear.'), 'bad');
    }
    return toast(r.error, 'bad');
  }
  toast(r.data.id_generado ? `Hospital creado. id ${r.data.id} — cárgalo en SIGGAM como sensorMspbsId.` : `Hospital creado con el id de SIGGAM ${r.data.id}.`);
  f.reset();
  $('#lbl-distinto').classList.add('hidden');
  f.classList.add('hidden');
  if (state.marker) { state.marker.remove(); state.marker = null; }
  await loadHospitales();
});

// ── equipos ────────────────────────────────────────────────────────────────
async function loadInventario() {
  const r = await api('/api/inventario');
  state.inventario = r.ok ? r.data : [];
  const tb = $('#tbl-equipos tbody');
  if (!state.inventario.length) return tb.replaceChildren(el('tr', {}, el('td', { colspan: 5, class: 'muted' }, 'Todavía no hay equipos. Usa "+ Nuevo equipo".')));
  const cls = { en_linea: 'ok', en_linea_con_avisos: 'warn', con_problemas: 'bad', subido: 'run', generado: '' };
  tb.replaceChildren(...state.inventario.sort((a, b) => `${a.hospital_nombre}${a.unit_id}`.localeCompare(`${b.hospital_nombre}${b.unit_id}`))
    .map((e) => el('tr', {},
      el('td', {}, el('b', {}, e.hospital_nombre || '?'), el('div', { class: 'id' }, e.hospital_id)),
      el('td', {}, el('b', {}, e.unit_id), el('div', { class: 'muted small' }, TYPE_TEXT[e.unit_type || ''] || e.unit_type)),
      el('td', {}, e.marca || '?', el('div', { class: 'muted small' }, e.firmware === 'plc' ? `Pasarela PLC · ${e.eth_ip || ''}` : `Sensores${e.lee_plc ? ' + PLC' : ''}`)),
      el('td', {}, el('span', { class: `badge ${cls[e.estado] || ''}` }, (e.estado || '').replace(/_/g, ' ')),
        el('div', { class: 'muted small' }, e.verificado ? `verificado ${fmtDate(e.verificado)}` : e.subido ? `subido ${fmtDate(e.subido)}` : `generado ${fmtDate(e.generado)}`)),
      el('td', {}, el('div', { class: 'actions' },
        el('button', { class: 'small primary', onclick: () => trabajo('subir', e) }, 'Subir'),
        el('button', { class: 'small', onclick: () => trabajo('verificar', e) }, 'Verificar'),
        el('button', { class: 'small', onclick: () => trabajo('actualizar', e) }, 'Actualizar firmware'),
        el('button', { class: 'small', onclick: async () => { const r = await api('/api/abrir', { carpeta: e.carpeta }); if (!r.ok) toast(r.error, 'bad'); } }, 'Abrir carpeta'))),
    )));
}

async function trabajo(tipo, e) {
  const puerto = $('#sel-puerto').value;
  if (tipo !== 'actualizar' && !puerto) return toast('Conecta el ESP32 por USB y pulsa "Actualizar" para detectarlo', 'bad');
  if (tipo === 'subir' && !confirm(`Subir el firmware de ${e.unit_id} (${e.hospital_nombre}) al ESP32 en ${puerto}?\nConecta solo ese ESP32.`)) return;
  const params = { carpeta: e.carpeta, puerto };
  if (tipo === 'verificar') params.segundos = e.firmware === 'sensores' ? 150 : 90;
  const r = await api('/api/trabajos', { tipo, params });
  if (!r.ok) return toast(r.error, 'bad');
  followJob(r.trabajo, `${tipo} ${e.unit_id}`, () => {
    loadInventario();
    if (tipo === 'subir') toast('Firmware subido. Ahora pulsa "Verificar".');
    if (tipo === 'actualizar') toast('Firmware actualizado en la carpeta. Pulsa "Subir" con ese ESP32 conectado.');
  });
}

// Asistente de nuevo equipo
function nuevoEquipo(hospitalId) {
  showTab('equipos');
  const f = $('#form-equipo');
  f.classList.remove('hidden');
  if (hospitalId) f.hospital_id.value = hospitalId;
  onEquipoChange(true);
  f.scrollIntoView({ behavior: 'smooth' });
}
$('#btn-e-nuevo').addEventListener('click', () => nuevoEquipo());
$('#btn-e-cancelar').addEventListener('click', () => $('#form-equipo').classList.add('hidden'));
$('#btn-e-refresh').addEventListener('click', () => { loadInventario(); loadPorts(); });

async function onEquipoChange(suggest) {
  const f = $('#form-equipo');
  const d = formData(f);
  const isBoge = PLC_BRANDS.includes((d.marca || '').toUpperCase());
  const plcOk = d.tipo === 'o2' && isBoge;
  const plcRadio = f.querySelector('input[name=firmware][value=plc]');
  plcRadio.disabled = !plcOk;
  if (!plcOk && d.firmware === 'plc') f.querySelector('input[name=firmware][value=sensores]').checked = true;
  if (plcOk && suggest === 'marca') plcRadio.checked = true;
  $('#fw-nota').textContent = plcOk
    ? 'Planta BOGE: la pasarela PLC lee todos los datos del generador por el cable LAN.'
    : d.tipo !== 'o2' ? 'Compresores y vacío se monitorean con sensores 4-20 mA.'
      : `No hay perfil de PLC para "${d.marca || 'esta marca'}": se usan sensores 4-20 mA (sirven para cualquier marca).`;
  const fw = formData(f).firmware;
  $('#net-plc').classList.toggle('hidden', fw !== 'plc');
  $('#net-sens').classList.toggle('hidden', fw !== 'sensores');
  f.leer_plc.disabled = !isBoge;
  if (!isBoge) f.leer_plc.checked = false;

  const h = state.hospitales.find((x) => x.id === d.hospital_id);
  const wifiSaved = h && state.estado && state.estado.wifi.find((w) => w.hospital_id === h.id);
  $('#wifi-estado').textContent = !h ? 'Elige un hospital.' : wifiSaved ? `Guardado: red "${wifiSaved.ssid}".` : 'Falta el WiFi de este hospital: ingrésalo aquí.';
  $('#wifi-form').classList.toggle('hidden', !h || !!wifiSaved);

  if (suggest === true || suggest === 'tipo' || suggest === 'hospital') {
    if (h) {
      const r = await api(`/api/siguiente?hospital_id=${encodeURIComponent(h.id)}&tipo=${d.tipo}`);
      if (r.ok) f.unidad.value = r.data;
    }
  }
  renderResumen();
}

function renderResumen() {
  const f = $('#form-equipo');
  const d = formData(f);
  const h = state.hospitales.find((x) => x.id === d.hospital_id);
  const wifi = h && state.estado?.wifi.find((w) => w.hospital_id === h.id);
  const lines = [
    ['Hospital', h ? `${h.nombre} (${h.id})` : '—'],
    ['Equipo', `${(d.unidad || '—').toUpperCase()} · ${TYPE_TEXT[d.tipo]}`],
    ['Marca', d.marca || '—'],
    ['ESP32', d.firmware === 'plc' ? `Pasarela PLC · ESP32 100.100.200.${d.eth_ip} → PLC 100.100.200.${d.plc_ip}` : `Sensores 4-20 mA${d.leer_plc ? ' + PLC (W5500)' : ''}`],
    ['WiFi', wifi ? `"${wifi.ssid}"` : 'falta'],
    ['Carpeta', '~/Escritorio/equipos/…'],
  ];
  $('#resumen').replaceChildren(...lines.map(([k, v]) => el('div', {}, el('b', {}, `${k}: `), v)));
}

const fe = $('#form-equipo');
fe.hospital_id.addEventListener('change', () => onEquipoChange('hospital'));
fe.querySelectorAll('input[name=tipo]').forEach((r) => r.addEventListener('change', () => onEquipoChange('tipo')));
fe.marca.addEventListener('input', () => onEquipoChange('marca'));
fe.addEventListener('change', (ev) => { if (!['hospital_id', 'tipo', 'marca'].includes(ev.target.name)) onEquipoChange(false); });
fe.unidad.addEventListener('input', renderResumen);

$('#btn-wifi-guardar').addEventListener('click', async () => {
  const id = fe.hospital_id.value;
  const r = await api('/api/wifi', { hospital_id: id, ssid: $('#wifi-ssid').value, password: $('#wifi-pass').value });
  toast(r.ok ? r.salida : r.error, r.ok ? 'ok' : 'bad');
  if (r.ok) { $('#wifi-ssid').value = ''; $('#wifi-pass').value = ''; await loadEstado(); onEquipoChange(false); loadHospitales(); }
});

fe.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const d = formData(fe);
  const h = state.hospitales.find((x) => x.id === d.hospital_id);
  if (!h) return toast('Elige un hospital', 'bad');
  if (!state.estado?.wifi.find((w) => w.hospital_id === h.id)) return toast('Guarda primero el WiFi del hospital', 'bad');
  const tipo = d.firmware === 'plc' ? 'generar-plc' : 'generar-sensores';
  const params = { hospital_id: h.id, hospital_nombre: h.nombre, unidad: d.unidad.toUpperCase(), marca: d.marca,
    reemplazar: d.reemplazar };
  if (tipo === 'generar-plc') Object.assign(params, { eth_ip: d.eth_ip, plc_ip: d.plc_ip });
  else Object.assign(params, { tipo: d.tipo, leer_plc: d.leer_plc, eth_ip: d.leer_plc ? 20 : undefined });
  const r = await api('/api/trabajos', { tipo, params });
  if (!r.ok) return toast(r.error, 'bad');
  followJob(r.trabajo, `Generar ${params.unidad}`, (job) => {
    loadInventario();
    if (job.estado === 'ok') {
      fe.classList.add('hidden');
      showTab('equipos');
      toast(`Carpeta de ${params.unidad} lista. Conecta ese ESP32 y pulsa "Subir".`);
    }
  });
});

// ── trabajos / registro ────────────────────────────────────────────────────
const followers = {};
function followJob(id, title, onDone) {
  followers[id] = onDone;
  state.job = id;
  state.jobOffset = 0;
  $('#job-log').textContent = '';
  $('#job-result').replaceChildren();
  $('#job-title').textContent = title;
  $('#job-dot').classList.remove('hidden');
  showTab('registro');
  loadJobs();
  pollJob();
}

async function pollJob() {
  const id = state.job;
  if (!id) return;
  const r = await api(`/api/trabajos/${id}?desde=${state.jobOffset}`);
  if (!r.ok || state.job !== id) return;
  const j = r.data;
  if (j.lineas.length) {
    const log = $('#job-log');
    const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 20;
    log.textContent += j.lineas.join('\n') + '\n';
    if (atBottom) log.scrollTop = log.scrollHeight;
    state.jobOffset = j.total;
  }
  const b = $('#job-badge');
  b.className = `badge ${j.estado === 'ok' ? 'ok' : j.estado === 'error' ? 'bad' : 'run'}`;
  b.textContent = j.estado === 'en_curso' ? 'en curso' : j.estado === 'ok' ? 'terminado' : 'con error';
  if (j.estado === 'en_curso') return setTimeout(pollJob, 700);
  $('#job-dot').classList.add('hidden');
  if (j.resultado) renderDiag(j.resultado);
  loadJobs();
  const cb = followers[id];
  delete followers[id];
  if (cb) cb(j);
}

function renderDiag(res) {
  const [kind, text] = DIAG[res.resultado] || ['warn', res.resultado];
  const box = el('div', { class: `diag ${res.avisos?.length && kind === 'ok' ? 'warn' : kind}` },
    el('b', {}, `Resultado: ${res.resultado.replace(/_/g, ' ')}`), el('div', {}, text),
    res.hospital_id ? el('div', { class: 'small muted' }, `Equipo grabado: ${res.unit_id} · hospital ${res.hospital_id}${res.mac_eth ? ` · MAC ${res.mac_eth}` : ''}`) : null,
    ...(res.avisos || []).map((a) => el('div', { class: 'warn' }, `⚠ ${a}`)));
  $('#job-result').replaceChildren(box);
}

async function loadJobs() {
  const r = await api('/api/trabajos');
  if (!r.ok || !r.data.length) return;
  $('#job-list').replaceChildren(...r.data.slice().reverse().map((j) => el('li', {
    class: j.id === state.job ? 'sel' : '',
    onclick: () => { state.job = j.id; state.jobOffset = 0; $('#job-log').textContent = ''; $('#job-result').replaceChildren(); $('#job-title').textContent = j.titulo; loadJobs(); pollJob(); },
  }, el('div', {}, el('b', {}, j.titulo)), el('span', { class: `badge ${j.estado === 'ok' ? 'ok' : j.estado === 'error' ? 'bad' : 'run'}` }, j.estado.replace('_', ' ')),
  el('span', { class: 'muted small' }, ` ${j.inicio}`))));
}

// ── arranque ───────────────────────────────────────────────────────────────
(async function init() {
  await loadEstado();
  loadCheck();
  loadPorts();
  loadInventario();
  await loadHospitales();
  onEquipoChange(false);
})();
