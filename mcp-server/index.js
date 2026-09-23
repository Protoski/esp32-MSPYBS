#!/usr/bin/env node
/**
 * Servidor MCP — Estado de plantas MSPYBS
 *
 * Expone herramientas para que cualquier cliente MCP (Claude Desktop, etc.)
 * consulte si una planta de gases medicinales está EN LÍNEA o SIN SEÑAL,
 * usando el mismo backend (Google Apps Script + Google Sheets) que el
 * dashboard Next.js del proyecto.
 *
 * Configuración: variable de entorno MSPYBS_API_URL con la URL de
 * implementación del Apps Script (la misma que NEXT_PUBLIC_API_URL en el
 * frontend), ej:
 *   https://script.google.com/macros/s/TU_DEPLOYMENT_ID/exec
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_URL = process.env.MSPYBS_API_URL;
// Una planta se considera "en línea" si su último dato llegó hace menos de
// esto (coincide con el criterio usado en el frontend: frontend/app/page.tsx).
const ONLINE_THRESHOLD_MS = 60_000;

if (!API_URL) {
  console.error(
    "[mspybs-mcp-server] Falta la variable de entorno MSPYBS_API_URL " +
      "(URL de implementación del Google Apps Script)."
  );
  process.exit(1);
}

async function apiGet(params) {
  const url = new URL(API_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("_t", String(Date.now()));
  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "Error desconocido del backend.");
  return data;
}

async function fetchHospitals() {
  const data = await apiGet({ action: "hospitals" });
  return data.hospitals || [];
}

async function fetchLatestAll() {
  const data = await apiGet({ action: "latest_all" });
  return { rows: data.rows || [], now: data.now };
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

function findHospital(hospitals, query) {
  const q = query.trim().toLowerCase();
  return (
    hospitals.find((h) => h.id.toLowerCase() === q) ||
    hospitals.find((h) => h.nombre.toLowerCase() === q) ||
    hospitals.find((h) => h.nombre.toLowerCase().includes(q))
  );
}

async function buildStatusList() {
  const [hospitals, { rows, now }] = await Promise.all([
    fetchHospitals(),
    fetchLatestAll(),
  ]);
  const latestByHospital = {};
  for (const r of rows) latestByHospital[r.hospital_id] = r;

  return hospitals.map((h) => {
    const status = computeStatus(latestByHospital[h.id], now);
    return {
      id: h.id,
      nombre: h.nombre,
      ciudad: h.ciudad,
      activo: h.activo,
      online: h.activo ? status.online : false,
      lastSeen: status.lastSeen,
      ageSeconds: status.ageSeconds,
    };
  });
}

const server = new McpServer({
  name: "mspybs-plant-status",
  version: "1.0.0",
});

server.registerTool(
  "get_plant_status",
  {
    title: "Estado de una planta",
    description:
      "Consulta si una planta de gases medicinales (hospital) está EN LÍNEA " +
      "o SIN SEÑAL, según los últimos datos recibidos en Google Sheets. " +
      "Acepta el nombre (o parte del nombre) o el ID del hospital.",
    inputSchema: {
      plant: z
        .string()
        .describe("Nombre (o parte del nombre) o ID del hospital/planta a consultar."),
    },
  },
  async ({ plant }) => {
    const hospitals = await fetchHospitals();
    const hospital = findHospital(hospitals, plant);
    if (!hospital) {
      return {
        content: [
          {
            type: "text",
            text: `No se encontró ninguna planta que coincida con "${plant}".`,
          },
        ],
        isError: true,
      };
    }
    const { rows, now } = await fetchLatestAll();
    const latest = rows.find((r) => r.hospital_id === hospital.id) || null;
    const status = computeStatus(latest, now);
    const online = hospital.activo ? status.online : false;

    const lines = [
      `Planta: ${hospital.nombre} (${hospital.ciudad || "sin ciudad"})`,
      `Estado del hospital: ${hospital.activo ? "activo" : "inactivo"}`,
      `Conexión: ${online ? "🟢 EN LÍNEA" : "🔴 SIN SEÑAL"}`,
      status.lastSeen
        ? `Último dato recibido: ${status.lastSeen} (hace ${status.ageSeconds}s)`
        : "Sin datos recibidos.",
    ];

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

server.registerTool(
  "list_plants_status",
  {
    title: "Estado de todas las plantas",
    description:
      "Lista todas las plantas (hospitales) registradas y su estado " +
      "actual: EN LÍNEA o SIN SEÑAL, según los últimos datos en Google Sheets.",
    inputSchema: {},
  },
  async () => {
    const list = await buildStatusList();
    if (list.length === 0) {
      return { content: [{ type: "text", text: "No hay plantas registradas." }] };
    }
    const lines = list.map(
      (p) =>
        `- ${p.nombre} (${p.ciudad || "sin ciudad"}): ${
          p.online ? "🟢 EN LÍNEA" : "🔴 SIN SEÑAL"
        }${p.activo ? "" : " [inactivo]"}${
          p.lastSeen ? ` — último dato hace ${p.ageSeconds}s` : " — sin datos"
        }`
    );
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[mspybs-mcp-server] Servidor MCP iniciado (stdio).");
