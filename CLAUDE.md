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
| `feedbin` | `getUnreadCount`, `getUnreadEntries`, `getUnreadByFeed`, `getEntryContent`, `markRead`, `markUnread`, `markFeedRead`, `markTagRead`, `getSubscriptions`, `getTaggings`, `searchEntries`, `savePage`, `addSubscription`, `deleteSubscription`, `getEntriesByFeed`, `getEntriesByTag`, `getReadEntriesByFeed`, `getReadEntriesByTag`, `getStarredEntries`, `starEntries`, `unstarEntries`, `createTagging`, `deleteTagging`, `renameTag`, `deleteTag` | Requiere env `FEEDBIN_USERNAME`, `FEEDBIN_PASSWORD`. `getEntriesByFeed` soporta `order` (newest/oldest) + `offset` (usa el endpoint por-feed `/feeds/{id}/entries.json`; devuelve `total_unread`). Tags/carpetas: taggings (POST/DELETE `/taggings`) + tags (POST/DELETE `/tags`). **Mercury extract NO implementado** (requiere Extract secret + HMAC en `extract.feedbin.com`; el resumidor usa safari-fetch como full-content para starred truncados). **El path VIVO es `worker.ts`** (deploy CF `mcp-feedbin.carlos-cb4.workers.dev/mcp`); tanto Jano como `.mcp.json` lo consumen vía `mcp-remote`. **`index.ts` (stdio) está desfasado/sin uso** — agregar tools nuevas en `worker.ts` + `npm run worker:deploy`. Gotcha: `getSubscriptions()` expone `subscription_id` (`s.id`) y `feed_id` — distintos; usar `subscription_id` para DELETE. Starred: `/v2/starred_entries.json` (GET ids, POST star, DELETE unstar) |
| `serpapi-flights` | `searchFlights`, `getReturnFlights` | Google Flights via SerpAPI. Requiere env `SERPAPI_KEY` (en `~/.cos-agent/.env`) |
| `combustible` | `getFuelStatus` | Disponibilidad gasolina 27 estaciones Santa Cruz + dist Google Maps + links por estación. Requiere env `GOOGLE_MAPS_API_KEY` (fallback: `~/.combustible-mcp.env`). Worker: `combustible-proxy.carlos-cb4.workers.dev/api/stations`. Wired en Vesta (usa `FAMILY_GOOGLE_MAPS_API_KEY`) y Jano. |
| `panini-mundial` | `paniniProgress`, `paniniSection`, `paniniMissing`, `paniniDuplicates`, `paniniRegister`, `paniniRemove`, `paniniSearch` | Álbum Panini FIFA World Cup 2026 de Cal y Noe. Backend: Notion DB `35cc487609dd80868b1dc68095a6f84f`. Requiere env `NOTION_TOKEN` (token integración Claude CoS), `PANINI_DB_ID`. Wired en Jano y Vesta. Ver docs en `servers/panini-mundial/docs/`. **Gotcha:** `paniniRegister` solo hace +1 por código — no sirve para set absoluto de Cantidad. Para updates en bulk desde imagen/screenshot, usar Notion MCP directamente: `notion-update-page` con `update_properties` + `{"Cantidad": N}`. |
| `inversiones-query` | `getPortfolioSummary`, `getDailyMovers`, `getPositionDetail`, `getPortfolioPerformance`, `getPriceHistory`, `getTransactionHistory`, `getPortfolioConcentration`, `searchPosition`, `recordTransaction`, `kuberaCashFlow`, `kuberaUpdateShares`, `kuberaFindCustodian` | Portfolio de inversiones de Cal (Kubera + Yahoo Finance + Airtable). Requiere env `KUBERA_AUTH_TOKEN`, `AIRTABLE_TOKEN`, `AIRTABLE_BASE_ID`. Wired en Jano y Pecunia. Gotcha: Kubera v2 API devuelve `{markdown}` (no JSON plano) — parser en `tools/portfolio.ts`. Yahoo `/v7/quote` bloqueado (401) → usa `/v8/finance/chart` en `query2`. Cash positions de Kubera tienen `ticker:"USD"` → filtrar antes de llamar Yahoo. `get_portfolio_history` devuelve `{portfolioDataPoints: [{date, value}]}` (NO `{startValue, endValue}`). `get_portfolio_cagr` devuelve `{cagrOldValues: {ytd_networth: {date, oldValue}, ...}}` (NO `{cagrYTD}`). **Dos entry points:** `index.ts` (MCP stdio) y `worker.ts` (CF Worker) — cambiar firmas requiere actualizar ambos. `getPortfolioPerformance 1D` usa Yahoo Finance (no Kubera history) — Kubera history no tiene granularidad diaria. |
| `worldcup` | **18 tools.** Vivo: `getFixtures`, `getStandings`, `getMatchDetail`, `getLineups`, `getMatchStats`, `getLiveFixtures`, `getMatchEvents`, `getPlayerStats`, `getTopScorers`, `getTopAssists`, `getInjuries`, `getH2H`, `getOdds`, `getApiPrediction`, `getSquad`. Predicción: `predictMatch`, `forecastTournament`. Integración: `syncResults` | Mundial 2026: datos en vivo (API-Football v3) + predicciones. Las 15 tools de vivo requieren `API_FOOTBALL_KEY` (**plan Pro — el free NO da season 2026**, solo 2022-2024); las 2 de predicción spawnean el Predictor Python (`Apps/Predictor Mundial/.venv`, sin key). `syncResults` baja resultados FT → escribe `results_live.json` del predictor → el modelo condiciona. xG en `getMatchStats` (`expected_goals`). `getH2H`/`getInjuries`/`getSquad` resuelven nombre→team id vía `resolveTeamId` (cache 12h, match por substring → `getH2H` compara por **id** no nombre). Local stdio (necesita filesystem + spawn Python). Wired en Jano. **Gotcha:** league=1, season=2026 (env). Nombres API-Football ("Czech Republic", "United States") los normaliza el predictor vía `NAME_FIX`. **Timezone:** `api()` inyecta `timezone=America/La_Paz` (override `WORLDCUP_TZ`) **solo en `/fixtures` y `/fixtures/headtohead`** (whitelist `TZ_PATHS` en `apifootball.ts`) → filtro `date` y `kickoff` ya vienen en hora Bolivia (UTC-4). Sin esto salían en UTC: "qué hay hoy" traía partidos desfasados y mostraba día/hora -4h. El LLM NO debe reconvertir el ISO. **Fix 2026-06-13:** antes usaba `path.startsWith("/fixtures")`, que también inyectaba `timezone` en los sub-endpoints por fixtureId (`/fixtures/events`, `/fixtures/statistics`, `/fixtures/players`, `/fixtures/lineups`) — API-Football los rechaza con `"The Timezone field do not exist."` → `getMatchEvents`/`getMatchStats`/`getPlayerStats`/`getLineups` fallaban silenciosamente y Jano caía a WebSearch. Esos endpoints se consultan por ID (no filtran fecha), así que no necesitan timezone. **`kickoffLabel` (fix 2026-06-13):** `getFixtures`/`getMatchDetail` devuelven `kickoffLabel` (ej. `"mar 16 jun · 21:00"`) con día de la semana + fecha + hora ya calculados en código (`fmtKickoff`, es-BO/La_Paz). Motivo: el LLM erraba el weekday al calcularlo desde el `kickoff` ISO (decía "Lun 16 jun" cuando 16/jun/2026 es martes). La descripción del tool + system-prompts de Jano fuerzan usar `kickoffLabel` literal y NO recalcular el día. |
| `notifications` | `sendNotification`, `sendNotificationWithEmoji`, `sendPhoto`, `sendDocument`, `sendVideo`, `sendAudio`, `sendVoice`, `sendLocation` | Notificaciones + media a Cal vía Telegram (@ClaudeCalbot). Token `NOTIF_BOT_TOKEN` en `~/.claude/notifications/.env` (stdio) / wrangler secret (worker). **Dos entry points:** `index.ts` (stdio, soporta ruta local) y `worker.ts` (CF Worker `mcp-notifications.carlos-cb4.workers.dev`, sin filesystem → media por URL/file_id/base64) — cambiar firmas requiere actualizar ambos. Media acepta URL / ruta local / file_id / base64+filename. Sesiones interactivas usan el Worker vía `mcp-remote`. |
| `spark` | `listAccounts`, `listFolders`, `listEmails`, `searchEmails`, `readThread`, `listEvents`, `findAvailability`, `searchContacts`, `listTeams`, `listMeetings`, `readMeeting`, `createDraft`, `postComment`, `emailAction`, `contactAction` | Wraps Spark Desktop CLI (`/opt/homebrew/bin/spark`) — email/calendar/contactos cross-cuenta (Lepesqueur + Gmail). Mac-only: requiere app instalada + CLI activado en Settings → AI Agents. Tools write (createDraft/postComment/emailAction/contactAction) requieren `triage` access. Wired en Jano. |

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

