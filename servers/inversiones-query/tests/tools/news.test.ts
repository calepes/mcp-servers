import { describe, it, expect } from "vitest";
import { buildTickerNews } from "../../src/tools/news.js";
import type { YahooQuote } from "../../src/types.js";
import type { RawNewsItem } from "../../src/clients/yahoo.js";

const NOW = Date.parse("2026-09-03T00:00:00Z");
const hoursAgo = (h: number) => Math.floor(NOW / 1000 - h * 3600);

const quote: YahooQuote = {
  symbol: "NU",
  shortName: "Nu Holdings Ltd.",
  regularMarketPrice: 16.42,
  regularMarketChangePercent: 6.4987,
  regularMarketChange: 1.0021,
  currency: "USD",
  regularMarketTime: Math.floor(Date.parse("2026-09-02T20:00:00Z") / 1000),
  marketState: "CLOSED",
};

const raw: RawNewsItem[] = [
  { title: "Investor Day announced", publisher: "Business Wire", link: "https://a", providerPublishTime: hoursAgo(5) },
  { title: "What weighed on NU in Q2", publisher: "Insider Monkey", link: "https://b", providerPublishTime: hoursAgo(12) },
  { title: "Stale story from last month", publisher: "StockStory", link: "https://c", providerPublishTime: hoursAgo(24 * 30) },
  { title: "No timestamp", publisher: "Nobody", link: "https://d" },
];

describe("buildTickerNews", () => {
  it("drops headlines older than the window and those with no timestamp", () => {
    const result = buildTickerNews(quote, raw, 3, 8, NOW);
    expect(result.news.map((n) => n.title)).toEqual([
      "Investor Day announced",
      "What weighed on NU in Q2",
    ]);
  });

  it("sorts newest first and reports hoursAgo", () => {
    const result = buildTickerNews(quote, raw, 3, 8, NOW);
    expect(result.news[0].hoursAgo).toBe(5);
    expect(result.news[1].hoursAgo).toBe(12);
  });

  it("caps at limit", () => {
    const result = buildTickerNews(quote, raw, 3, 1, NOW);
    expect(result.news).toHaveLength(1);
  });

  it("ships the price move alongside the news so the model can cross them", () => {
    const result = buildTickerNews(quote, raw, 3, 8, NOW);
    expect(result.changePct).toBe(6.5);
    expect(result.currentPrice).toBe(16.42);
    expect(result.marketDate).toBe("2026-09-02");
  });

  it("returns an empty news list rather than throwing when Yahoo has nothing", () => {
    const result = buildTickerNews(quote, [], 3, 8, NOW);
    expect(result.news).toEqual([]);
    expect(result.changePct).toBe(6.5);
  });
});
