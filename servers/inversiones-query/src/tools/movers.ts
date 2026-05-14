import type { DailyMovers, DailyMover, YahooQuote, KuberaPosition } from "../types.js";
import type { KuberaClient } from "../clients/kubera.js";
import type { YahooClient } from "../clients/yahoo.js";
import type { Cache } from "../cache.js";
import { fetchKuberaPortfolio } from "./portfolio.js";

const CACHE_TTL = 60;
// Bare currency codes that Kubera uses for cash positions — not valid stock tickers.
const CURRENCY_CODES = new Set(["USD", "EUR", "GBP", "ARS", "PEN", "BOB", "BRL", "CLP", "COP", "MXN"]);

export function buildDailyMovers(
  quotes: YahooQuote[],
  positions: KuberaPosition[],
  n: number
): DailyMovers {
  // Sum shares per ticker across all brokers/accounts.
  const sharesByTicker = new Map<string, number>();
  for (const p of positions) {
    if (p.ticker && !CURRENCY_CODES.has(p.ticker)) {
      sharesByTicker.set(p.ticker, (sharesByTicker.get(p.ticker) ?? 0) + p.quantity);
    }
  }

  const toMover = (q: YahooQuote): DailyMover => {
    const shares = sharesByTicker.get(q.symbol) ?? 0;
    const changeUSD = Number(q.regularMarketChange.toFixed(4));
    return {
      ticker: q.symbol,
      name: q.shortName,
      changePct: Number(q.regularMarketChangePercent.toFixed(2)),
      changeUSD,
      shares: Number(shares.toFixed(4)),
      totalChangeUSD: Number((changeUSD * shares).toFixed(2)),
      currentPrice: q.regularMarketPrice,
      currency: q.currency,
    };
  };

  const sorted = [...quotes].sort((a, b) => b.regularMarketChangePercent - a.regularMarketChangePercent);
  const gainers = sorted.filter((q) => q.regularMarketChangePercent > 0).slice(0, n).map(toMover);
  const losers = [...quotes]
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
  const tickers = [
    ...new Set(
      portfolio.positions
        .map((p) => p.ticker)
        .filter((t): t is string => t !== null && t !== "" && !CURRENCY_CODES.has(t))
    ),
  ];

  const quotes = await yahoo.getBulkQuotes(tickers);
  const result = buildDailyMovers(quotes, portfolio.positions, n);
  cache.set(cacheKey, result, CACHE_TTL);
  return result;
}
