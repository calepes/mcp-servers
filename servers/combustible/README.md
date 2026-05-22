# combustible

Disponibilidad de Gasolina Especial en 27 estaciones de Santa Cruz de la Sierra, Bolivia.

**Worker URL:** `https://mcp-combustible.carlos-cb4.workers.dev/mcp`
**MCP namespace:** `mcp__combustible__*`
**Auth:** ninguna (GOOGLE_MAPS_API_KEY en wrangler secrets)

## Estaciones monitoreadas

| Proveedor | Cantidad |
|-----------|----------|
| Genex | 11 (Banzer, Guaracachi, Trompillo, Mutualista, III, IV, V, II, Jarajorechi, Aracataca, Vangas) |
| Biopetrol (EC2) | 12 (Equipetrol, Pirai, Alemana, López, Viru Viru, Gasco, Beni, Berea, Cabezas, La Teca, Monteverde, Paraguá, Sur Central) |
| Orsa/Gasgroup | 2 (Urubó, Orsa Alemana) |
| Rivero | 1 |

## Tools

### `getFuelStatus`

Retorna disponibilidad de combustible. Con coordenadas del usuario, ordena por distancia real (Google Maps Distance Matrix API) e incluye ETA. Sin coordenadas, ordena por litros disponibles descendente.

**Params:**
- `userLat` (number, opcional): latitud del usuario (ej: `-17.756`)
- `userLon` (number, opcional): longitud del usuario (ej: `-63.235`)
- `limit` (number, opcional): máximo de estaciones a retornar (default 10)
- `minPct` (number, opcional): filtrar estaciones con menos de N% de capacidad (default 0)

**Returns:** texto formateado con una línea por estación:

```
🟢 Genex Banzer (Genex) — 45,000 L (72%) · 2.3 km ~8 min · 📍 https://maps.google.com/...
```

**Emojis de estado:**
- `🟢` ≥50% capacidad
- `🟠` 20–50% capacidad
- `🔴` <20% capacidad
- `🔵` sin capacidad de referencia (datos disponibles)
- `⚪` sin datos

---

## Bot Availability

| Bot | Tools |
|-----|-------|
| Jano | `getFuelStatus` |
| Vesta | `getFuelStatus` |
| Pecunia | — |
