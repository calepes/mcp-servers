import { describe, it, expect } from "vitest";
import { buildDailyMovers } from "../../src/tools/movers.js";
import type { YahooQuote } from "../../src/types.js";

const quotes: YahooQuote[] = [
  { symbol: "NVDA", shortName: "NVIDIA", regularMarketPrice: 900, regularMarketChangePercent: 5.2, regularMarketChange: 44.5, currency: "USD", regularMarketTime: 1715000000, marketState: "REGULAR" },
  { symbol: "SPY", shortName: "SPDR S&P 500", regularMarketPrice: 500, regularMarketChangePercent: 1.1, regularMarketChange: 5.5, currency: "USD", regularMarketTime: 1715000000, marketState: "REGULAR" },
  { symbol: "ASML", shortName: "ASML Holding", regularMarketPrice: 700, regularMarketChangePercent: -3.4, regularMarketChange: -24.7, currency: "USD", regularMarketTime: 1715000000, marketState: "REGULAR" },
  { symbol: "ALICORC1.LM", shortName: "Alicorp", regularMarketPrice: 3.23, regularMarketChangePercent: -1.0, regularMarketChange: -0.033, currency: "PEN", regularMarketTime: 1715000000, marketState: "CLOSED" },
];

describe("buildDailyMovers", () => {
  it("returns top N gainers sorted desc", () => {
    const result = buildDailyMovers(quotes, 2);
    expect(result.gainers).toHaveLength(2);
    expect(result.gainers[0].ticker).toBe("NVDA");
    expect(result.gainers[1].ticker).toBe("SPY");
  });

  it("returns top N losers sorted asc", () => {
    const result = buildDailyMovers(quotes, 2);
    expect(result.losers).toHaveLength(2);
    expect(result.losers[0].ticker).toBe("ASML");
    expect(result.losers[1].ticker).toBe("ALICORC1.LM");
  });

  it("sets marketOpen true when any quote is in REGULAR state", () => {
    const result = buildDailyMovers(quotes, 5);
    expect(result.marketOpen).toBe(true);
  });

  it("sets marketOpen false when all quotes are CLOSED", () => {
    const closedQuotes = quotes.map((q) => ({ ...q, marketState: "CLOSED" }));
    const result = buildDailyMovers(closedQuotes, 5);
    expect(result.marketOpen).toBe(false);
  });
});
