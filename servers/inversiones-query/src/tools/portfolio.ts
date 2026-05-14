import type {
  KuberaPortfolio,
  PortfolioSummary,
  PortfolioPerformance,
  PortfolioConcentration,
  ConcentrationSlice,
  Period,
} from "../types.js";
import { KuberaClient } from "../clients/kubera.js";
import type { Cache } from "../cache.js";

const PORTFOLIO_ID = process.env["KUBERA_INVESTMENTS_ID"] ?? "6bccf4ba-e50d-442b-9f52-5cb3bc64523d";
const CACHE_TTL = 120;

export function buildPortfolioSummary(portfolio: KuberaPortfolio): PortfolioSummary {
  const totalGain = portfolio.totalValue - portfolio.costBasis;
  const totalGainPct = portfolio.costBasis ? (totalGain / portfolio.costBasis) * 100 : 0;
  return {
    totalValue: portfolio.totalValue,
    costBasis: portfolio.costBasis,
    totalGain,
    totalGainPct: Number(totalGainPct.toFixed(2)),
    unrealizedGain: portfolio.unrealizedGain,
    cagrYTD: portfolio.cagrYTD,
    cashOnHand: portfolio.cashOnHand,
    positionCount: portfolio.positions.length,
    currency: "USD",
    asOf: portfolio.asOf,
  };
}

export function buildPortfolioConcentration(portfolio: KuberaPortfolio): PortfolioConcentration {
  const total = portfolio.totalValue || 1;

  function group(key: keyof typeof portfolio.positions[0]): ConcentrationSlice[] {
    const map = new Map<string, number>();
    for (const p of portfolio.positions) {
      const label = String(p[key]);
      map.set(label, (map.get(label) ?? 0) + p.value);
    }
    return [...map.entries()]
      .map(([label, valueUSD]) => ({
        label,
        valueUSD,
        valuePct: Number((valueUSD / total * 100).toFixed(2)),
      }))
      .sort((a, b) => b.valueUSD - a.valueUSD);
  }

  return {
    byAssetType: group("assetType"),
    bySector: group("sector"),
    byBroker: group("broker"),
  };
}

export async function getPortfolioSummary(
  kubera: KuberaClient,
  cache: Cache
): Promise<PortfolioSummary> {
  const cacheKey = `portfolio:summary`;
  const cached = cache.get<PortfolioSummary>(cacheKey);
  if (cached) return cached;

  const portfolio = await fetchKuberaPortfolio(kubera);
  const summary = buildPortfolioSummary(portfolio);
  cache.set(cacheKey, summary, CACHE_TTL);
  return summary;
}

export async function getPortfolioConcentration(
  kubera: KuberaClient,
  cache: Cache
): Promise<PortfolioConcentration> {
  const cacheKey = `portfolio:concentration`;
  const cached = cache.get<PortfolioConcentration>(cacheKey);
  if (cached) return cached;

  const portfolio = await fetchKuberaPortfolio(kubera);
  const conc = buildPortfolioConcentration(portfolio);
  cache.set(cacheKey, conc, CACHE_TTL);
  return conc;
}

export async function getPortfolioPerformance(
  kubera: KuberaClient,
  cache: Cache,
  period: Period
): Promise<PortfolioPerformance> {
  const cacheKey = `portfolio:performance:${period}`;
  const cached = cache.get<PortfolioPerformance>(cacheKey);
  if (cached) return cached;

  const [histResult, cagrResult] = await Promise.all([
    kubera.callTool("get_portfolio_history", { portfolioId: PORTFOLIO_ID, period }),
    kubera.callTool("get_portfolio_cagr", { portfolioId: PORTFOLIO_ID }),
  ]);

  const histText = KuberaClient.extractText(histResult);
  const cagrText = KuberaClient.extractText(cagrResult);

  let hist: { startValue: number; endValue: number } = { startValue: 0, endValue: 0 };
  let cagrValue: number | null = null;

  try { hist = JSON.parse(histText); } catch { /* ignore */ }
  try {
    const cagrData = JSON.parse(cagrText) as { cagrYTD?: number };
    cagrValue = cagrData.cagrYTD ?? null;
  } catch { /* ignore */ }

  const delta = hist.endValue - hist.startValue;
  const deltaPct = hist.startValue ? (delta / hist.startValue) * 100 : 0;
  const shortPeriods: Period[] = ["1D", "1W"];
  const cagr = shortPeriods.includes(period) ? null : cagrValue;

  const result: PortfolioPerformance = {
    period,
    startValue: hist.startValue,
    endValue: hist.endValue,
    deltaUSD: Number(delta.toFixed(2)),
    deltaPct: Number(deltaPct.toFixed(2)),
    cagr,
  };

  cache.set(cacheKey, result, CACHE_TTL);
  return result;
}

// Internal: fetch and parse Kubera portfolio (shared across tools in this file)
export async function fetchKuberaPortfolio(kubera: KuberaClient): Promise<KuberaPortfolio> {
  const result = await kubera.callTool("get_portfolio", { portfolioId: PORTFOLIO_ID });
  const text = KuberaClient.extractText(result);

  let data: Record<string, unknown> = {};
  try { data = JSON.parse(text); } catch { /* ignore */ }

  const positions = parsePositions(data);

  return {
    totalValue: Number(data["totalValue"] ?? data["total_value"] ?? 0),
    costBasis: Number(data["costBasis"] ?? data["cost_basis"] ?? 0),
    unrealizedGain: Number(data["unrealizedGain"] ?? data["unrealized_gain"] ?? 0),
    cagrYTD: Number(data["cagrYTD"] ?? data["cagr_ytd"] ?? 0),
    cashOnHand: Number(data["cashOnHand"] ?? data["cash_on_hand"] ?? 0),
    positions,
    asOf: String(data["asOf"] ?? data["as_of"] ?? new Date().toISOString()),
  };
}

function parsePositions(data: Record<string, unknown>) {
  const raw = (data["positions"] ?? data["assets"] ?? []) as Array<Record<string, unknown>>;
  return raw.map((p) => ({
    custodianId: String(p["custodianId"] ?? p["id"] ?? ""),
    ticker: (p["ticker"] as string | null) ?? null,
    name: String(p["name"] ?? ""),
    value: Number(p["value"] ?? 0),
    costBasis: Number(p["costBasis"] ?? p["cost_basis"] ?? 0),
    quantity: Number(p["quantity"] ?? p["shares"] ?? 0),
    broker: String(p["broker"] ?? p["custodian"] ?? ""),
    assetType: String(p["assetType"] ?? p["asset_type"] ?? "Other"),
    sector: String(p["sector"] ?? "Other"),
    currency: String(p["currency"] ?? "USD"),
  }));
}
