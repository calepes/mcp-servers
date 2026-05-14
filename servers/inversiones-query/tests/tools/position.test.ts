import { describe, it, expect } from "vitest";
import { buildPositionDetail, findPosition } from "../../src/tools/position.js";
import type { KuberaPortfolio, YahooQuote } from "../../src/types.js";

const portfolio: KuberaPortfolio = {
  totalValue: 65000,
  costBasis: 50000,
  unrealizedGain: 15000,
  cagrYTD: 8.5,
  cashOnHand: 2000,
  asOf: "2026-05-13T20:00:00Z",
  positions: [
    { custodianId: "a1", ticker: "SPY", name: "SPDR S&P 500", value: 30000, costBasis: 25000, quantity: 60, broker: "Hapi", assetType: "ETF", sector: "Broad Market", currency: "USD" },
    { custodianId: "a2", ticker: "BAP", name: "Credicorp Ltd", value: 10000, costBasis: 9000, quantity: 10, broker: "Credicorp Capital", assetType: "Stock", sector: "Finance", currency: "USD" },
  ],
};

const spyQuote: YahooQuote = {
  symbol: "SPY",
  shortName: "SPDR S&P 500",
  regularMarketPrice: 500,
  regularMarketChangePercent: 1.5,
  regularMarketChange: 7.5,
  currency: "USD",
  regularMarketTime: 1715000000,
  marketState: "REGULAR",
};

describe("buildPositionDetail", () => {
  it("maps position + quote to PositionDetail", () => {
    const pos = portfolio.positions[0];
    const detail = buildPositionDetail(pos, spyQuote, portfolio.totalValue);
    expect(detail.ticker).toBe("SPY");
    expect(detail.shares).toBe(60);
    expect(detail.currentPrice).toBe(500);
    expect(detail.avgCostBasis).toBeCloseTo(25000 / 60, 2);
    expect(detail.gainLossUSD).toBe(5000);
    expect(detail.dayChangePct).toBe(1.5);
    expect(detail.weight).toBeCloseTo(30000 / 65000 * 100, 1);
    expect(detail.broker).toBe("Hapi");
  });
});

describe("findPosition", () => {
  it("finds by exact ticker (case-insensitive)", () => {
    const pos = findPosition(portfolio, "spy");
    expect(pos?.ticker).toBe("SPY");
  });

  it("finds by partial name", () => {
    const pos = findPosition(portfolio, "credicorp");
    expect(pos?.ticker).toBe("BAP");
  });

  it("returns null when not found", () => {
    expect(findPosition(portfolio, "AAPL")).toBeNull();
  });
});
