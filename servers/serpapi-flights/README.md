# serpapi-flights

Búsqueda de vuelos internacionales con precios via Google Flights (SerpAPI).

**Worker URL:** `https://mcp-serpapi-flights.carlos-cb4.workers.dev/mcp`
**MCP namespace:** `mcp__serpapi-flights__*`
**Auth:** ninguna (SERPAPI_KEY en wrangler secrets)

> Para vuelos domésticos bolivianos en tiempo real usar `mcp__naabol-flights__*`. Este MCP es para búsquedas internacionales o cuando se necesitan precios.

## Tools

### `searchFlights`

Busca vuelos de ida via Google Flights.

**Params:**
- `departure_id` (string, requerido): IATA del aeropuerto de salida (ej: `"VVI"`, `"LIM"`)
- `arrival_id` (string, requerido): IATA del aeropuerto de llegada
- `outbound_date` (string, requerido): fecha de salida `YYYY-MM-DD`
- `adults` (number, opcional): número de adultos (default `1`)
- `currency` (string, opcional): moneda de los precios (default `"USD"`)
- `hl` (string, opcional): idioma de los resultados (default `"es"`)

**Returns:** JSON de SerpAPI con `best_flights[]`, `other_flights[]`, `price_insights` y un `booking_token` por itinerario (usar con `getReturnFlights`).

---

### `getReturnFlights`

Obtiene opciones de vuelo de regreso dado un `booking_token` de un vuelo de ida.

**Params:**
- `departure_token` (string, requerido): token del itinerario de ida (campo `booking_token` en resultados de `searchFlights`)
- `return_date` (string, requerido): fecha de regreso `YYYY-MM-DD`

**Returns:** JSON de SerpAPI con opciones de vuelo de vuelta para ese itinerario de ida.

---

## Bot Availability

| Bot | Tools |
|-----|-------|
| Jano | `searchFlights`, `getReturnFlights` |
| Vesta | `searchFlights`, `getReturnFlights` |
| Pecunia | — |
