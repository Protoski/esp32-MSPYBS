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
// Opcional: habilita las herramientas de escritura (ADMIN_TOKEN de las
// Propiedades del script del backend).
const ADMIN_TOKEN = process.env.MSPYBS_ADMIN_TOKEN;
// Una planta se considera "en línea" si su último dato llegó hace menos de
// esto (coincide con el criterio usado en el frontend: frontend/app/page.tsx).
const ONLINE_THRESHOLD_MS = 60_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

async function apiPost(body) {
  // text/plain evita el preflight CORS; Apps Script responde con un redirect
  // que fetch sigue como GET hasta la respuesta real.
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ token: ADMIN_TOKEN, ...body }),
    redirect: "follow",
  });
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

function normName(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function findHospital(hospitals, query) {
  const q = query.trim().toLowerCase();
  return (
    hospitals.find((h) => h.id.toLowerCase() === q) ||
    hospitals.find((h) => h.nombre.toLowerCase() === q) ||
    hospitals.find((h) => h.nombre.toLowerCase().includes(q))
  );
}

const UNIT_TYPE_TEXT = { o2: "planta de O₂", air: "aire medicinal", vacuum: "bomba de vacío" };

// Una línea por equipo del hospital (solo si tiene más de uno).
function unitLines(latestRow, nowIso) {
  const units = latestRow?.units ?? [];
  if (units.length < 2) return [];
  return units.map((u) => {
    const st = computeStatus(u, nowIso);
    const type = u.unit_type ? ` (${UNIT_TYPE_TEXT[u.unit_type] ?? u.unit_type})` : "";
    let detail = "";
    if (st.online && (!u.unit_type || u.unit_type === "o2")) {
      detail = u.plc_plant_state != null && u.plc_plant_state !== 1
        ? ` — generador detenido (${u.plc_plant_state_label ?? u.plc_plant_state})`
        : ` — pureza ${Number(u.o2_purity_pct).toFixed(1)}%`;
    } else if (st.online && u.unit_type === "vacuum") {
      detail = ` — vacío ${Number(u.vacuum_level_mmhg).toFixed(0)} mmHg`;
    } else if (st.online && u.unit_type === "air") {
      detail = ` — aire ${Number(u.air_line_pressure_bar).toFixed(2)} bar`;
    }
    return `    · ${u.unit_id || "equipo"}${type}: ${st.online ? "🟢 en línea" : `🔴 sin señal${st.lastSeen ? ` (hace ${st.ageSeconds}s)` : ""}`}${detail}`;
  });
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
      units: unitLines(latestByHospital[h.id], now),
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
      ...(latest?.units?.length > 1 ? [`Equipos (${latest.units.length}):`, ...unitLines(latest, now)] : []),
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
        }${p.units.length ? "\n" + p.units.join("\n") : ""}`
    );
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

// Palabras que no distinguen un hospital de otro y abreviaturas habituales.
const GENERIC_WORDS = new Set([
  "hospital", "hospitales", "regional", "basico", "general", "distrital", "instituto",
  "centro", "de", "del", "la", "las", "el", "los", "y", "e", "en", "psa", "boge",
  "planta", "plantas", "oxigeno", "o2", "sanatorio", "unidad", "salud", "servicio",
]);
const ABBREVIATIONS = {
  mcal: "mariscal", gral: "general", dr: "doctor", dra: "doctora", sta: "santa",
  sto: "santo", hosp: "hospital", reg: "regional", pdte: "presidente", cnel: "coronel",
  tte: "teniente", nac: "nacional", inst: "instituto",
};

function nameTokens(name) {
  return new Set(
    normName(name)
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .map((w) => ABBREVIATIONS[w] ?? w)
      .filter((w) => w.length > 1 && !GENERIC_WORDS.has(w))
  );
}

// Parecidos: las palabras distintivas de un nombre están todas en el otro
// ("INERAM" ⊂ "Instituto ... INERAM PSA-BOGE", "Mcal. Estigarribia" =
// "Hospital Regional de Mariscal Estigarribia"). La ciudad no se exige
// igual porque a veces se carga el departamento.
function similarHospitals(a, b) {
  const ta = nameTokens(a.nombre), tb = nameTokens(b.nombre);
  if (ta.size === 0 || tb.size === 0) {
    return normName(a.nombre) === normName(b.nombre) && normName(a.ciudad) === normName(b.ciudad);
  }
  const [small, big] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  return [...small].every((w) => big.has(w));
}

function findSimilar(hospitals, candidate) {
  return hospitals.filter((h) => similarHospitals(h, candidate));
}

server.registerTool(
  "check_hospitals",
  {
    title: "Revisar hospitales duplicados o con ID dudoso",
    description:
      "Revisa los hospitales registrados y reporta posibles duplicados: mismo nombre, o " +
      "nombres parecidos (uno contenido en el otro, abreviaturas como Mcal./Mariscal, sin " +
      "contar palabras genéricas como Hospital o Regional), con el ID, fecha de alta y " +
      "último dato recibido de cada uno para decidir cuál conservar. También reporta IDs " +
      "sin formato UUID estándar, que pueden romper la correspondencia con el " +
      "sensorMspbsId de SIGGAM. Solo lectura: no modifica nada.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => {
    const [hospitals, { rows, now }] = await Promise.all([fetchHospitals(), fetchLatestAll()]);
    const latestById = {};
    for (const r of rows) latestById[r.hospital_id] = r;

    // Agrupa pares parecidos (unión transitiva)
    const parent = hospitals.map((_, i) => i);
    const root = (i) => (parent[i] === i ? i : (parent[i] = root(parent[i])));
    for (let i = 0; i < hospitals.length; i++) {
      for (let j = i + 1; j < hospitals.length; j++) {
        if (similarHospitals(hospitals[i], hospitals[j])) parent[root(j)] = root(i);
      }
    }
    const groups = {};
    hospitals.forEach((h, i) => (groups[root(i)] ||= []).push(h));
    const dups = Object.values(groups).filter((g) => g.length > 1);
    const badIds = hospitals.filter((h) => !UUID_RE.test(String(h.id).trim()));

    const lines = [`Hospitales registrados: ${hospitals.length}`];
    if (dups.length === 0) {
      lines.push("Posibles duplicados: ninguno.");
    } else {
      lines.push(`Posibles duplicados (${dups.length} grupos):`);
      for (const g of dups) {
        lines.push(`- Grupo:`);
        for (const h of g) {
          const st = computeStatus(latestById[h.id], now);
          const data = st.lastSeen ? `último dato ${st.lastSeen}` : "nunca recibió datos";
          const map = h.lat != null && h.lon != null ? "con ubicación" : "sin ubicación";
          lines.push(
            `    "${h.nombre}" (${h.ciudad || "sin ciudad"}) · id ${h.id} · creado ${h.created_at || "?"} · ` +
              `${h.activo ? "activo" : "inactivo"} · ${map} · ${data}`
          );
        }
      }
      lines.push(
        "Para cada grupo, conservar el hospital cuyo id sea el sensorMspbsId de SIGGAM (y al que " +
          "envían sus ESP32); pasarle nombre, ubicación y equipos del otro desde el panel, y " +
          "desactivar el sobrante tras cambiar el HOSPITAL_ID de cualquier ESP32 que lo use."
      );
    }
    if (badIds.length === 0) {
      lines.push("IDs con formato UUID estándar: todos.");
    } else {
      lines.push("IDs sin formato UUID estándar (confirmar con SIGGAM):");
      for (const h of badIds) lines.push(`- ${h.nombre} (${h.ciudad || "sin ciudad"}): "${h.id}"`);
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

server.registerTool(
  "set_hospital_equipment",
  {
    title: "Configurar equipos de un hospital",
    description:
      "Activa o desactiva qué equipos tiene un hospital (planta PSA de O2, compresor de aire, " +
      "bomba de vacío). El dashboard solo genera alarmas de los equipos activos. Úsala al " +
      "instalar el primer ESP32 de un tipo nuevo (p. ej. el primer VAC-1 activa el vacío). " +
      "Por defecto dry_run=true: solo muestra el cambio. Requiere MSPYBS_ADMIN_TOKEN.",
    inputSchema: {
      hospital_id: z.string().trim().min(1).describe("ID del hospital."),
      psa_enabled: z.boolean().optional().describe("Tiene planta PSA de oxígeno."),
      compressor_enabled: z.boolean().optional().describe("Tiene compresor de aire medicinal."),
      vacuum_enabled: z.boolean().optional().describe("Tiene bomba de vacío."),
      dry_run: z.boolean().optional().describe("true (por defecto): solo mostrar. false: aplicar."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  async (args) => {
    if (!ADMIN_TOKEN) {
      return { content: [{ type: "text", text: "Falta MSPYBS_ADMIN_TOKEN en la configuración del servidor MCP." }], isError: true };
    }
    const hospitals = await fetchHospitals();
    const h = hospitals.find((x) => String(x.id).trim() === args.hospital_id);
    if (!h) {
      return { content: [{ type: "text", text: `No se encontró el hospital ${args.hospital_id}.` }], isError: true };
    }
    const cur = { psa_enabled: true, compressor_enabled: true, vacuum_enabled: true, ...(h.equipment || {}) };
    const next = { ...cur };
    for (const k of ["psa_enabled", "compressor_enabled", "vacuum_enabled"]) {
      if (args[k] !== undefined) next[k] = args[k];
    }
    const fmt = (e) => `PSA ${e.psa_enabled !== false ? "sí" : "no"}, compresor ${e.compressor_enabled !== false ? "sí" : "no"}, vacío ${e.vacuum_enabled !== false ? "sí" : "no"}`;
    const text = [`${h.nombre} (${h.ciudad || "sin ciudad"}) · id ${h.id}`, `  antes:   ${fmt(cur)}`, `  después: ${fmt(next)}`];
    if (args.dry_run !== false) {
      return { content: [{ type: "text", text: ["PLAN (no se modificó nada):", ...text, "Para aplicarlo, repetir con dry_run: false."].join("\n") }] };
    }
    await apiPost({ action: "update_hospital", id: h.id, equipment: next });
    return { content: [{ type: "text", text: ["HECHO:", ...text].join("\n") }] };
  }
);

server.registerTool(
  "merge_hospitals",
  {
    title: "Fusionar un hospital duplicado en otro",
    description:
      "Resuelve un duplicado: conserva el hospital keep_id (debe ser el que tiene el " +
      "sensorMspbsId de SIGGAM), le copia del duplicado lo que le falte (nombre completo, " +
      "dirección, ubicación y, si se indica, umbrales y equipos) y desactiva el duplicado. " +
      "No borra nada. Por defecto dry_run=true: solo muestra el plan; para aplicarlo hay " +
      "que repetir con dry_run=false tras confirmarlo con el usuario. Requiere MSPYBS_ADMIN_TOKEN.",
    inputSchema: {
      keep_id: z.string().trim().min(1).describe("ID del hospital que se conserva (el sensorMspbsId de SIGGAM)."),
      duplicate_id: z.string().trim().min(1).describe("ID del hospital duplicado que se desactiva."),
      nombre: z.string().trim().min(1).optional().describe("Nombre final. Por defecto, el más largo de los dos."),
      copy_config_from_duplicate: z
        .boolean()
        .optional()
        .describe("Copiar umbrales y equipos del duplicado (si se configuraron allí). Por defecto true."),
      dry_run: z.boolean().optional().describe("true (por defecto): solo mostrar el plan. false: aplicar."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  async (args) => {
    if (!ADMIN_TOKEN) {
      return { content: [{ type: "text", text: "Falta MSPYBS_ADMIN_TOKEN en la configuración del servidor MCP." }], isError: true };
    }
    if (args.keep_id === args.duplicate_id) {
      return { content: [{ type: "text", text: "keep_id y duplicate_id son el mismo hospital." }], isError: true };
    }
    const [hospitals, { rows, now }] = await Promise.all([fetchHospitals(), fetchLatestAll()]);
    const keep = hospitals.find((h) => String(h.id).trim() === args.keep_id);
    const dup = hospitals.find((h) => String(h.id).trim() === args.duplicate_id);
    if (!keep || !dup) {
      return {
        content: [{ type: "text", text: `No se encontró ${!keep ? `keep_id ${args.keep_id}` : `duplicate_id ${args.duplicate_id}`}.` }],
        isError: true,
      };
    }

    const copyConfig = args.copy_config_from_duplicate !== false;
    const nombre = args.nombre ?? (dup.nombre.trim().length > keep.nombre.trim().length ? dup.nombre.trim() : keep.nombre.trim());
    const update = {
      action: "update_hospital",
      id: keep.id,
      nombre,
      ciudad: keep.ciudad || dup.ciudad,
      direccion: keep.direccion || dup.direccion,
      activo: true,
      thresholds: copyConfig ? dup.thresholds : keep.thresholds,
      equipment: copyConfig ? dup.equipment : keep.equipment,
    };
    const lat = keep.lat ?? dup.lat, lon = keep.lon ?? dup.lon;
    if (lat != null && lon != null) { update.lat = lat; update.lon = lon; }

    const dupLatest = rows.find((r) => r.hospital_id === dup.id);
    const dupStatus = computeStatus(dupLatest, now);
    const plan = [
      `Conservar: ${keep.nombre} (${keep.ciudad || "sin ciudad"}) · id ${keep.id}`,
      `  nombre → "${update.nombre}"`,
      `  ciudad → "${update.ciudad || ""}" · dirección → "${update.direccion || ""}"`,
      `  ubicación → ${update.lat != null ? `${update.lat}, ${update.lon}` : "sin ubicación"}`,
      `  umbrales y equipos → del ${copyConfig ? "duplicado" : "hospital conservado"} ` +
        `(PSA ${update.equipment?.psa_enabled !== false ? "sí" : "no"}, compresor ${update.equipment?.compressor_enabled !== false ? "sí" : "no"}, vacío ${update.equipment?.vacuum_enabled !== false ? "sí" : "no"})`,
      `Desactivar: ${dup.nombre} (${dup.ciudad || "sin ciudad"}) · id ${dup.id} (no se borra)`,
    ];
    if (dupStatus.lastSeen) {
      plan.push(
        `⚠ El duplicado recibió datos (último ${dupStatus.lastSeen}, hace ${dupStatus.ageSeconds}s): ` +
          `cambia el HOSPITAL_ID de ese ESP32 a ${keep.id} o sus lecturas quedarán en el hospital desactivado.`
      );
    }
    plan.push(`SIGGAM debe tener ${keep.id} como sensorMspbsId de esta planta.`);

    if (args.dry_run !== false) {
      return { content: [{ type: "text", text: ["PLAN (no se modificó nada):", ...plan, "Para aplicarlo, repetir con dry_run: false."].join("\n") }] };
    }

    await apiPost(update);
    try {
      await apiPost({ action: "toggle_hospital", id: dup.id, activo: false });
    } catch (e) {
      return {
        content: [{ type: "text", text: `Se actualizó ${keep.id}, pero no se pudo desactivar ${dup.id}: ${e.message}. Desactívalo desde el panel.` }],
        isError: true,
      };
    }
    return { content: [{ type: "text", text: ["HECHO:", ...plan].join("\n") }] };
  }
);

server.registerTool(
  "create_hospital",
  {
    title: "Crear hospital",
    description:
      "Da de alta un hospital/planta nuevo en el sistema (hoja Hospitales). " +
      "Devuelve el ID asignado, que es el HOSPITAL_ID que debe usar el ESP32 " +
      "de esa planta. Para compatibilidad con SIGGAM, el ID debe ser el mismo que " +
      "SIGGAM usa como sensorMspbsId: pregunta al usuario si SIGGAM ya tiene uno " +
      "asignado antes de crear. Requiere MSPYBS_ADMIN_TOKEN configurado en el servidor MCP.",
    inputSchema: {
      nombre: z.string().min(1).describe("Nombre del hospital."),
      ciudad: z.string().optional().describe("Ciudad."),
      direccion: z.string().optional().describe("Dirección."),
      id: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe(
          "sensorMspbsId que SIGGAM ya tiene asignado a esta planta, copiado exactamente " +
            "(se guarda tal cual, sin validar formato). Si SIGGAM aún no la tiene, omítelo: " +
            "el backend genera un UUID que luego hay que cargar en SIGGAM."
        ),
      lat: z.number().min(-90).max(90).optional().describe("Latitud para el mapa."),
      lon: z.number().min(-180).max(180).optional().describe("Longitud para el mapa."),
      o2_purity_warn: z.number().optional().describe("Umbral de alerta de pureza O2 (%). Por defecto 93."),
      o2_purity_critical: z.number().optional().describe("Umbral crítico de pureza O2 (%). Por defecto 90."),
      psa_enabled: z.boolean().optional().describe("La planta tiene generador PSA de O2. Por defecto true."),
      compressor_enabled: z.boolean().optional().describe("La planta tiene compresor de aire médico. Por defecto true."),
      vacuum_enabled: z.boolean().optional().describe("La planta tiene bomba de vacío. Por defecto true."),
      confirm_different: z
        .boolean()
        .optional()
        .describe(
          "Solo true si el usuario confirmó que es un hospital distinto de los de nombre parecido " +
            "que reportó un intento anterior."
        ),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  async (args) => {
    if (!ADMIN_TOKEN) {
      return {
        content: [
          {
            type: "text",
            text:
              "Falta la variable de entorno MSPYBS_ADMIN_TOKEN en la configuración del " +
              "servidor MCP (valor de ADMIN_TOKEN en las Propiedades del script).",
          },
        ],
        isError: true,
      };
    }

    // Mismo criterio que el backend: id exacto, o nombre + ciudad sin
    // distinguir mayúsculas, tildes ni espacios.
    const existing = await fetchHospitals();
    const dup = existing.find(
      (h) =>
        (args.id && String(h.id).trim() === args.id) ||
        (normName(h.nombre) === normName(args.nombre) &&
          normName(h.ciudad) === normName(args.ciudad))
    );
    if (dup) {
      return {
        content: [
          {
            type: "text",
            text: `Ya existe un hospital que coincide: ${dup.nombre} (${dup.ciudad || "sin ciudad"}), id ${dup.id}. No se creó nada.`,
          },
        ],
        isError: true,
      };
    }
    const similar = findSimilar(existing, { nombre: args.nombre, ciudad: args.ciudad });
    if (similar.length && !args.confirm_different) {
      return {
        content: [
          {
            type: "text",
            text:
              "No se creó nada: ya hay hospitales con nombre parecido y podría ser el mismo " +
              "(se duplicaría con otro ID y SIGGAM no los relacionaría):\n" +
              similar.map((h) => `- ${h.nombre} (${h.ciudad || "sin ciudad"}), id ${h.id}`).join("\n") +
              "\nSi es el mismo, usa ese hospital (su id es el HOSPITAL_ID). Si el usuario confirma " +
              "que es otro hospital, repite con confirm_different: true.",
          },
        ],
        isError: true,
      };
    }

    const body = {
      action: "add_hospital",
      nombre: args.nombre.trim(),
      ciudad: args.ciudad ?? "",
      direccion: args.direccion ?? "",
      activo: true,
      thresholds: {
        o2_purity_warn: args.o2_purity_warn,
        o2_purity_critical: args.o2_purity_critical,
      },
      equipment: {
        psa_enabled: args.psa_enabled,
        compressor_enabled: args.compressor_enabled,
        vacuum_enabled: args.vacuum_enabled,
      },
    };
    if (args.id) body.id = args.id;
    if (args.lat !== undefined) body.lat = args.lat;
    if (args.lon !== undefined) body.lon = args.lon;

    const res = await apiPost(body);
    const lines = [
      `Hospital creado: ${body.nombre} (${body.ciudad || "sin ciudad"}).`,
      `ID: ${res.id}`,
      `Usa este ID como HOSPITAL_ID en el firmware del ESP32 de esta planta.`,
    ];
    if (args.id) {
      lines.push("SIGGAM: se usó el sensorMspbsId indicado, ambos sistemas comparten el mismo ID.");
      if (!UUID_RE.test(args.id)) {
        lines.push(
          "Aviso: ese ID no tiene formato UUID estándar (8-4-4-4-12). Se guardó tal cual; " +
            "confirma con SIGGAM que está copiado completo."
        );
      }
    } else {
      lines.push(
        `SIGGAM: carga este mismo ID (${res.id}) como sensorMspbsId de la planta en SIGGAM ` +
          "para que ambos sistemas la identifiquen igual."
      );
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[mspybs-mcp-server] Servidor MCP iniciado (stdio).");
