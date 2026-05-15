# MCP Servers — Monorepo

npm workspaces. Todos los servidores en `servers/`. Registrados globalmente en `~/.claude/.mcp.json`.

## Shared

`shared/vuelos-naabol-format.ts` — constante `VUELOS_NAABOL_INSTRUCTIONS` para formato de vuelos NAABOL (instrucciones del tool `getAirportFlights`). Importada por Jano y Vesta. No es workspace npm — los daemons la referencian via `rootDirs: ["src", "../../../../MCP Servers/mcp-servers/shared"]` en su `tsconfig.json`. Para cambiar el formato de vuelos, editar este archivo (no los system-prompts de Jano ni Vesta directamente).

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
| `feedbin` | `getUnreadCount`, `getUnreadEntries`, `getEntryContent`, `markRead`, `markUnread`, `getSubscriptions`, `searchEntries`, `savePage`, `addSubscription`, `deleteSubscription` | Requiere env `FEEDBIN_USERNAME`, `FEEDBIN_PASSWORD`. Gotcha: `getSubscriptions()` expone `subscription_id` (`s.id`) y `feed_id` — son distintos. Usar `subscription_id` para DELETE, no `feed_id` |
| `serpapi-flights` | `searchFlights`, `getReturnFlights` | Google Flights via SerpAPI. Requiere env `SERPAPI_KEY` (en `~/.cos-agent/.env`) |
| `combustible` | `getFuelStatus` | Disponibilidad gasolina 27 estaciones Santa Cruz + dist Google Maps + links por estación. Requiere env `GOOGLE_MAPS_API_KEY` (fallback: `~/.combustible-mcp.env`). Worker: `combustible-proxy.carlos-cb4.workers.dev/api/stations`. Wired en Vesta (usa `FAMILY_GOOGLE_MAPS_API_KEY`) y Jano. |
| `panini-mundial` | `paniniProgress`, `paniniSection`, `paniniMissing`, `paniniDuplicates`, `paniniRegister`, `paniniRemove`, `paniniSearch` | Álbum Panini FIFA World Cup 2026 de Cal y Noe. Backend: Notion DB `35cc487609dd80868b1dc68095a6f84f`. Requiere env `NOTION_TOKEN` (token integración Claude CoS), `PANINI_DB_ID`. Wired en Jano y Vesta. Ver docs en `servers/panini-mundial/docs/`. |
| `inversiones-query` | `getPortfolioSummary`, `getDailyMovers`, `getPositionDetail`, `getPortfolioPerformance`, `getPriceHistory`, `getTransactionHistory`, `getPortfolioConcentration`, `searchPosition` | Portfolio de inversiones de Cal (Kubera + Yahoo Finance + Airtable). Requiere env `KUBERA_AUTH_TOKEN`, `AIRTABLE_TOKEN`, `AIRTABLE_BASE_ID`. Wired en Jano y Pecunia. Gotcha: Kubera v2 API devuelve `{markdown}` (no JSON plano) — parser en `tools/portfolio.ts`. Yahoo `/v7/quote` bloqueado (401) → usa `/v8/finance/chart` en `query2`. Cash positions de Kubera tienen `ticker:"USD"` → filtrar antes de llamar Yahoo. `get_portfolio_history` devuelve `{portfolioDataPoints: [{date, value}]}` (NO `{startValue, endValue}`). `get_portfolio_cagr` devuelve `{cagrOldValues: {ytd_networth: {date, oldValue}, ...}}` (NO `{cagrYTD}`). |

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

## MCPs remotos (via mcp-remote)

Para MCPs HTTP/SSE externos (no stdio), usar `mcp-remote` como bridge:

```bash
npm install -g mcp-remote  # instalar una vez
# path: /Users/calepes/.npm-global/bin/mcp-remote
```

Registro en `BASE_OPTIONS.mcpServers` del daemon:
```typescript
"readwise": {
  type: "stdio",
  command: "/Users/calepes/.npm-global/bin/mcp-remote",
  args: ["https://mcp2.readwise.io/mcp", "--header", `Authorization: Token ${TOKEN}`],
}
```

Registro en `~/.claude/.mcp.json` (para sesiones interactivas):
```json
"readwise": { "type": "url", "url": "https://mcp2.readwise.io/mcp", "headers": { "Authorization": "Token TOKEN" } }
```

