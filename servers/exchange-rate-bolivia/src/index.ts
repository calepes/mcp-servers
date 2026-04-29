#!/usr/bin/env node
// MCP server: exchange-rate-bolivia
// Tools:
//   - getBcbRate(): tipo de cambio oficial del Banco Central de Bolivia (Bs/USD)
//   - getBinanceP2PRate(): paralelo USDT/BOB en Binance P2P (merchants top 5, mediana + outlier filter)
//
// Cache in-memory por 60s para evitar hammering de las fuentes externas
// cuando varios agentes preguntan en sucesión.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const BCB_URL = "https://www.bcb.gob.bo";
const BINANCE_URL = "https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search";
const CACHE_TTL_MS = 60_000;
const ROWS_BINANCE = 5;
const OUTLIER_THRESHOLD = 0.03;

interface BcbResult {
  source: "BCB";
  compra: number;
  venta: number;
  fetchedAt: string;
  cached: boolean;
}

interface BinanceP2PResult {
  source: "Binance P2P";
  pair: "USDT/BOB";
  compra: number; // BUY = lo que pagás en BOB para comprar USDT
  venta: number; // SELL = lo que recibís en BOB al vender USDT
  rowsConsidered: number;
  fetchedAt: string;
  cached: boolean;
}

const cache = new Map<string, { value: unknown; expires: number }>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expires < Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.value as T;
}

function setCached(key: string, value: unknown): void {
  cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function fetchBcbRate(): Promise<BcbResult> {
  const cached = getCached<BcbResult>("bcb");
  if (cached) return { ...cached, cached: true };

  const res = await fetch(BCB_URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "es-BO,es;q=0.9",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`BCB fetch failed: ${res.status}`);

  const htmlRaw = await res.text();
  const html = htmlRaw.replace(/\s+/g, " ");

  const block = html.match(
    /Valor referencial del d[oó]lar estadounidense(.*?)<\/article>/i,
  );
  if (!block) throw new Error("BCB: bloque 'Valor referencial' no encontrado en el HTML");

  const vals = block[1].match(/bcb-val">\s*(\d+[.,]\d+)/g);
  if (!vals || vals.length < 2) {
    throw new Error("BCB: no se extrajeron compra/venta del bloque");
  }
  const parseNum = (s: string): number => {
    const m = s.match(/(\d+[.,]\d+)/);
    if (!m) throw new Error(`BCB: parse num failed: ${s}`);
    return parseFloat(m[1].replace(",", "."));
  };

  const result: BcbResult = {
    source: "BCB",
    compra: parseNum(vals[0]),
    venta: parseNum(vals[1]),
    fetchedAt: new Date().toISOString(),
    cached: false,
  };
  setCached("bcb", result);
  return result;
}

async function fetchBinanceSide(side: "BUY" | "SELL"): Promise<{ avg: number; rows: number }> {
  const res = await fetch(BINANCE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      asset: "USDT",
      fiat: "BOB",
      tradeType: side,
      page: 1,
      rows: ROWS_BINANCE,
      payTypes: [],
      countries: [],
      publisherType: "merchant",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Binance ${side} fetch failed: ${res.status}`);
  const data = (await res.json()) as { data?: Array<{ adv: { price: string } }> };
  if (!data.data || data.data.length === 0) {
    throw new Error(`Binance ${side}: no merchants disponibles`);
  }
  const prices = data.data
    .map((item) => parseFloat(item.adv.price))
    .filter((p) => !isNaN(p));
  if (prices.length === 0) throw new Error(`Binance ${side}: precios no parseables`);

  const med = median(prices);
  const filtered = prices.filter((p) => Math.abs(p - med) / med <= OUTLIER_THRESHOLD);
  if (filtered.length === 0) throw new Error(`Binance ${side}: todos outliers vs mediana`);

  return {
    avg: filtered.reduce((a, b) => a + b, 0) / filtered.length,
    rows: filtered.length,
  };
}

async function fetchBinanceP2PRate(): Promise<BinanceP2PResult> {
  const cached = getCached<BinanceP2PResult>("binance");
  if (cached) return { ...cached, cached: true };

  const [buyRes, sellRes] = await Promise.all([fetchBinanceSide("BUY"), fetchBinanceSide("SELL")]);

  const result: BinanceP2PResult = {
    source: "Binance P2P",
    pair: "USDT/BOB",
    compra: Number(buyRes.avg.toFixed(4)),
    venta: Number(sellRes.avg.toFixed(4)),
    rowsConsidered: buyRes.rows + sellRes.rows,
    fetchedAt: new Date().toISOString(),
    cached: false,
  };
  setCached("binance", result);
  return result;
}

// ---------- MCP Server ----------

const server = new Server(
  { name: "exchange-rate-bolivia", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

const READ_ONLY = { annotations: { readOnlyHint: true } };

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "getBcbRate",
      description:
        "Tipo de cambio oficial del Banco Central de Bolivia (Bs por USD). Scrape de bcb.gob.bo. Devuelve { source, compra, venta, fetchedAt, cached }. Cache de 60s. Usar para: tipo de cambio oficial, valor BCB, dólar oficial Bolivia.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: READ_ONLY.annotations,
    },
    {
      name: "getBinanceP2PRate",
      description:
        "Tipo de cambio paralelo (mercado real) USDT/BOB en Binance P2P. POST al endpoint público de C2C, toma top 5 ofertas merchant para BUY y SELL, calcula mediana, filtra outliers >3%, promedia los restantes. Devuelve { source, pair, compra (BUY avg), venta (SELL avg), rowsConsidered, fetchedAt, cached }. Cache de 60s. Usar para: tipo de cambio paralelo, blue, P2P, valor real del dólar Bolivia.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: READ_ONLY.annotations,
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  try {
    if (name === "getBcbRate") {
      const result = await fetchBcbRate();
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
    if (name === "getBinanceP2PRate") {
      const result = await fetchBinanceP2PRate();
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
    return {
      isError: true,
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
    };
  } catch (err) {
    return {
      isError: true,
      content: [{ type: "text", text: `Error en ${name}: ${(err as Error).message}` }],
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
