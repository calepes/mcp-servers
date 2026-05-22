# exchange-rate-bolivia

Tipo de cambio Bs/USD para Bolivia: oficial del Banco Central (BCB) y paralelo Binance P2P.

**Worker URL:** `https://mcp-exchange-rate.carlos-cb4.workers.dev/mcp`
**MCP namespace:** `mcp__exchange-rate-bolivia__*`
**Auth:** ninguna (sin credenciales requeridas)

## Tools

### `getBcbRate`

Tipo de cambio oficial compra/venta del Banco Central de Bolivia. Scrape de `bcb.gob.bo`. Cache 60s in-memory.

**Params:** ninguno

**Returns:**
```json
{ "source": "BCB", "compra": 6.96, "venta": 6.96, "fetchedAt": "2026-05-17T16:00:00Z", "cached": false }
```

---

### `getBinanceP2PRate`

Tipo de cambio paralelo USDT/BOB en Binance P2P. Mediana de los top 5 merchants, con filtro de outliers (±3%). Cache 60s in-memory.

**Params:** ninguno

**Returns:**
```json
{ "source": "Binance P2P", "pair": "USDT/BOB", "compra": 9.30, "venta": 9.10, "rowsConsidered": 5, "fetchedAt": "2026-05-17T16:00:00Z", "cached": false }
```

---

## Bot Availability

| Bot | Tools |
|-----|-------|
| Jano | `getBcbRate`, `getBinanceP2PRate` |
| Vesta | `getBcbRate`, `getBinanceP2PRate` |
| Pecunia | `getBcbRate`, `getBinanceP2PRate` |