**Gotcha testing con bash:** `echo '{"method":"tools/list",...}' | mcp-remote URL` no funciona (proceso cierra stdin antes del handshake). Usar Node CJS spawn con stdin/stdout y timeouts explícitos para validar tools disponibles.

## Smoke-test rápido de un MCP

Después de `npm -w mcp-<name> run build`, validar tools con Node (bash pipe no funciona con mcp-remote ni con servidores que esperan handshake):

```bash
node -e "
const { spawn } = require('child_process');
const p = spawn('node', ['/abs/path/dist/index.js']);
p.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',params:{}})+'\n');
p.stdout.once('data', d => { console.log(d.toString()); p.kill(); });
setTimeout(() => p.kill(), 3000);
"
```

## Gotcha: Airtable sort params

Usar formato indexado (`"sort[0][field]": "Fecha", "sort[0][direction]": "desc"`), NO JSON string (`sort: "[{field:Fecha,...}]"`). El segundo formato devuelve HTTP 422.

## Gotcha reminders-cli

Versiones nuevas devuelven UUIDs en el campo `externalId` del JSON, pero los comandos `complete` y `delete` solo aceptan índice entero. En `listItems()` siempre usar `String(idx)` como `externalId`, ignorar `r.externalId`.

## Gotcha: `keith/reminders-cli 2.5.1` `edit` limitado (2026-05-04)

El CLI `reminders` (Swift signed, instalado via `brew install keith/formulae/reminders-cli`) solo soporta `--notes` y title positional en `edit`. **NO soporta `--priority` ni `--due-date`**: si se pasan, los ignora silenciosamente (exit 0 sin actualizar). El MCP `apple-reminders` ahora throw-ea error claro en `editReminder` cuando se intenta priority/dueDate (antes fallaba silencioso). Para esos cambios: `deleteReminder + addReminder` con la nueva property.

**Plan de migración a MCP con EventKit nativo** (priority + recurring + location + multiple alarms reales): backlog en `Personal/Agents/Jano/BACKLOG.md` sección "Migración MCP apple-reminders → EventKit". Opciones evaluadas (todas requieren Xcode full salvo snarris):
- **Krishna-Desiraju/apple-reminders-swift-mcp-server**: Swift+EventKit, solo Reminders, 12 tools (recurring + location + alarms).
- **omarshahine/Apple-PIM-Agent-Plugin**: Swift+EventKit+JXA, dual Claude Code/OpenClaw, incluye Calendar+Reminders+Contacts+Mail (4 dominios).
- **snarris/apple-eventkit-mcp**: Python+PyObjC+EventKit, sin Xcode requirement, Calendar+Reminders pero menos features.
- **steipete/macos-automator-mcp**: Node + AppleScript/JXA wrapper genérico — NO sirve desde launchd (TCC deny).

## Panini Mundial — Álbum estructura y estado

**Estructura:** 981 láminas = 20 FWC (sección "Introducción", Foil) + 48 selecciones × 20. Cada selección: #1=Team Badge, #13=Country Badge (multilingual), #2-12 + #14-20=jugadores.

**Campo Pagina:** seteado en bulk via `src/update-paginas.mjs` (run: `NOTION_TOKEN=xxx node src/update-paginas.mjs`). Lógica: stickers 1-10 → página inicio de sección, 11-20 → página inicio + 1. FWC 9-19 y FWC 00 pendientes (faltan fotos páginas 4-7).

**Descripciones (Jugadores):** pobladas seccionalmente desde fotos del álbum físico. Completadas al 2026-05-11: Grupos A y B (8 secciones). Pendiente: Grupos C-L (36 secciones). Placeholders originales: "Jugador N", "Escudo", "Foto grupal".

**Scripts auxiliares** (en `servers/panini-mundial/src/`, corren con `node`, no requieren build):
- `update-paginas.mjs` — bulk-set campo Pagina para todas las secciones
- Para updates puntuales de Descripcion: usar snippet inline con `fetch` nativo a `https://api.notion.com/v1/`

## Gotcha: outputs descriptivos confunden al LLM

MCPs que wrapean CLIs no deben emitir campos descriptivos sobre estado parcial ("endpoint caído", "datos limitados", "fallback activo") cuando los datos siguen siendo válidos. El LLM tiende a repetir esos textos al usuario y bloquearse aunque el payload tenga lo que pidió. Caso real: `naabol-flights` con campo `nota` (fix 2026-05-04 — ahora solo aparece cuando no hay matches). Regla: outputs minimalistas, errores solo cuando hay error real (no en degradación parcial con datos útiles).
