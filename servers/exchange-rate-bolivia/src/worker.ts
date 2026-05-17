import { handleMcp, type McpTool, type McpEnv } from 'worker-mcp-utils';

interface Env extends McpEnv {}

const BCB_URL = 'https://www.bcb.gob.bo';
const BINANCE_URL = 'https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search';
const CACHE_TTL_MS = 60_000;
const ROWS_BINANCE = 5;
const OUTLIER_THRESHOLD = 0.03;

const cache = new Map<string, { value: unknown; expires: number }>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry || entry.expires < Date.now()) { cache.delete(key); return null; }
  return entry.value as T;
}
function setCached(key: string, value: unknown) {
  cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
}
function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 !== 0 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function fetchBcbRate() {
  const cached = getCached<unknown>('bcb');
  if (cached) return { ...(cached as object), cached: true };
  const res = await fetch(BCB_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'es-BO,es;q=0.9',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`BCB fetch failed: ${res.status}`);
  const htmlRaw = await res.text();
  const html = htmlRaw.replace(/\s+/g, ' ');
  const block = html.match(/Valor referencial del d[oó]lar estadounidense(.*?)<\/article>/i);
  if (!block) throw new Error('BCB: bloque "Valor referencial" no encontrado en el HTML');
  const vals = block[1].match(/bcb-val">\s*(\d+[.,]\d+)/g);
  if (!vals || vals.length < 2) throw new Error('BCB: no se extrajeron compra/venta del bloque');
  const parseNum = (s: string): number => {
    const m = s.match(/(\d+[.,]\d+)/);
    if (!m) throw new Error(`BCB: parse num failed: ${s}`);
    return parseFloat(m[1].replace(',', '.'));
  };
  const result = { source: 'BCB', compra: parseNum(vals[0]), venta: parseNum(vals[1]), fetchedAt: new Date().toISOString(), cached: false };
  setCached('bcb', result);
  return result;
}

async function fetchBinanceP2P() {
  const cached = getCached<unknown>('binance');
  if (cached) return { ...(cached as object), cached: true };
  async function side(tradeType: 'BUY' | 'SELL') {
    const res = await fetch(BINANCE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fiat: 'BOB', asset: 'USDT', tradeType, rows: ROWS_BINANCE, page: 1, publisherType: 'merchant' }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Binance P2P fetch failed: ${res.status}`);
    const data = await res.json() as { data: Array<{ adv: { price: string } }> };
    const prices = data.data.map(d => parseFloat(d.adv.price));
    const med = median(prices);
    return median(prices.filter(p => Math.abs(p - med) / med <= OUTLIER_THRESHOLD));
  }
  const [compra, venta] = await Promise.all([side('BUY'), side('SELL')]);
  const result = { source: 'Binance P2P', pair: 'USDT/BOB', compra, venta, rowsConsidered: ROWS_BINANCE, fetchedAt: new Date().toISOString(), cached: false };
  setCached('binance', result);
  return result;
}

const TOOLS: McpTool[] = [
  {
    name: 'getBcbRate',
    description: 'Tipo de cambio oficial Bs/USD del Banco Central de Bolivia (BCB). Cache 60s.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'getBinanceP2PRate',
    description: 'Tipo de cambio paralelo USDT/BOB en Binance P2P (merchants, mediana top 5). Cache 60s.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    annotations: { readOnlyHint: true },
  },
];

async function dispatchTool(name: string) {
  if (name === 'getBcbRate') return fetchBcbRate();
  if (name === 'getBinanceP2PRate') return fetchBinanceP2P();
  throw new Error(`Unknown tool: ${name}`);
}

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    return handleMcp(req, env, TOOLS, 'exchange-rate-bolivia', (_name, _args) => dispatchTool(_name));
  },
} satisfies ExportedHandler<Env>;
