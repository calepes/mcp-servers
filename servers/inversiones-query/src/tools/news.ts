import type { TickerNews, NewsItem, YahooQuote } from "../types.js";
import type { YahooClient, RawNewsItem } from "../clients/yahoo.js";
import type { Cache } from "../cache.js";

const CACHE_TTL = 900; // 15 min — headlines move far slower than quotes
const DEFAULT_DAYS = 3; // covers a weekend, so a Monday move still finds Friday's news
const DEFAULT_LIMIT = 8;

// ponytail: headlines only, no article bodies. Fetching each story would be N extra
// round-trips per question; upgrade to fetching the top 1-2 bodies only if titles
// alone turn out to be too vague to explain a move.
export function buildTickerNews(
  quote: YahooQuote,
  raw: RawNewsItem[],
  days: number,
  limit: number,
  now: number
): TickerNews {
  const cutoff = now / 1000 - days * 86400;

  const news: NewsItem[] = raw
    .filter((n): n is RawNewsItem & { providerPublishTime: number } =>
      typeof n.providerPublishTime === "number" && n.providerPublishTime >= cutoff
    )
    .sort((a, b) => b.providerPublishTime - a.providerPublishTime)
    .slice(0, limit)
    .map((n) => ({
      title: n.title ?? "",
      publisher: n.publisher ?? "",
      publishedAt: new Date(n.providerPublishTime * 1000).toISOString(),
      hoursAgo: Number(((now / 1000 - n.providerPublishTime) / 3600).toFixed(1)),
      link: n.link ?? "",
    }));

  return {
    ticker: quote.symbol,
    name: quote.shortName,
    changePct: Number(quote.regularMarketChangePercent.toFixed(2)),
    currentPrice: quote.regularMarketPrice,
    currency: quote.currency,
    marketDate: quote.regularMarketTime
      ? new Date(quote.regularMarketTime * 1000).toISOString().slice(0, 10)
      : new Date(now).toISOString().slice(0, 10),
    windowDays: days,
    news,
  };
}

export async function getTickerNews(
  ticker: string,
  yahoo: YahooClient,
  cache: Cache,
  days = DEFAULT_DAYS,
  limit = DEFAULT_LIMIT
): Promise<TickerNews | null> {
  const symbol = ticker.trim().toUpperCase();
  const cacheKey = `news:${symbol}:${days}:${limit}`;
  const cached = cache.get<TickerNews>(cacheKey);
  if (cached) return cached;

  // The quote ships with the headlines on purpose: asking "why did X move?" needs the
  // move and the news in one payload, or the model answers from memory instead.
  const [quotes, raw] = await Promise.all([
    yahoo.getBulkQuotes([symbol]),
    yahoo.getNews(symbol, Math.max(limit * 2, 10)),
  ]);
  const quote = quotes[0];
  if (!quote) return null;

  const result = buildTickerNews(quote, raw, days, limit, Date.now());
  cache.set(cacheKey, result, CACHE_TTL);
  return result;
}
