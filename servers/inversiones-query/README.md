# inversiones-query

Portfolio de inversiones de Cal: consultas en tiempo real via Kubera + Yahoo Finance + Airtable.

**Worker URL:** `https://mcp-inversiones-query.carlos-cb4.workers.dev/mcp`
**MCP namespace:** `mcp__inversiones-query__*`
**Auth:** ninguna (KUBERA_AUTH_TOKEN, AIRTABLE_TOKEN, AIRTABLE_BASE_ID en wrangler secrets)

**Fuentes de datos:**
- **Kubera:** portafolio "Investments" (`6bccf4ba-e50d-442b-9f52-5cb3bc64523d`) — posiciones, costo base, IRR
- **Yahoo Finance:** precios en tiempo real vía `/v8/finance/chart` en `query2`
- **Airtable:** historial de transacciones

## Tools

### `getPortfolioSummary`
Valor total del portafolio, costo base, P&L, CAGR YTD y efectivo disponible.

**Params:** ninguno

---

### `getDailyMovers`
Top N ganadores y perdedores del día del portafolio (Yahoo Finance).

**Params:**
- `n` (number, opcional): cantidad de movers (default 5)

---

### `getPositionDetail`
Detalle de una posición: acciones, costo base, P&L, cambio diario, peso en portafolio.

**Params:**
- `ticker` (string, requerido): símbolo bursátil (ej: `"SPY"`, `"NVDA"`, `"BAP"`)

---

### `getPortfolioPerformance`
Rendimiento del portafolio para un período: cambio de valor y CAGR.

**Params:**
- `period` (string, requerido): `"1D"` | `"1W"` | `"1M"` | `"QTD"` | `"YTD"` | `"1Y"`

---

### `getPriceHistory`
Historial de precios de cierre diario con máximo/mínimo del período.

**Params:**
- `ticker` (string, requerido): símbolo bursátil
- `days` (number, opcional): días calendario hacia atrás (default 30)

---

### `getTransactionHistory`
Historial de transacciones desde Airtable.

**Params:**
- `ticker` (string, opcional): filtrar por símbolo
- `broker` (string, opcional): filtrar por broker
- `limit` (number, opcional): máximo de registros (default 20)

---

### `getPortfolioConcentration`
Desglose del portafolio por tipo de activo, sector y broker.

**Params:** ninguno

---

### `searchPosition`
Encuentra una posición por nombre parcial o ticker.

**Params:**
- `query` (string, requerido): ticker o nombre parcial (ej: `"credicorp"`, `"nvidia"`, `"cash"`)

---

### `kuberaCashFlow`
Registra un flujo de caja en Kubera para tracking de IRR y costo base. Llamar **antes** de `kuberaUpdateShares`.

**Params:**
- `custodianId` (string, requerido): ID del custodio en Kubera (usar `kuberaFindCustodian` si no se conoce)
- `date` (string, requerido): fecha `YYYY-MM-DD`
- `cashIn` (number, requerido): monto total invertido en compras (incluir comisiones). `0` para ventas
- `cashOut` (number, requerido): monto total recibido en ventas. `0` para compras
- `currency` (string, opcional): código de moneda (default `"USD"`)
- `note` (string, opcional): nota descriptiva (ej: `"NU buy 41.25 @ $12.089 (Hapi)"`)

---

### `kuberaUpdateShares`
Actualiza un ítem del portafolio en Kubera.

> ⚠️ Para activos con ticker: `value` = total de **acciones** (Kubera multiplica por precio de mercado automáticamente). Para efectivo: `value` = saldo en USD. Nunca pasar un monto en USD para un activo con ticker.

**Params:**
- `custodianId` (string, requerido): ID del custodio en Kubera
- `value` (number, requerido): nuevas acciones totales (ticker) o saldo USD (efectivo)

---

### `kuberaFindCustodian`
Busca el `custodianId` para un ticker o nombre de activo en el portafolio Kubera.

**Params:**
- `query` (string, requerido): ticker o nombre parcial (ej: `"NU"`, `"SPY"`, `"cash"`)

---

### `recordTransaction`
Registra una compra o venta en Airtable (tabla Inversiones).

> ⚠️ **No disponible en el CF Worker** — lanza error. Usar el MCP stdio local `mcp-inversiones-query` para escrituras en Airtable.

**Params:**
- `side` (string `"buy"|"sell"`, requerido)
- `date` (string, requerido): `YYYY-MM-DD`
- `ticker` (string, requerido)
- `broker` (string, requerido): `"Hapi"` | `"Interactive Brokers"` | `"Credicorp Capital"`
- `shares` (number, requerido): cantidad de acciones
- `price` (number, requerido): precio por acción
- `fee` (number, opcional): comisión por unidad, no total (default 0)
- `tc` (number, opcional): tipo de cambio (solo para transacciones en PEN)
- `notes` (string, opcional)
- `dryRun` (boolean, opcional): `true` = solo preview, no escribe (default `true`)

---

## Bot Availability

| Bot | Tools |
|-----|-------|
| Jano | Todas (12 tools) |
| Vesta | — |
| Pecunia | Todas (12 tools) |
