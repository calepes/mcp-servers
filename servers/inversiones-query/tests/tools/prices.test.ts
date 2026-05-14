import { describe, it, expect, vi } from "vitest";
import { getPriceHistory } from "../../src/tools/prices.js";
import { Cache } from "../../src/cache.js";

const mockHistory = {
  ticker: "SPY",
  currency: "USD",
  history: [
    { date: "2026-05-12", close: 495, changePct: 0 },
    { date: "2026-05-13", close: 500, changePct: 1.01 },
  ],
  periodHigh: 500,
  periodLow: 495,
  periodChangePct: 1.01,
};

describe("getPriceHistory", () => {
  it("returns cached data on second call without calling Yahoo again", async () => {
    const yahooSpy = { getChartHistory: vi.fn().mockResolvedValue(mockHistory) };
    const cache = new Cache();

    await getPriceHistory("SPY", 30, yahooSpy as never, cache);
    await getPriceHistory("SPY", 30, yahooSpy as never, cache);

    expect(yahooSpy.getChartHistory).toHaveBeenCalledTimes(1);
  });

  it("passes days parameter to Yahoo client", async () => {
    const yahooSpy = { getChartHistory: vi.fn().mockResolvedValue(mockHistory) };
    const cache = new Cache();

    await getPriceHistory("SPY", 90, yahooSpy as never, cache);
    expect(yahooSpy.getChartHistory).toHaveBeenCalledWith("SPY", 90);
  });
});
