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
