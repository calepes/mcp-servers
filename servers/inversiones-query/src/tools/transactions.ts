import type { Transaction, TransactionHistory } from "../types.js";
import type { AirtableClient } from "../clients/airtable.js";
import type { Cache } from "../cache.js";

interface TransactionFilters {
  ticker?: string;
  broker?: string;
  limit?: number;
}

const CACHE_TTL = 300;

export function filterTransactions(
  transactions: Transaction[],
  { ticker, broker, limit = 20 }: TransactionFilters
): TransactionHistory {
  let filtered = transactions;
  if (ticker) {
    const t = ticker.toUpperCase();
    filtered = filtered.filter((tx) => tx.ticker.toUpperCase() === t);
  }
  if (broker) {
    const b = broker.toLowerCase();
    filtered = filtered.filter((tx) => tx.broker.toLowerCase().includes(b));
  }
  const total = filtered.length;
  return { transactions: filtered.slice(0, limit), total };
}

export async function getTransactionHistory(
  filters: TransactionFilters,
  airtable: AirtableClient,
  cache: Cache
): Promise<TransactionHistory> {
  const cacheKey = "transactions:all";
  let all = cache.get<Transaction[]>(cacheKey);

  if (!all) {
    all = await airtable.getTransactions();
    cache.set(cacheKey, all, CACHE_TTL);
  }

  return filterTransactions(all, filters);
}
