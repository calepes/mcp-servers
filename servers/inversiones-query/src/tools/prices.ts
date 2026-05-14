import type { PriceHistory } from "../types.js";
import type { YahooClient } from "../clients/yahoo.js";
import type { Cache } from "../cache.js";

const CACHE_TTL = 300;

export async function getPriceHistory(
  ticker: string,
  days: number = 30,
  yahoo: YahooClient,
  cache: Cache
): Promise<PriceHistory> {
  const cacheKey = `prices:${ticker.toUpperCase()}:${days}`;
  const cached = cache.get<PriceHistory>(cacheKey);
  if (cached) return cached;

  const history = await yahoo.getChartHistory(ticker, days);
  cache.set(cacheKey, history, CACHE_TTL);
  return history;
}
