# MCP Server: health

Wraps the Health Worker API (`https://health.carlos-cb4.workers.dev`) to exponer métricas de Apple Health como tools MCP disponibles en cualquier agente.

## Registro global

**`~/.claude/.mcp.json`** — disponible en sesiones interactivas de Claude Code CLI:
```json
"health": {
  "type": "stdio",
  "command": "node",
  "args": ["/Users/calepes/Claude Projects/Personal/MCP Servers/mcp-servers/servers/health/dist/index.js"],
  "env": { "HEALTH_API_KEY": "<key>" }
}
```

**Daemons Node (SDK librería):** el CLI lee `.mcp.json` pero la librería NO. Registrar en `BASE_OPTIONS.mcpServers`:
```typescript
mcpServers: {
  health: {
    type: "stdio",
    command: "node",
    args: ["/Users/calepes/Claude Projects/Personal/MCP Servers/mcp-servers/servers/health/dist/index.js"],
    env: { HEALTH_API_KEY: process.env.HEALTH_API_KEY! },
  }
}
```
Y agregar a `allowedTools`: `"mcp__health__getHealthSummary"`, `"mcp__health__getHealthTrend"`, `"mcp__health__getWorkouts"`.

## Tools disponibles

### `getHealthSummary`
Resumen diario de Apple Health: steps, active_energy, sleep (total/deep/rem/core), heart_rate, HRV, exercise_time, stand_hours.

```typescript
{ date?: string }  // YYYY-MM-DD, default hoy
```

### `getHealthTrend`
Serie temporal de una métrica para los últimos N días.

```typescript
{ metric: string, days: number }
```

Métricas disponibles: `step_count`, `active_energy`, `heart_rate`, `heart_rate_variability`, `apple_exercise_time`, `sleep_totalSleep`, `sleep_deep`, `sleep_rem`, `physical_effort`, `time_in_daylight`, `breathing_disturbances`, `resting_heart_rate`.

### `getWorkouts`
Workouts de Apple Health con tipo raw (Tennis, Running, Functional Strength Training, etc.), duración en minutos, calorías, FC avg/max, y categoría agrupada.

```typescript
{ days?: number, category?: "cardio" | "strength" | "walk" | "flexibility" | "other" }
```

Respuesta:
```json
{
  "days": 7, "count": 11,
  "byCategory": { "cardio": 11 },
  "workouts": [
    { "type": "Tennis", "date": "2026-04-28", "duration_min": 55, "energy_kcal": 1731, "hr_avg": 137, "hr_max": 156, "category": "cardio" }
  ]
}
```

## Build

```bash
npm -w mcp-health run build
```

## Agentes que lo usan

| Agente | Wired en | Tools expuestas |
|--------|----------|-----------------|
| CoS (Jano) | `daemon-v2/src/index.ts` `BASE_OPTIONS` | las 3 |
| Sesiones interactivas | `~/.claude/.mcp.json` | las 3 |

## Infraestructura de datos

El MCP es solo un wrapper. El backend vive en `~/Claude Projects/Personal/Agents/Health/health-worker/`:
- **Worker:** `https://health.carlos-cb4.workers.dev` (CF Workers)
- **DB:** D1 `health-data` — tablas `health_metrics` y `health_workouts`
- **Ingesta:** Health Auto Export (iOS) → `POST /ingest?key=KEY`
- **Dedup:** `INSERT OR IGNORE` + unique index en `(metric, date, timestamp, value)`
- **API Key:** `~/.cos-agent/.env` como `HEALTH_API_KEY` (mismo valor en `.mcp.json`)

Ver doc completa: `~/Claude Projects/Personal/Agents/Health/CLAUDE.md`
