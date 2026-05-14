import { describe, it, expect } from "vitest";
import { buildPortfolioSummary, buildPortfolioConcentration } from "../../src/tools/portfolio.js";
import type { KuberaPortfolio } from "../../src/types.js";

const mockPortfolio: KuberaPortfolio = {
  totalValue: 65000,
  costBasis: 50000,
  unrealizedGain: 15000,
  cagrYTD: 8.5,
  cashOnHand: 2000,
  asOf: "2026-05-13T20:00:00Z",
  positions: [
    { custodianId: "a1", ticker: "SPY", name: "SPDR S&P 500", value: 30000, costBasis: 25000, quantity: 60, broker: "Hapi", assetType: "ETF", sector: "Broad Market", currency: "USD" },
    { custodianId: "a2", ticker: "NVDA", name: "NVIDIA", value: 25000, costBasis: 15000, quantity: 20, broker: "Interactive Brokers", assetType: "Stock", sector: "Technology", currency: "USD" },
    { custodianId: "a3", ticker: null, name: "Hapi Cash", value: 2000, costBasis: 2000, quantity: 1, broker: "Hapi", assetType: "Cash", sector: "Cash", currency: "USD" },
    { custodianId: "a4", ticker: "ALICORC1", name: "Alicorp", value: 8000, costBasis: 8000, quantity: 468, broker: "Credicorp Capital", assetType: "Stock", sector: "Consumer", currency: "PEN" },
  ],
};

describe("buildPortfolioSummary", () => {
  it("maps Kubera portfolio to summary", () => {
    const summary = buildPortfolioSummary(mockPortfolio);
    expect(summary.totalValue).toBe(65000);
    expect(summary.costBasis).toBe(50000);
    expect(summary.totalGain).toBe(15000);
    expect(summary.cagrYTD).toBe(8.5);
    expect(summary.positionCount).toBe(4);
    expect(summary.currency).toBe("USD");
  });

  it("calculates totalGainPct correctly", () => {
    const summary = buildPortfolioSummary(mockPortfolio);
    expect(summary.totalGainPct).toBeCloseTo(30, 1); // 15000/50000 * 100
  });
});

describe("buildPortfolioConcentration", () => {
  it("groups by assetType", () => {
    const conc = buildPortfolioConcentration(mockPortfolio);
    const etf = conc.byAssetType.find((s) => s.label === "ETF");
    expect(etf?.valueUSD).toBe(30000);
    expect(etf?.valuePct).toBeCloseTo(30000 / 65000 * 100, 1);
  });

  it("groups by broker", () => {
    const conc = buildPortfolioConcentration(mockPortfolio);
    const hapi = conc.byBroker.find((s) => s.label === "Hapi");
    expect(hapi?.valueUSD).toBe(32000); // 30000 + 2000
  });

  it("sorts slices by valueUSD desc", () => {
    const conc = buildPortfolioConcentration(mockPortfolio);
    const values = conc.byAssetType.map((s) => s.valueUSD);
    expect(values).toEqual([...values].sort((a, b) => b - a));
  });
});
