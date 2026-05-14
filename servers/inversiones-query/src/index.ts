import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { Cache } from "./cache.js";
import { KuberaClient } from "./clients/kubera.js";
import { YahooClient } from "./clients/yahoo.js";
import { AirtableClient } from "./clients/airtable.js";
import { getPortfolioSummary, getPortfolioConcentration, getPortfolioPerformance } from "./tools/portfolio.js";
import { getDailyMovers } from "./tools/movers.js";
import { getPositionDetail, searchPosition } from "./tools/position.js";
import { getPriceHistory } from "./tools/prices.js";
import { getTransactionHistory } from "./tools/transactions.js";
import type { Period } from "./types.js";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

const kuberaToken = requireEnv("KUBERA_AUTH_TOKEN");
const airtableToken = requireEnv("AIRTABLE_TOKEN");
const airtableBaseId = requireEnv("AIRTABLE_BASE_ID");

const cache = new Cache();
const kubera = new KuberaClient(kuberaToken);
const yahoo = new YahooClient();
const airtable = new AirtableClient(airtableToken, airtableBaseId);

const server = new Server(
  { name: "inversiones-query", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "getPortfolioSummary",
      description: "Returns total portfolio value, cost basis, P&L, CAGR YTD, and cash on hand",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "getDailyMovers",
      description: "Returns top N daily gainers and losers from the portfolio using Yahoo Finance",
      inputSchema: {
        type: "object",
        properties: { n: { type: "number", description: "Number of movers to return (default 5)" } },
        required: [],
      },
    },
    {
      name: "getPositionDetail",
      description: "Returns detailed info for a single position: shares, cost basis, P&L, daily change, weight",
      inputSchema: {
        type: "object",
        properties: { ticker: { type: "string", description: "Ticker symbol (e.g. SPY, NVDA)" } },
        required: ["ticker"],
      },
    },
    {
      name: "getPortfolioPerformance",
      description: "Returns portfolio performance for a given period: value change and CAGR",
      inputSchema: {
        type: "object",
        properties: {
          period: { type: "string", enum: ["1D", "1W", "1M", "QTD", "YTD", "1Y"], description: "Time period" },
        },
        required: ["period"],
      },
    },
    {
      name: "getPriceHistory",
      description: "Returns daily close price history for a ticker with period high/low",
      inputSchema: {
        type: "object",
        properties: {
          ticker: { type: "string" },
          days: { type: "number", description: "Number of calendar days (default 30)" },
        },
        required: ["ticker"],
      },
    },
    {
      name: "getTransactionHistory",
      description: "Returns transaction history from Airtable, optionally filtered by ticker or broker",
      inputSchema: {
        type: "object",
        properties: {
          ticker: { type: "string", description: "Filter by ticker symbol" },
          broker: { type: "string", description: "Filter by broker name" },
          limit: { type: "number", description: "Max records to return (default 20)" },
        },
        required: [],
      },
    },
    {
      name: "getPortfolioConcentration",
      description: "Returns portfolio breakdown by asset type, sector, and broker",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "searchPosition",
      description: "Finds a position by partial name or ticker (e.g. 'credicorp' → BAP, 'nvidia' → NVDA)",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string", description: "Ticker or partial name to search" } },
        required: ["query"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    switch (name) {
      case "getPortfolioSummary": {
        const result = await getPortfolioSummary(kubera, cache);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
      case "getDailyMovers": {
        const n = typeof args["n"] === "number" ? args["n"] : 5;
        const result = await getDailyMovers(kubera, yahoo, cache, n);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
      case "getPositionDetail": {
        const ticker = String(args["ticker"]);
        const result = await getPositionDetail(ticker, kubera, yahoo, cache);
        if (!result) return { content: [{ type: "text", text: JSON.stringify({ error: `Position not found: ${ticker}` }) }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
      case "getPortfolioPerformance": {
        const period = String(args["period"]) as Period;
        const validPeriods: Period[] = ["1D", "1W", "1M", "QTD", "YTD", "1Y"];
        if (!validPeriods.includes(period)) throw new Error(`Invalid period: ${period}. Must be one of ${validPeriods.join(", ")}`)
        const result = await getPortfolioPerformance(kubera, cache, period);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
      case "getPriceHistory": {
        const ticker = String(args["ticker"]);
        const days = typeof args["days"] === "number" ? args["days"] : 30;
        const result = await getPriceHistory(ticker, days, yahoo, cache);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
      case "getTransactionHistory": {
        const result = await getTransactionHistory(
          {
            ticker: args["ticker"] ? String(args["ticker"]) : undefined,
            broker: args["broker"] ? String(args["broker"]) : undefined,
            limit: typeof args["limit"] === "number" ? args["limit"] : 20,
          },
          airtable,
          cache
        );
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
      case "getPortfolioConcentration": {
        const result = await getPortfolioConcentration(kubera, cache);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
      case "searchPosition": {
        const query = String(args["query"]);
        const result = await searchPosition(query, kubera, yahoo, cache);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: JSON.stringify({ error: message }) }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
