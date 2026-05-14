import { describe, it, expect } from "vitest";
import { filterTransactions } from "../../src/tools/transactions.js";
import type { Transaction } from "../../src/types.js";

const txs: Transaction[] = [
  { date: "2026-05-13", ticker: "SPY", type: "Compra", shares: 1.42, pricePerShare: 738, totalAmount: 1050, fee: 0.1, broker: "Hapi", notes: "" },
  { date: "2026-05-01", ticker: "NVDA", type: "Compra", shares: 1, pricePerShare: 800, totalAmount: 800, fee: 0, broker: "Interactive Brokers", notes: "" },
  { date: "2026-04-10", ticker: "SPY", type: "Venta", shares: -2, pricePerShare: 700, totalAmount: 1400, fee: 0, broker: "Hapi", notes: "" },
];

describe("filterTransactions", () => {
  it("returns all when no filters", () => {
    expect(filterTransactions(txs, {}).transactions).toHaveLength(3);
  });

  it("filters by ticker", () => {
    const result = filterTransactions(txs, { ticker: "SPY" });
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions.every((t) => t.ticker === "SPY")).toBe(true);
  });

  it("filters by broker", () => {
    const result = filterTransactions(txs, { broker: "Hapi" });
    expect(result.transactions).toHaveLength(2);
  });

  it("applies limit", () => {
    const result = filterTransactions(txs, { limit: 2 });
    expect(result.transactions).toHaveLength(2);
    expect(result.total).toBe(3); // total before limit
  });

  it("reports total before limit", () => {
    const result = filterTransactions(txs, { ticker: "SPY", limit: 1 });
    expect(result.transactions).toHaveLength(1);
    expect(result.total).toBe(2);
  });
});
