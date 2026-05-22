import type {
  KuberaPortfolio,
  PortfolioSummary,
  PortfolioPerformance,
  PortfolioConcentration,
  ConcentrationSlice,
  Period,
} from "../types.js";
import { KuberaClient } from "../clients/kubera.js";
import type { YahooClient } from "../clients/yahoo.js";
import type { Cache } from "../cache.js";

const CURRENCY_CODES = new Set(["USD", "EUR", "GBP", "ARS", "PEN", "BOB", "BRL", "CLP", "COP", "MXN"]);

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
  yahoo: YahooClient,
  cache: Cache,
  period: Period
): Promise<PortfolioPerformance> {
  const cacheKey = `portfolio:performance:${period}`;
  const cached = cache.get<PortfolioPerformance>(cacheKey);
  if (cached) return cached;

  // 1D uses Yahoo Finance (regularMarketChange vs prev close) — Kubera history lacks daily granularity.
  if (period === "1D") {
    const portfolio = await fetchKuberaPortfolio(kubera);
    const tickers = [
      ...new Set(
        portfolio.positions
          .map((p) => p.ticker)
          .filter((t): t is string => t !== null && t !== "" && !CURRENCY_CODES.has(t))
      ),
    ];
    const quotes = await yahoo.getBulkQuotes(tickers);

    const sharesByTicker = new Map<string, number>();
    for (const p of portfolio.positions) {
      if (p.ticker && !CURRENCY_CODES.has(p.ticker)) {
        sharesByTicker.set(p.ticker, (sharesByTicker.get(p.ticker) ?? 0) + p.quantity);
      }
    }

    const deltaUSD = quotes.reduce((sum, q) => {
      const shares = sharesByTicker.get(q.symbol) ?? 0;
      return sum + q.regularMarketChange * shares;
    }, 0);

    const endValue = portfolio.totalValue;
    const startValue = endValue - deltaUSD;
    const deltaPct = startValue ? (deltaUSD / startValue) * 100 : 0;

    const result: PortfolioPerformance = {
      period,
      startValue: Number(startValue.toFixed(2)),
      endValue: Number(endValue.toFixed(2)),
      deltaUSD: Number(deltaUSD.toFixed(2)),
      deltaPct: Number(deltaPct.toFixed(2)),
      cagr: null,
    };
    cache.set(cacheKey, result, CACHE_TTL);
    return result;
  }

  const [histResult, cagrResult] = await Promise.all([
    kubera.callTool("get_portfolio_history", { portfolioId: PORTFOLIO_ID, period: "YTD" }),
    kubera.callTool("get_portfolio_cagr", { portfolioId: PORTFOLIO_ID }),
  ]);

  const histText = KuberaClient.extractText(histResult);
  const cagrText = KuberaClient.extractText(cagrResult);

  // Kubera v2: get_portfolio_history returns { portfolioDataPoints: [{date, value}] }
  // get_portfolio_cagr returns { cagrOldValues: { ytd_networth, qtd_networth, yearly_networth, ... } }
  const histData = JSON.parse(histText) as {
    portfolioDataPoints: Array<{ date: string; value: number }>;
  };
  const cagrData = JSON.parse(cagrText) as {
    cagrOldValues: Record<string, { date: string; oldValue: number }>;
  };

  const pts = histData.portfolioDataPoints ?? [];
  const endValue = pts[pts.length - 1]?.value ?? 0;
  const oldVals = cagrData.cagrOldValues ?? {};

  let startValue = 0;
  if (period === "YTD") {
    startValue = oldVals["ytd_networth"]?.oldValue ?? 0;
  } else if (period === "QTD") {
    startValue = oldVals["qtd_networth"]?.oldValue ?? 0;
  } else if (period === "1Y") {
    startValue = oldVals["yearly_networth"]?.oldValue ?? 0;
  } else {
    // 1W, 1M: find the last point at or before the cutoff date
    const daysBack = period === "1W" ? 7 : 30;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysBack);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    const startPt = [...pts].reverse().find((p) => p.date <= cutoffStr);
    startValue = startPt?.value ?? endValue;
  }

  const delta = endValue - startValue;
  const deltaPct = startValue ? (delta / startValue) * 100 : 0;
  const shortPeriods: Period[] = ["1W"];

  // Compute annualized return for longer periods
  let cagr: number | null = null;
  if (!shortPeriods.includes(period) && startValue > 0 && endValue > 0) {
    const startDateStr = period === "YTD"
      ? (oldVals["ytd_networth"]?.date ?? null)
      : period === "QTD"
      ? (oldVals["qtd_networth"]?.date ?? null)
      : period === "1Y"
      ? (oldVals["yearly_networth"]?.date ?? null)
      : null;
    if (startDateStr) {
      const years = (Date.now() - new Date(startDateStr).getTime()) / (365.25 * 24 * 3600 * 1000);
      cagr = years > 0 ? (Math.pow(endValue / startValue, 1 / years) - 1) * 100 : deltaPct;
    }
  }

  const result: PortfolioPerformance = {
    period,
    startValue: Number(startValue.toFixed(2)),
    endValue: Number(endValue.toFixed(2)),
    deltaUSD: Number(delta.toFixed(2)),
    deltaPct: Number(deltaPct.toFixed(2)),
    cagr: cagr !== null ? Number(cagr.toFixed(2)) : null,
  };

  cache.set(cacheKey, result, CACHE_TTL);
  return result;
}

