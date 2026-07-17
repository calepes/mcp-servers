#!/usr/bin/env node
// MCP server: health
// Wraps the Health Worker API (https://health.carlos-cb4.workers.dev)
// Tools:
//   - getHealthSummary(date?)       — métricas del día (steps, sleep, HR, etc.)
//   - getHealthTrend(metric, days)  — serie temporal de una métrica
//   - getWorkouts(days?, category?) — workouts por tipo y categoría
//
// Requiere env: HEALTH_API_KEY

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const BASE_URL = "https://health.carlos-cb4.workers.dev";
const TIMEOUT_MS = 10_000;
const READ_ONLY = { annotations: { readOnlyHint: true } };

function apiKey(): string {
  const key = process.env.HEALTH_API_KEY;
  if (!key) throw new Error("HEALTH_API_KEY env var not set");
  return key;
}

async function fetchHealth(path: string): Promise<unknown> {
  const sep = path.includes("?") ? "&" : "?";
  const url = `${BASE_URL}${path}${sep}key=${encodeURIComponent(apiKey())}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Health worker ${res.status}: ${await res.text().then(t => t.slice(0, 200))}`);
  return await res.json();
}

// ── MCP Server ──────────────────────────────────────────────────────────────

const server = new Server(
  { name: "health", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "getHealthSummary",
      description:
        "Resumen diario de Apple Health: steps, active_energy, sleep (total/deep/rem/core), heart_rate, HRV, exercise_time, stand_hours, etc. Args: { date?: 'YYYY-MM-DD' (default hoy) }.",
      inputSchema: {
        type: "object",
        properties: { date: { type: "string", description: "YYYY-MM-DD, default hoy" } },
        additionalProperties: false,
      },
      ...READ_ONLY,
    },
    {
      name: "getHealthTrend",
      description:
        "Serie temporal de una métrica de Apple Health para los últimos N días. Métricas: step_count, active_energy, heart_rate, heart_rate_variability, apple_exercise_time, sleep_totalSleep, sleep_deep, sleep_rem, physical_effort, time_in_daylight, breathing_disturbances, resting_heart_rate. Args: { metric: string, days: int }.",
      inputSchema: {
        type: "object",
        properties: {
          metric: { type: "string" },
          days: { type: "number" },
        },
        required: ["metric", "days"],
        additionalProperties: false,
      },
      ...READ_ONLY,
    },
    {
      name: "getWorkouts",
      description:
        "Workouts registrados en Apple Health. Devuelve tipo raw (Tennis, Running, Functional Strength Training, etc.), duración en minutos, calorías activas, FC promedio y máxima, y categoría agrupada (cardio|strength|walk|flexibility|other). Args: { days?: int (default 7), category?: 'cardio'|'strength'|'walk'|'flexibility'|'other' }.",
      inputSchema: {
        type: "object",
        properties: {
          days: { type: "number", description: "Días a consultar, default 7" },
          category: {
            type: "string",
            enum: ["cardio", "strength", "walk", "flexibility", "other"],
            description: "Filtrar por categoría (opcional)",
          },
        },
        additionalProperties: false,
      },
      ...READ_ONLY,
    },
    {
      name: "getHealthMeasurements",
      description:
        "Filas individuales de Apple Health con timestamp exacto, métrica, valor y unidad. Útil para calcular promedios reales (ej. RMSSD/HRV) en lugar de usar los agregados diarios de /trend que usan SUM. Soporta filtros por rango de fechas, lista de métricas y paginación. Args: { start?: 'YYYY-MM-DD', end?: 'YYYY-MM-DD', metrics?: string[] (ej. ['heart_rate_variability', 'resting_heart_rate']), limit?: int (default 500, max 1000), cursor?: int (offset para paginación) }.",
      inputSchema: {
        type: "object",
        properties: {
          start: { type: "string", description: "Fecha inicio YYYY-MM-DD (inclusive)" },
          end:   { type: "string", description: "Fecha fin YYYY-MM-DD (inclusive)" },
          metrics: {
            type: "array",
            items: { type: "string" },
            description: "Lista de métricas a filtrar (vacío = todas). Ej: ['heart_rate_variability', 'resting_heart_rate']",
          },
          limit:  { type: "number", description: "Máximo de filas a retornar (default 500, max 1000)" },
          cursor: { type: "number", description: "Offset de paginación (usar next_cursor del response anterior)" },
        },
        additionalProperties: false,
      },
      ...READ_ONLY,
    },
    {
      name: "getHealthSyncStatus",
      description:
        "Última vez que llegó data de Health Auto Export al worker (timestamp del servidor, no de la métrica). Útil para detectar cortes silenciosos de sincronización — ej. si Cal pregunta 'está sincronizando bien mi salud' o 'hace cuánto no llega data del Watch'. Sin args.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      ...READ_ONLY,
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    let data: unknown;
    if (name === "getHealthSummary") {
      const date = (args as { date?: string }).date;
      data = await fetchHealth(`/summary${date ? `?date=${encodeURIComponent(date)}` : ""}`);
    } else if (name === "getHealthTrend") {
      const { metric, days } = args as { metric: string; days: number };
      data = await fetchHealth(`/trend?metric=${encodeURIComponent(metric)}&days=${days}`);
    } else if (name === "getWorkouts") {
      const { days = 7, category } = args as { days?: number; category?: string };
      const cat = category ? `&type=${encodeURIComponent(category)}` : "";
      data = await fetchHealth(`/workouts/summary?days=${days}${cat}`);
    } else if (name === "getHealthMeasurements") {
      const { start, end, metrics, limit, cursor } = args as {
        start?: string;
        end?: string;
        metrics?: string[];
        limit?: number;
        cursor?: number;
      };
      const params = new URLSearchParams();
      if (start)   params.set("start", start);
      if (end)     params.set("end", end);
      if (metrics && metrics.length > 0) params.set("metrics", metrics.join(","));
      if (limit != null)  params.set("limit", String(limit));
      if (cursor != null) params.set("cursor", String(cursor));
      const qs = params.toString();
      data = await fetchHealth(`/measurements${qs ? `?${qs}` : ""}`);
    } else if (name === "getHealthSyncStatus") {
      data = await fetchHealth(`/status`);
    } else {
      return { isError: true, content: [{ type: "text", text: `Unknown tool: ${name}` }] };
    }
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  } catch (err) {
    return { isError: true, content: [{ type: "text", text: `Error en ${name}: ${(err as Error).message}` }] };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
