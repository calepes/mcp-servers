import { describe, it, expect, vi } from "vitest";
import { YahooClient } from "../../src/clients/yahoo.js";

// getBulkQuotes fetches the chart endpoint per ticker (the v7 bulk quote endpoint
// is blocked by Yahoo) — mock must match that shape, not a quoteResponse.
const mockSpyChartResponse = {
  chart: {
    result: [
      {
        meta: {
          currency: "USD",
          regularMarketPrice: 500,
          shortName: "SPDR S&P 500",
          regularMarketTime: 1715000000,
          marketState: "REGULAR",
        },
        indicators: { quote: [{ close: [485, 490, 492.5, 495, 500] }] },
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
      vi.fn().mockResolvedValue({ ok: true, json: async () => mockSpyChartResponse })
    );

    const client = new YahooClient();
    const quotes = await client.getBulkQuotes(["SPY"]);
    expect(quotes).toHaveLength(1);
    expect(quotes[0].symbol).toBe("SPY");
    expect(quotes[0].regularMarketPrice).toBe(500);
  });

  it("computes the daily change from the prior trading day's close, not chartPreviousClose", async () => {
    // Regression test for the bug where meta.chartPreviousClose (the close before the
    // whole requested range, ~6 sessions back with range=5d) was used as "yesterday",
    // producing a multi-day drift mislabeled as the 1-day change.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          chart: {
            result: [
              {
                meta: {
                  currency: "USD",
                  regularMarketPrice: 14.19,
                  chartPreviousClose: 13.79, // ~6 sessions back — must NOT be used
                },
                indicators: { quote: [{ close: [13.59, 13.99, 14.39, 14.51, 14.19] }] },
              },
            ],
            error: null,
          },
        }),
      })
    );

    const client = new YahooClient();
    const [quote] = await client.getBulkQuotes(["NU"]);
    expect(quote.regularMarketPrice).toBe(14.19);
    // True prior close is the second-to-last daily close (14.51), not chartPreviousClose (13.79).
    expect(quote.regularMarketChange).toBeCloseTo(14.19 - 14.51, 4);
    expect(quote.regularMarketChangePercent).toBeCloseTo(((14.19 - 14.51) / 14.51) * 100, 2);
  });

  it("skips a null last close (pre-market/no trade yet) when finding the prior close", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          chart: {
            result: [
              {
                meta: { currency: "USD", regularMarketPrice: 100 },
                indicators: { quote: [{ close: [95, 98, null] }] },
              },
            ],
            error: null,
          },
        }),
      })
    );

    const client = new YahooClient();
    const [quote] = await client.getBulkQuotes(["XYZ"]);
    expect(quote.regularMarketChange).toBeCloseTo(100 - 98, 4);
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

  it("omits a ticker whose request fails, without failing the whole batch", async () => {
    // getBulkQuotes uses Promise.allSettled — one bad ticker shouldn't kill the batch.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => "Too Many Requests" })
    );
    const client = new YahooClient();
    const quotes = await client.getBulkQuotes(["SPY"]);
    expect(quotes).toEqual([]);
  });
});
