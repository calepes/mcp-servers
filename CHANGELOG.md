# CHANGELOG — MCP Servers

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
