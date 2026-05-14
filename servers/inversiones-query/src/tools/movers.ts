import type { DailyMovers, DailyMover, YahooQuote } from "../types.js";
import type { KuberaClient } from "../clients/kubera.js";
import type { YahooClient } from "../clients/yahoo.js";
import type { Cache } from "../cache.js";
import { fetchKuberaPortfolio } from "./portfolio.js";

const CACHE_TTL = 60;

export function buildDailyMovers(quotes: YahooQuote[], n: number): DailyMovers {
  const sorted = [...quotes].sort((a, b) => b.regularMarketChangePercent - a.regularMarketChangePercent);
  const gainers: DailyMover[] = sorted
    .filter((q) => q.regularMarketChangePercent > 0)
    .slice(0, n)
    .map(toMover);
  const losers: DailyMover[] = [...quotes]
    .sort((a, b) => a.regularMarketChangePercent - b.regularMarketChangePercent)
    .filter((q) => q.regularMarketChangePercent < 0)
    .slice(0, n)
    .map(toMover);

  const marketOpen = quotes.some((q) => q.marketState === "REGULAR");
  const latest = quotes.reduce<number>((max, q) => Math.max(max, q.regularMarketTime), 0);
  const marketDate = latest
    ? new Date(latest * 1000).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  return { gainers, losers, marketDate, marketOpen };
}

function toMover(q: YahooQuote): DailyMover {
  return {
    ticker: q.symbol,
    name: q.shortName,
    changePct: Number(q.regularMarketChangePercent.toFixed(2)),
    changeUSD: Number(q.regularMarketChange.toFixed(2)),
    currentPrice: q.regularMarketPrice,
    currency: q.currency,
  };
}

export async function getDailyMovers(
  kubera: KuberaClient,
  yahoo: YahooClient,
  cache: Cache,
  n = 5
): Promise<DailyMovers> {
  const cacheKey = `movers:${n}`;
  const cached = cache.get<DailyMovers>(cacheKey);
  if (cached) return cached;

  const portfolio = await fetchKuberaPortfolio(kubera);
  // Deduplicate and filter out bare currency codes (USD/EUR/etc.) that Kubera
  // uses for cash positions — they map to unrelated ETFs on Yahoo Finance.
  const CURRENCY_CODES = new Set(["USD", "EUR", "GBP", "ARS", "PEN", "BOB", "BRL", "CLP", "COP", "MXN"]);
  const tickers = [
    ...new Set(
      portfolio.positions
        .map((p) => p.ticker)
        .filter((t): t is string => t !== null && t !== "" && !CURRENCY_CODES.has(t))
    ),
  ];

  const quotes = await yahoo.getBulkQuotes(tickers);
  const result = buildDailyMovers(quotes, n);
  cache.set(cacheKey, result, CACHE_TTL);
  return result;
}
