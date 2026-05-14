import type { KuberaPortfolio, KuberaPosition, PositionDetail, YahooQuote } from "../types.js";
import type { KuberaClient } from "../clients/kubera.js";
import type { YahooClient } from "../clients/yahoo.js";
import type { Cache } from "../cache.js";
import { fetchKuberaPortfolio } from "./portfolio.js";

export function buildPositionDetail(
  pos: KuberaPosition,
  quote: YahooQuote,
  totalPortfolioValue: number
): PositionDetail {
  const avgCostBasis = pos.quantity ? pos.costBasis / pos.quantity : 0;
  const gainLossUSD = pos.value - pos.costBasis;
  const gainLossPct = pos.costBasis ? (gainLossUSD / pos.costBasis) * 100 : 0;
  const weight = totalPortfolioValue ? (pos.value / totalPortfolioValue) * 100 : 0;

  return {
    ticker: pos.ticker ?? quote.symbol,
    name: pos.name,
    shares: pos.quantity,
    currentPrice: quote.regularMarketPrice,
    avgCostBasis: Number(avgCostBasis.toFixed(4)),
    totalCost: pos.costBasis,
    currentValue: pos.value,
    gainLossUSD: Number(gainLossUSD.toFixed(2)),
    gainLossPct: Number(gainLossPct.toFixed(2)),
    dayChangePct: Number(quote.regularMarketChangePercent.toFixed(2)),
    dayChangeUSD: Number(quote.regularMarketChange.toFixed(2)),
    weight: Number(weight.toFixed(2)),
    broker: pos.broker,
    currency: pos.currency,
  };
}

export function findPosition(
  portfolio: KuberaPortfolio,
  query: string
): KuberaPosition | null {
  const q = query.toLowerCase().trim();
  // Exact ticker match
  const byTicker = portfolio.positions.find(
    (p) => p.ticker?.toLowerCase() === q
  );
  if (byTicker) return byTicker;
  // Partial name match
  const byName = portfolio.positions.find(
    (p) => p.name.toLowerCase().includes(q)
  );
  return byName ?? null;
}

export async function getPositionDetail(
  ticker: string,
  kubera: KuberaClient,
  yahoo: YahooClient,
  cache: Cache
): Promise<PositionDetail | null> {
  const cacheKey = `position:${ticker.toUpperCase()}`;
  const cached = cache.get<PositionDetail>(cacheKey);
  if (cached) return cached;

  const portfolio = await fetchKuberaPortfolio(kubera);
  const pos = findPosition(portfolio, ticker);
  if (!pos) return null;

  const t = pos.ticker ?? ticker;
  const quotes = await yahoo.getBulkQuotes([t]);
  const quote = quotes[0];
  if (!quote) return null;

  const detail = buildPositionDetail(pos, quote, portfolio.totalValue);
  cache.set(cacheKey, detail, 60);
  return detail;
}

export async function searchPosition(
  query: string,
  kubera: KuberaClient,
  yahoo: YahooClient,
  cache: Cache
): Promise<PositionDetail | null> {
  const portfolio = await fetchKuberaPortfolio(kubera);
  const pos = findPosition(portfolio, query);
  if (!pos || !pos.ticker) return null;

  const quotes = await yahoo.getBulkQuotes([pos.ticker]);
  const quote = quotes[0];
  if (!quote) return null;

  return buildPositionDetail(pos, quote, portfolio.totalValue);
}
