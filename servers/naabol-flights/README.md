# naabol-flights

Vuelos en tiempo real de los 12 aeropuertos bolivianos (NAABOL FIDS).

**Worker URL:** `https://mcp-naabol-flights.carlos-cb4.workers.dev/mcp`
**MCP namespace:** `mcp__naabol-flights__*`
**Auth:** ninguna

## Aeropuertos soportados

| IATA | Nombre | Ciudad |
|------|--------|--------|
| VVI | Viru Viru | Santa Cruz |
| LPB | El Alto | La Paz |
| CBB | Jorge Wilstermann | Cochabamba |
| TJA | Tarija | Tarija |
| SRE | Sucre | Sucre |
| ORU | Oruro | Oruro |
| UYU | Uyuni | Uyuni |
| CIJ | Cobija | Cobija |
| RIB | Riberalta | Riberalta |
| RBQ | Rurrenabaque | Rurrenabaque |
| TDD | Trinidad | Trinidad |
| GYA | Guayaramerín | Guayaramerín |

## Tools

### `getAirportFlights`

Consulta todas las salidas o llegadas de un aeropuerto boliviano en tiempo real.

**Params:**
- `aeropuerto` (string, requerido): código IATA del aeropuerto
- `tipo` (string `"S"|"L"`, requerido): `S` = salidas, `L` = llegadas
- `aerolinea` (string, opcional): filtrar por código IATA de aerolínea (ej: `"OB"`)
- `horaDesde` (string, opcional): filtrar desde hora `"HH:MM"`
- `horaHasta` (string, opcional): filtrar hasta hora `"HH:MM"`

**Returns:** objeto con `matches[]` ordenados por `horaProgramada`. Cada vuelo incluye `vuelo`, `aerolinea`, `ruta`, `horaProgramada`, `horaReal`, `gate`, `estado`, `estadoCategoria`.

**Categorías de estado:** `on-time`, `delayed`, `boarding`, `pre-boarding`, `departed`, `landed`, `cancelled`, `check-in`, `other`.

---

### `getFlight`

Estado de un vuelo específico por código. Si no se especifica aeropuerto, busca en los 12.

**Params:**
- `vuelo` (string, requerido): código de vuelo (ej: `"OB657"`, `"BOA657"`, `"657"`)
- `aeropuerto` (string, opcional): restringir búsqueda a un aeropuerto IATA
- `tipo` (string `"S"|"L"`, opcional): restringir a salidas o llegadas; si se omite busca ambos

**Returns:** objeto con `found`, `matches[]`, y `nota` si no se encontró ningún resultado.

---

## Bot Availability

| Bot | Tools |
|-----|-------|
| Jano | `getAirportFlights`, `getFlight` |
| Vesta | `getAirportFlights`, `getFlight` |
| Pecunia | `getAirportFlights`, `getFlight` |
