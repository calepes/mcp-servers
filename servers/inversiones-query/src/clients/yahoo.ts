import type { YahooQuote, PriceHistory, PricePoint } from "../types.js";

// Raw shape from Yahoo's search endpoint — normalized into NewsItem by tools/news.ts
export interface RawNewsItem {
  title?: string;
  publisher?: string;
  link?: string;
  providerPublishTime?: number;
}

// query2 works without auth; /v7/quote on query1 requires authentication (blocked as of 2026-05)
const BASE = "https://query2.finance.yahoo.com";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

export class YahooClient {
  // Fetches quotes via the chart endpoint (one req per ticker, parallel).
  // /v7/finance/quote bulk endpoint was blocked by Yahoo (401 Unauthorized).
  async getBulkQuotes(tickers: string[]): Promise<YahooQuote[]> {
    if (tickers.length === 0) return [];
    const results = await Promise.allSettled(
      tickers.map((ticker) => this.getQuoteFromChart(ticker))
    );
    return results
      .filter((r): r is PromiseFulfilledResult<YahooQuote> => r.status === "fulfilled")
      .map((r) => r.value);
  }

  private async getQuoteFromChart(ticker: string): Promise<YahooQuote> {
    const url = `${BASE}/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d`;
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`Yahoo Finance HTTP ${res.status} for ${ticker}`);
    const data = await res.json() as {
      chart: {
        result: Array<{
          meta: Record<string, unknown>;
          indicators?: { quote?: Array<{ close?: (number | null)[] }> };
        }>;
        error: unknown;
      };
    };
    if (data.chart.error) throw new Error(`Yahoo Finance error for ${ticker}`);
    const result = data.chart.result[0];
    const meta = result?.meta ?? {};
    const price = Number(meta["regularMarketPrice"] ?? 0);
    // meta.chartPreviousClose is the close *before the requested range* (with range=5d,
    // ~6 trading days back), NOT yesterday's close — using it here previously produced
    // a multi-day drift mislabeled as the 1-day change. The daily closes array from the
    // chart itself is the reliable source for the prior trading day's close.
    const closes = result?.indicators?.quote?.[0]?.close ?? [];
    let prevClose = price;
    for (let i = closes.length - 2; i >= 0; i--) {
      const c = closes[i];
      if (c !== null && c !== undefined) {
        prevClose = c;
        break;
      }
    }
    const change = price - prevClose;
    const changePct = prevClose ? (change / prevClose) * 100 : 0;
    return {
      symbol: ticker,
      shortName: String(meta["shortName"] ?? meta["longName"] ?? ticker),
      regularMarketPrice: price,
      regularMarketChange: Number(change.toFixed(4)),
      regularMarketChangePercent: Number(changePct.toFixed(4)),
      currency: String(meta["currency"] ?? "USD"),
      regularMarketTime: Number(meta["regularMarketTime"] ?? 0),
      marketState: String(meta["marketState"] ?? "CLOSED"),
    };
  }

  // Headlines only. /v1/finance/search works without auth (unlike /v7/quote) and
  // returns news[] alongside quote matches; quotesCount=0 keeps the payload small.
  async getNews(ticker: string, limit: number): Promise<RawNewsItem[]> {
    const url = `${BASE}/v1/finance/search?q=${encodeURIComponent(ticker)}&newsCount=${limit}&quotesCount=0`;
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`Yahoo Finance HTTP ${res.status} for ${ticker} news`);
    const data = await res.json() as { news?: RawNewsItem[] };
    return data.news ?? [];
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
