#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

/* ── Config ── */

const PROXY_BASE = "https://combustible-proxy.carlos-cb4.workers.dev";

// Leer API key de Google Maps desde ~/.combustible-mcp.env
let GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY ?? "";
if (!GOOGLE_MAPS_API_KEY) {
  try {
    const envFile = readFileSync(join(homedir(), ".combustible-mcp.env"), "utf8");
    for (const line of envFile.split("\n")) {
      const [k, ...rest] = line.trim().split("=");
      if (k === "GOOGLE_MAPS_API_KEY" && rest.length) {
        GOOGLE_MAPS_API_KEY = rest.join("=").trim();
        break;
      }
    }
  } catch (_) {}
}

/* ── Types ── */

interface Station {
  name: string;
  company: string;
  lat: number;
  lon: number;
  litros: number;
  capacidad: number;
}

interface StationResult extends Station {
  pct: number;
  status: string;
  distKm?: number;
  etaMin?: number;
  mapsUrl: string;
}

/* ── Helpers ── */

function statusEmoji(litros: number, capacidad: number): string {
  if (litros === 0) return "⚪";
  if (!capacidad) return "🔵";
  const pct = litros / capacidad;
  if (pct >= 0.5) return "🟢";
  if (pct >= 0.2) return "🟠";
  return "🔴";
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatKm(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

// Google Maps Distance Matrix API (REST) — hasta 25 destinos por request
async function googleDistMatrix(
  originLat: number,
  originLon: number,
  stations: Station[]
): Promise<{ distKm: number; etaMin: number }[] | null> {
  if (!GOOGLE_MAPS_API_KEY) return null;
  const results: { distKm: number; etaMin: number }[] = [];
  const BATCH = 25;

  for (let i = 0; i < stations.length; i += BATCH) {
    const batch = stations.slice(i, i + BATCH);
    const dests = batch.map((s) => `${s.lat},${s.lon}`).join("|");
    const url =
      `https://maps.googleapis.com/maps/api/distancematrix/json` +
      `?origins=${originLat},${originLon}` +
      `&destinations=${encodeURIComponent(dests)}` +
      `&mode=driving` +
      `&key=${GOOGLE_MAPS_API_KEY}`;

    try {
      const resp = await fetch(url);
      const json: any = await resp.json();
      if (json.status !== "OK") return null;
      for (const el of json.rows[0].elements) {
        if (el.status === "OK") {
          results.push({
            distKm: el.distance.value / 1000,
            etaMin: Math.round(el.duration.value / 60),
          });
        } else {
          results.push({ distKm: -1, etaMin: -1 });
        }
      }
    } catch {
      return null;
    }
  }
  return results;
}

/* ── Core tool ── */

async function getFuelStatus(args: {
  lat?: number;
  lon?: number;
  limit?: number;
  minLitros?: number;
}): Promise<string> {
  const limit = args.limit ?? 5;
  const minLitros = args.minLitros ?? 0;

  // Fetch stations desde el Worker (con cache 60s)
  let stations: Station[];
  try {
    const resp = await fetch(`${PROXY_BASE}/api/stations`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    stations = (await resp.json()) as Station[];
  } catch (err: any) {
    return `Error obteniendo datos: ${err.message}`;
  }

  // Filtrar por litros mínimos
  let filtered = minLitros > 0 ? stations.filter((s) => s.litros >= minLitros) : stations;

  // Calcular distancias si hay coordenadas
  let withDist: StationResult[];
  if (args.lat !== undefined && args.lon !== undefined) {
    const { lat, lon } = args;

    // Pre-ordenar por haversine para mandar solo candidatos cercanos a Google Maps
    const withHaversine = filtered.map((s) => ({
      ...s,
      hkm: haversineKm(lat, lon, s.lat, s.lon),
    })).sort((a, b) => a.hkm - b.hkm);

    // Calcular distancias reales vía Google Maps (o fallback haversine)
    const googleDist = await googleDistMatrix(lat, lon, withHaversine);

    withDist = withHaversine.map((s, i) => {
      const gd = googleDist?.[i];
      const distKm = gd && gd.distKm > 0 ? gd.distKm : s.hkm;
      const etaMin = gd && gd.etaMin > 0 ? gd.etaMin : undefined;
      const pct = s.capacidad > 0 ? Math.round((s.litros / s.capacidad) * 100) : 0;
      return {
        ...s,
        pct,
        status: statusEmoji(s.litros, s.capacidad),
        distKm,
        etaMin,
        mapsUrl: `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}`,
      };
    }).sort((a, b) => a.distKm! - b.distKm!);
  } else {
    // Sin coordenadas: ordenar por litros descendente
    withDist = filtered
      .sort((a, b) => b.litros - a.litros)
      .map((s) => {
        const pct = s.capacidad > 0 ? Math.round((s.litros / s.capacidad) * 100) : 0;
        return {
          ...s,
          pct,
          status: statusEmoji(s.litros, s.capacidad),
          mapsUrl: `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}`,
        };
      });
  }

  const top = withDist.slice(0, limit);

  if (top.length === 0) {
    return minLitros > 0
      ? `No hay estaciones con más de ${minLitros.toLocaleString("es-BO")} litros disponibles.`
      : "No hay datos de estaciones disponibles.";
  }

  const lines = top.map((s) => {
    const litrosStr = s.litros > 0
      ? `${s.litros.toLocaleString("es-BO")} L${s.pct > 0 ? ` (${s.pct}%)` : ""}`
      : "sin datos";
    const distStr = s.distKm !== undefined ? ` · ${formatKm(s.distKm)}` : "";
    const etaStr = s.etaMin !== undefined ? ` ~${s.etaMin} min` : "";
    return `${s.status} ${s.name} (${s.company}) — ${litrosStr}${distStr}${etaStr} · 📍 ${s.mapsUrl}`;
  });

  const header = args.lat !== undefined
    ? `Estaciones más cercanas con combustible:`
    : `Estaciones con más combustible:`;

  const total = stations.filter((s) => s.litros > 0).length;
  const footer = `\n${total} de ${stations.length} estaciones con datos disponibles.`;

  return `${header}\n${lines.join("\n")}${footer}`;
}

/* ── MCP Server ── */

const server = new Server(
  { name: "combustible", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "getFuelStatus",
      description:
        "Obtiene disponibilidad de Gasolina Especial en 27 estaciones de Santa Cruz de la Sierra, Bolivia. " +
        "Si se pasan lat/lon, ordena por distancia y calcula ETA. Sin coordenadas, ordena por litros disponibles.",
      inputSchema: {
        type: "object",
        properties: {
          lat: {
            type: "number",
            description: "Latitud de la ubicación actual (ej: -17.756)",
          },
          lon: {
            type: "number",
            description: "Longitud de la ubicación actual (ej: -63.235)",
          },
          limit: {
            type: "number",
            description: "Número máximo de estaciones a devolver (default: 5)",
          },
          minLitros: {
            type: "number",
            description: "Filtrar estaciones con al menos este número de litros (default: 0)",
          },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== "getFuelStatus") {
    throw new Error(`Unknown tool: ${req.params.name}`);
  }
  const args = (req.params.arguments ?? {}) as {
    lat?: number;
    lon?: number;
    limit?: number;
    minLitros?: number;
  };
  const result = await getFuelStatus(args);
  return { content: [{ type: "text", text: result }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
