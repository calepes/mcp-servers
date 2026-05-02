# MCP Servers — Monorepo

npm workspaces. Todos los servidores en `servers/`. Registrados globalmente en `~/.claude/.mcp.json`.

## Build

```bash
npm -w mcp-<name> run build   # build un server específico
# Ejemplos:
npm -w mcp-health run build
npm -w mcp-apple-reminders run build
```

## Servidores

| Server | Tools principales | Notas |
|--------|-------------------|-------|
| `apple-reminders` | `listReminderLists`, `listReminders`, `addReminder`, `editReminder`, `completeReminder`, `deleteReminder` | Wraps `reminders-cli` (`/opt/homebrew/bin/reminders`) |
| `health` | `getHealthSummary`, `getHealthTrend`, `getWorkouts` | Wraps `health.carlos-cb4.workers.dev`. Requiere env `HEALTH_API_KEY` |
| `exchange-rate-bolivia` | `getBcbRate`, `getBinanceP2PRate` | Scrape BCB + Binance P2P USDT/BOB. Cache 60s in-memory |
| `naabol-flights` | `getFlight`, `getFlights`, `getAirportFlights` | Wraps CLI `~/Claude Projects/Personal/Apps/Aeropuertos Bolivia/cli/consultar-vuelo.mjs` |
| `youtube-transcribe` | `transcribeYoutube` | Captions fast-path + whisper local fallback |
| `feedbin` | `getUnreadCount`, `getUnreadEntries`, `getEntryContent`, `markRead`, `searchEntries` | Requiere env `FEEDBIN_USERNAME`, `FEEDBIN_PASSWORD` |
| `serpapi-flights` | `searchFlights`, `getReturnFlights` | Google Flights via SerpAPI. Requiere env `SERPAPI_KEY` (en `~/.cos-agent/.env`) |
| `combustible` | `getFuelStatus` | Disponibilidad gasolina 27 estaciones Santa Cruz + dist Google Maps + links por estación. Requiere env `GOOGLE_MAPS_API_KEY` (fallback: `~/.combustible-mcp.env`). Worker: `combustible-proxy.carlos-cb4.workers.dev/api/stations`. Wired en Vesta (usa `FAMILY_GOOGLE_MAPS_API_KEY`) y Jano. |

## Docs por servidor

Cada servidor con doc específica tiene `servers/<name>/docs/`. Actualmente: `health/docs/health-mcp.md`.

## Agregar un nuevo servidor

1. Copiar `servers/health/package.json` y `servers/health/tsconfig.json` a `servers/<name>/`
2. Crear `servers/<name>/src/index.ts` siguiendo el patrón de `health` o `naabol-flights`
3. `npm -w mcp-<name> run build`
4. Registrar en `~/.claude/.mcp.json`
5. Wirear en `BASE_OPTIONS.mcpServers` de cada daemon que lo use + agregar tools a `allowedTools`

## Registro en daemons (SDK librería)

El SDK Node NO lee `~/.claude/.mcp.json` — registrar explícitamente en `BASE_OPTIONS.mcpServers`:
```typescript
"<name>": { type: "stdio", command: "node", args: ["/abs/path/dist/index.js"], env: { ... } }
```
Y agregar `"mcp__<name>__<tool>"` a `allowedTools` en `agent-options.ts`.

## Gotcha reminders-cli

Versiones nuevas devuelven UUIDs en el campo `externalId` del JSON, pero los comandos `complete` y `delete` solo aceptan índice entero. En `listItems()` siempre usar `String(idx)` como `externalId`, ignorar `r.externalId`.
