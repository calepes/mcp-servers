import type { PortfolioGoal } from "../types.js";
import type { KuberaClient } from "../clients/kubera.js";
import type { AirtableClient } from "../clients/airtable.js";
import type { Cache } from "../cache.js";
import { getPortfolioSummary } from "./portfolio.js";

export async function getPortfolioGoal(
  kubera: KuberaClient,
  airtable: AirtableClient,
  cache: Cache,
  year: number
): Promise<PortfolioGoal> {
  const cacheKey = `portfolio:goal:${year}`;
  const cached = cache.get<PortfolioGoal>(cacheKey);
  if (cached) return cached;

  const [summary, goal] = await Promise.all([
    getPortfolioSummary(kubera, cache),
    airtable.getAnnualGoal(year),
  ]);

  const current = summary.totalValue;
  const result: PortfolioGoal = {
    year,
    goal,
    current,
    progressPct: goal > 0 ? Number(((current / goal) * 100).toFixed(1)) : 0,
    remaining: Math.max(0, goal - current),
  };
  cache.set(cacheKey, result, 120);
  return result;
}
