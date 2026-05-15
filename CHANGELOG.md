# CHANGELOG — MCP Servers

## 2026-05-15

### inversiones-query — bug fixes post-launch

- **Fix `getPortfolioPerformance`:** código asumía que `get_portfolio_history` devolvía `{startValue, endValue}` y `get_portfolio_cagr` devolvía `{cagrYTD}`. Ambos son incorrectos. Formatos reales: `{portfolioDataPoints: [{date, value}]}` y `{cagrOldValues: {ytd_networth: {date, oldValue}, ...}}`. Resultado: `deltaUSD` siempre 0 y `cagr` siempre null. Corregido con parsing correcto de ambos endpoints.
- **Fix `getTransactionHistory` sort:** sort param enviado como JSON string causaba HTTP 422 en Airtable. Corregido a formato indexado (`sort[0][field]=Fecha`).
- **Fix `getTransactionHistory` — tickers vacíos:** 4 field names incorrectos corregidos (`Activo Financiero`, `Tipo de Transaccion`, `PU - Transaccion`, `Fee  ($)`). Ticker resuelto desde field `Ticket` (lookup que devuelve `["SPY"]`), con fallback a Securities map.
- **Fix `getDailyMovers` — impact total:** `DailyMover` ahora incluye `shares` (suma cross-broker de posiciones Kubera) y `totalChangeUSD` (impacto portafolio = `changeUSD × shares`). Antes solo había `changeUSD` por acción.
- **Docs:** CLAUDE.md actualizado con formatos reales de Kubera history/cagr y gotcha de Airtable sort params.

## 2026-05-14

### inversiones-query — MCP nuevo + bug fixes

- **Nuevo servidor MCP** `inversiones-query`: 8 tools para consultar el portafolio de inversiones de Cal. Datos: Kubera (posiciones, valorización, CAGR) + Yahoo Finance (precios en tiempo real) + Airtable (historial transacciones). Wired en Jano y Pecunia.
- **Tools:** `getPortfolioSummary`, `getDailyMovers`, `getPositionDetail`, `getPortfolioPerformance`, `getPriceHistory`, `getTransactionHistory`, `getPortfolioConcentration`, `searchPosition`.
- **Fix Kubera v2:** la API devuelve `{ markdown }` (no JSON plano). Agregado parser de tablas markdown en `tools/portfolio.ts` para extraer métricas del `## Summary` y posiciones del `## Assets`.
- **Fix Yahoo Finance:** `/v7/finance/quote` en `query1` bloqueado con 401 (2026-05). Reemplazado con `/v8/finance/chart/{ticker}` en `query2.finance.yahoo.com`, paralelo por ticker vía `Promise.allSettled`. Cambio diario derivado de `meta.chartPreviousClose`.
- **Fix movers:** posiciones de cash en Kubera tienen `ticker:"USD"` → Yahoo las mapea al ETF ProShares Ultra Semiconductors. Filtrar currency codes puros + deduplicar tickers antes de llamar Yahoo.

## 2026-05-11

### panini-mundial — MCP nuevo + descripción álbum Grupos A y B

- **Nuevo servidor MCP** `panini-mundial`: 7 tools para gestionar el álbum Panini FIFA World Cup 2026 de Cal y Noe. Backend: Notion DB `35cc487609dd80868b1dc68095a6f84f`. Acepta nombres en español e inglés. Wired en Jano y Vesta.
- **Tools:** `paniniProgress`, `paniniSection`, `paniniMissing`, `paniniDuplicates`, `paniniRegister`, `paniniRemove`, `paniniSearch`.
- **Script `update-paginas.mjs`:** bulk-set del campo `Pagina` para 968/981 stickers (13 FWC skip — faltan fotos páginas 4-7).
- **Descripción Grupos A y B:** pobladas 160 entradas (MEX, RSA, KOR, CZE, CAN, BIH, QAT, SUI — 8 secciones × 20) desde fotos del álbum físico. Placeholders reemplazados por nombres de jugadores, escudos y fotos grupales reales.
- **Fix FWC:** corregidas descripciones de FWC 1, 5, 6, 7, 8 (emblemas y balón oficial); FWC 2-4 no confirmadas por foto.

### Jano — fix prefijo Notion en CLAUDE.md

- **Fix docs:** `mcp__notion__notion-query-database-view` y `mcp__notion__.*` corregidos a `mcp__claude_ai_Notion__*` en dos lugares del CLAUDE.md de Jano (líneas 265 y 373).

## 2026-05-10

### Health — Endpoint /measurements + MCP tool getHealthMeasurements
- **Confirmado**: `/trend` usa `SUM` para métricas no-sleep (`health-worker/src/index.ts:178`), `MAX` para sleep — RMSSD mostraba 228-403ms por suma de lecturas diarias (valor real: 20-80ms).
- **Feature**: nuevo endpoint `GET /measurements` en `health.carlos-cb4.workers.dev` — filas individuales `{id, metric, value, unit, date, timestamp}` con filtros `start/end/metrics[]/limit/cursor`.
- **MCP**: tool `getHealthMeasurements` añadida a `servers/health/src/index.ts`. `getHealthTrend` intacto.

### Shared — vuelos-naabol-format.ts
- **Nuevo**: `shared/vuelos-naabol-format.ts` exporta constante `VUELOS_NAABOL_INSTRUCTIONS` — instrucciones canónicas de formato para `getAirportFlights` (tabla de vuelos bolivianos). Importado por Jano y Vesta vía `tsconfig rootDirs`. Para cambiar el formato NAABOL, editar solo este archivo.

## 2026-05-04

### Docs — gotcha "outputs descriptivos confunden al LLM"

- Agregado principio general en `CLAUDE.md`: MCPs que wrapean CLIs no deben emitir campos descriptivos sobre estado parcial ("endpoint caído", "datos limitados", "fallback activo") cuando los datos siguen siendo válidos. El LLM tiende a repetir esos textos al usuario y bloquearse aunque el payload tenga lo que pidió.
- Caso real: `naabol-flights` con campo `nota` que confundía a Jano (fix aplicado en el CLI underlying `consultar-vuelo.mjs`, no en el MCP wrapper).

## 2026-05-02

### Feedbin — write tools + fix subscription_id

- **`savePage(url)`**: guarda un artículo/URL via POST /v2/pages.json (para leer luego, distinto de suscribir a un feed).
- **`addSubscription(feedUrl)`**: suscribe a un feed via POST /v2/subscriptions.json. Maneja 302 (ya suscrito) como éxito.
- **`deleteSubscription(subscriptionId)`**: elimina suscripción via DELETE /v2/subscriptions/{id}.json.
- **`markUnread(entryIds)`**: marcado como no-leído (complemento de `markRead`).
- **`getSubscriptions()`**: fix bug — ahora expone `subscription_id` (`s.id`) además de `feed_id`. El endpoint DELETE necesita `subscription_id`; antes solo se exponía `feed_id` → 404.

### mcp-remote como bridge para MCPs remotos

- **Patrón documentado** en CLAUDE.md: usar `mcp-remote` para MCPs HTTP/SSE externos (ej. Readwise). Instalado globalmente en `/Users/calepes/.npm-global/bin/mcp-remote`.
- **Smoke-test Node** documentado en CLAUDE.md: validar tools via Node CJS spawn (bash pipe no funciona con mcp-remote).
