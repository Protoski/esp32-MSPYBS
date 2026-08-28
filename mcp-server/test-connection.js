#!/usr/bin/env node
/**
 * Prueba rápida y standalone de conexión al backend (Google Apps Script).
 * No requiere el SDK de MCP, solo Node.js 18+ (usa fetch nativo).
 *
 * Uso:
 *   MSPYBS_API_URL="https://script.google.com/macros/s/XXX/exec" node test-connection.js
 */

const API_URL = process.env.MSPYBS_API_URL;
const ONLINE_THRESHOLD_MS = 60_000;

if (!API_URL) {
  console.error("❌ Falta la variable de entorno MSPYBS_API_URL.");
  console.error('   Uso: MSPYBS_API_URL="https://script.google.com/macros/s/XXX/exec" node test-connection.js');
  process.exit(1);
}

async function apiGet(action, extra = {}) {
  const url = new URL(API_URL);
  url.searchParams.set("action", action);
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
  url.searchParams.set("_t", String(Date.now()));
  const res = await fetch(url.toString(), { cache: "no-store" });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${text.slice(0, 200)}`);
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Respuesta no es JSON válido: ${text.slice(0, 200)}`);
  }
  if (!data.ok) throw new Error(data.error || "Error desconocido del backend.");
  return data;
}

function computeStatus(latestRow, nowIso) {
  if (!latestRow || !latestRow.timestamp) {
    return { online: false, lastSeen: null, ageSeconds: null };
  }
  const now = nowIso ? new Date(nowIso).getTime() : Date.now();
  const ts = new Date(latestRow.timestamp).getTime();
  const ageMs = now - ts;
  const online = ageMs < ONLINE_THRESHOLD_MS && ageMs > -ONLINE_THRESHOLD_MS;
  return { online, lastSeen: latestRow.timestamp, ageSeconds: Math.round(ageMs / 1000) };
}

async function main() {
  console.log(`🔌 Conectando a: ${API_URL}\n`);

  console.log("→ GET ?action=hospitals");
  const { hospitals } = await apiGet("hospitals");
  console.log(`  ✅ ${hospitals.length} planta(s) registrada(s)\n`);

  console.log("→ GET ?action=latest_all");
  const { rows, now } = await apiGet("latest_all");
  console.log(`  ✅ ${rows.length} planta(s) con datos históricos. Hora del servidor: ${now}\n`);

  const latestByHospital = Object.fromEntries(rows.map((r) => [r.hospital_id, r]));

  console.log("=== Estado de las plantas ===");
  for (const h of hospitals) {
    const status = computeStatus(latestByHospital[h.id], now);
    const online = h.activo && status.online;
    const icon = online ? "🟢 EN LÍNEA" : "🔴 SIN SEÑAL";
    const detalle = status.lastSeen
      ? `último dato hace ${status.ageSeconds}s (${status.lastSeen})`
      : "sin datos recibidos";
    console.log(`- ${h.nombre} (${h.ciudad || "sin ciudad"}) [${h.activo ? "activo" : "inactivo"}]: ${icon} — ${detalle}`);
  }

  console.log("\n✅ Conexión y datos verificados correctamente.");
}

main().catch((err) => {
  console.error("\n❌ Error al conectar o procesar la respuesta:");
  console.error("   " + err.message);
  process.exit(1);
});