## Gotcha: `addReminder` dedup (2026-05-26)

`addReminder` verifica duplicados antes de crear: si ya existe un reminder activo con el mismo título (case-insensitive) en la lista, retorna `{ ok: false, duplicate: true, externalId, dueDate?, message }` sin crear nada. El LLM debe leer `ok` para saber si el reminder realmente se creó. Causa del cambio: Jano creaba duplicados cuando el usuario ya tenía un reminder con el mismo nombre.

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

## Gotcha: undici (Node fetch) se cuelga contra algunos hosts gov.bo (Diag 2026-06-21)

Un MCP stdio local que hace `fetch` nativo (undici) a `https://fids.naabol.gob.bo` se **cuelga ~8s y aborta** desde la red local de Cal, aunque `curl` al mismo host responda en ~0.2s. No es IPv6 (el host es solo IPv4) ni User-Agent. Es específico de undici↔ese host en esa máquina. **Fix: mover el fetch al edge — consumir el MCP vía su worker CF (`mcp-remote`) en vez del stdio local** (ver `servers/naabol-flights/README.md`). Aplica a cualquier MCP futuro que pegue a un host `.gob.bo` lento/quisquilloso con TLS: preferir worker CF + `mcp-remote`.

## Gotcha: `pdf-parse` v2 — named export + `.getText()` (Diag 2026-06-21)

La API de `pdf-parse` cambió en v2. El patrón correcto para cualquier server/daemon que extraiga texto de PDFs:
```js
const { PDFParse } = require("pdf-parse");        // named export — NO `const PDFParse = require(...)`
const parser = new PDFParse({ data: new Uint8Array(buf) });
const { text } = await parser.getText();          // NO `parsed.text` directo
```
El bug clásico (`require` sin destructurar + `parsed.text` sin `.getText()`) da `undefined` → `TypeError` que un catch genérico enmascara como `"[PDF — error al procesar]"`. Caso real: `schedule-cal.ts` en Jano/Vesta (PDFs de viajes en Notion fallaban silenciosamente). Mismo patrón ya en `index.ts` (`processDocument`).