// Internal: fetch and parse Kubera portfolio (shared across tools in this file).
// Kubera API v2 returns { id, name, currency, markdown } — not structured JSON.
// We parse the markdown tables to extract summary metrics and positions.
export async function fetchKuberaPortfolio(kubera: KuberaClient): Promise<KuberaPortfolio> {
  const result = await kubera.callTool("get_portfolio", { portfolioId: PORTFOLIO_ID });
  const text = KuberaClient.extractText(result);

  let outer: Record<string, unknown> = {};
  try { outer = JSON.parse(text); } catch { /* ignore */ }

  const markdown = typeof outer["markdown"] === "string" ? outer["markdown"] : "";
  const asOf = String(outer["asOf"] ?? outer["as_of"] ?? new Date().toISOString());

  if (markdown) {
    return parsePortfolioFromMarkdown(markdown, asOf);
  }

  // Fallback: legacy structured JSON response (may never occur with v2 API)
  const positions = parseLegacyPositions(outer);
  return {
    totalValue: Number(outer["totalValue"] ?? outer["total_value"] ?? 0),
    costBasis: Number(outer["costBasis"] ?? outer["cost_basis"] ?? 0),
    unrealizedGain: Number(outer["unrealizedGain"] ?? outer["unrealized_gain"] ?? 0),
    cagrYTD: Number(outer["cagrYTD"] ?? outer["cagr_ytd"] ?? 0),
    cashOnHand: Number(outer["cashOnHand"] ?? outer["cash_on_hand"] ?? 0),
    positions,
    asOf,
  };
}

// Parse a markdown table section into an array of {header: value} objects.
// section is the header text (e.g. "Summary", "Assets"). Returns [] if not found.
function parseMarkdownTable(markdown: string, section: string): Array<Record<string, string>> {
  const sectionRe = new RegExp(`##\\s+${section}\\s*\\n`);
  const match = sectionRe.exec(markdown);
  if (!match) return [];

  const rest = markdown.slice(match.index + match[0].length);
  const lines = rest.split("\n");

  // Find header row (first line starting with |)
  const headerIdx = lines.findIndex((l) => l.startsWith("|"));
  if (headerIdx < 0) return [];

  const headers = lines[headerIdx]
    .split("|")
    .slice(1, -1)
    .map((h) => h.trim());

  // Skip separator row (| ---- |)
  const dataStart = headerIdx + 2;
  const rows: Array<Record<string, string>> = [];

  for (let i = dataStart; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith("|")) break; // end of table
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = cells[idx] ?? ""; });
    rows.push(row);
  }

  return rows;
}

// Parse numeric value from Kubera markdown (e.g. "13,549" → 13549, "-" → 0)
function parseMd(val: string | undefined): number {
  if (!val || val === "-") return 0;
  return Number(val.replace(/,/g, "")) || 0;
}

function parsePortfolioFromMarkdown(markdown: string, asOf: string): KuberaPortfolio {
  // Extract summary metrics from ## Summary table
  const summaryRows = parseMarkdownTable(markdown, "Summary");
  const summaryMap: Record<string, number> = {};
  for (const row of summaryRows) {
    summaryMap[row["Metric"] ?? ""] = parseMd(row["Value"]);
  }

  const totalValue = summaryMap["Total Assets"] ?? summaryMap["Net Worth"] ?? 0;
  const costBasis = summaryMap["Cost Basis"] ?? 0;
  const unrealizedGain = summaryMap["Unrealized Gain"] ?? 0;
  const cashOnHand = summaryMap["Cash On Hand"] ?? 0;

  // Extract CAGR YTD from ## CAGR table
  const cagrRows = parseMarkdownTable(markdown, "CAGR");
  const ytdRow = cagrRows.find((r) => r["Period"] === "YTD");
  const cagrPct = ytdRow ? parseMd(ytdRow["Net Worth"]?.replace("%", "")) : 0;

  // Extract positions from ## Assets table
  const assetRows = parseMarkdownTable(markdown, "Assets");
  const positions = assetRows
    .filter((r) => r["Name"] && !r["Name"].startsWith("Portfolio -")) // skip rollup rows
    .map((r) => {
      // "Sheet > Section" format: "Broker Name > Section"
      const sheetSection = r["Sheet > Section"] ?? r["Sheet"] ?? "";
      const broker = sheetSection.split(">")[0].trim();
      const ticker = r["Ticker"]?.trim() || null;
      return {
        custodianId: r["ID"] ?? "",
        ticker: ticker && ticker.length > 0 ? ticker : null,
        name: r["Name"] ?? "",
        value: parseMd(r["Value"] ?? r["Value (USD)"]),
        costBasis: parseMd(r["Cost"]),
        quantity: parseMd(r["Quantity"]),
        broker,
        assetType: r["Asset Class"] ?? "Other",
        sector: r["Sector"] ?? "Other",
        currency: r["Currency"] ?? "USD",
      };
    });

  return { totalValue, costBasis, unrealizedGain, cagrYTD: cagrPct, cashOnHand, positions, asOf };
}

function parseLegacyPositions(data: Record<string, unknown>) {
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
