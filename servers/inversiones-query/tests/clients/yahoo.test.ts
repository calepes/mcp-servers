import { describe, it, expect, vi } from "vitest";
import { YahooClient } from "../../src/clients/yahoo.js";

const mockQuoteResponse = {
  quoteResponse: {
    result: [
      {
        symbol: "SPY",
        shortName: "SPDR S&P 500",
        regularMarketPrice: 500,
        regularMarketChangePercent: 1.5,
        regularMarketChange: 7.5,
        currency: "USD",
        regularMarketTime: 1715000000,
        marketState: "REGULAR",
      },
    ],
    error: null,
  },
};

const mockChartResponse = {
  chart: {
    result: [
      {
        meta: { currency: "USD", regularMarketPrice: 500 },
        timestamp: [1714000000, 1714086400, 1714172800],
        indicators: {
          quote: [{ close: [490, 495, 500] }],
        },
      },
    ],
    error: null,
  },
};

describe("YahooClient", () => {
  it("fetches bulk quotes for multiple tickers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => mockQuoteResponse })
    );

    const client = new YahooClient();
    const quotes = await client.getBulkQuotes(["SPY"]);
    expect(quotes).toHaveLength(1);
    expect(quotes[0].symbol).toBe("SPY");
    expect(quotes[0].regularMarketPrice).toBe(500);
  });

  it("fetches price history for a ticker", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => mockChartResponse })
    );

    const client = new YahooClient();
    const history = await client.getChartHistory("SPY", 30);
    expect(history.ticker).toBe("SPY");
    expect(history.currency).toBe("USD");
    expect(history.history).toHaveLength(3);
    expect(history.history[0].close).toBe(490);
  });

  it("includes changePct for each day in history", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => mockChartResponse })
    );

    const client = new YahooClient();
    const history = await client.getChartHistory("SPY", 30);
    // Day 0: no prev, so 0. Day 1: (495-490)/490. Day 2: (500-495)/495
    expect(history.history[0].changePct).toBe(0);
    expect(history.history[1].changePct).toBeCloseTo((495 - 490) / 490 * 100, 2);
  });

  it("throws on HTTP error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => "Too Many Requests" })
    );
    const client = new YahooClient();
    await expect(client.getBulkQuotes(["SPY"])).rejects.toThrow("Yahoo Finance HTTP 429");
  });
});
