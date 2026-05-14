import type { YahooQuote, PriceHistory, PricePoint } from "../types.js";

const BASE = "https://query1.finance.yahoo.com";
const QUOTE_FIELDS = [
  "symbol",
  "shortName",
  "regularMarketPrice",
  "regularMarketChangePercent",
  "regularMarketChange",
  "currency",
  "regularMarketTime",
  "marketState",
].join(",");

export class YahooClient {
  async getBulkQuotes(tickers: string[]): Promise<YahooQuote[]> {
    if (tickers.length === 0) return [];
    const symbols = tickers.join(",");
    const url = `${BASE}/v7/finance/quote?symbols=${encodeURIComponent(symbols)}&fields=${QUOTE_FIELDS}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Yahoo Finance HTTP ${res.status}: ${await res.text()}`);
    }
    const data = await res.json() as { quoteResponse: { result: YahooQuote[]; error: unknown } };
    if (data.quoteResponse.error) {
      throw new Error(`Yahoo Finance error: ${JSON.stringify(data.quoteResponse.error)}`);
    }
    return data.quoteResponse.result ?? [];
  }

  async getChartHistory(ticker: string, days: number): Promise<PriceHistory> {
    const range = daysToRange(days);
    const url = `${BASE}/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=${range}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Yahoo Finance HTTP ${res.status}: ${await res.text()}`);
    }
    const data = await res.json() as {
      chart: {
        result: Array<{
          meta: { currency: string; regularMarketPrice: number };
          timestamp: number[];
          indicators: { quote: Array<{ close: (number | null)[] }> };
        }>;
        error: unknown;
      };
    };
    if (data.chart.error) {
      throw new Error(`Yahoo Finance chart error: ${JSON.stringify(data.chart.error)}`);
    }
    const result = data.chart.result[0];
    const closes = result.indicators.quote[0].close;
    const timestamps = result.timestamp;

    const history: PricePoint[] = closes.map((close, i) => {
      const prev = i > 0 ? (closes[i - 1] ?? close) : close;
      const changePct = i === 0 || !prev ? 0 : ((close ?? prev) - prev) / prev * 100;
      return {
        date: new Date((timestamps[i] ?? 0) * 1000).toISOString().slice(0, 10),
        close: close ?? 0,
        changePct: Number(changePct.toFixed(4)),
      };
    });

    const validCloses = closes.filter((c): c is number => c !== null);
    const periodHigh = Math.max(...validCloses);
    const periodLow = Math.min(...validCloses);
    const first = validCloses[0] ?? 0;
    const last = validCloses[validCloses.length - 1] ?? 0;
    const periodChangePct = first ? (last - first) / first * 100 : 0;

    return {
      ticker,
      currency: result.meta.currency,
      history,
      periodHigh,
      periodLow,
      periodChangePct: Number(periodChangePct.toFixed(4)),
    };
  }
}

function daysToRange(days: number): string {
  if (days <= 5) return "5d";
  if (days <= 30) return "1mo";
  if (days <= 90) return "3mo";
  if (days <= 180) return "6mo";
  if (days <= 365) return "1y";
  return "2y";
}
