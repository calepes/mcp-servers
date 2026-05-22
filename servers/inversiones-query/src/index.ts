import { spawnSync } from "child_process";
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
    {
      name: "kuberaCashFlow",
      description: "Registers a cash flow entry in Kubera for IRR and cost basis tracking. Use cashIn for buys (money invested), cashOut for sells (money received) or cash debits. Always call this BEFORE kuberaUpdateShares.",
      inputSchema: {
        type: "object",
        properties: {
          custodianId: { type: "string", description: "Kubera custodian ID of the asset (use kuberaFindCustodian if unknown)" },
          date: { type: "string", description: "Date in YYYY-MM-DD format" },
          cashIn: { type: "number", description: "Total amount invested (buy). Include fees. 0 for sells." },
          cashOut: { type: "number", description: "Total amount received (sell). 0 for buys." },
          currency: { type: "string", description: "Currency code. Default: USD" },
          note: { type: "string", description: "Human-readable note, e.g. 'NU buy 41.25 @ $12.089 (Hapi)'" },
        },
        required: ["custodianId", "date", "cashIn", "cashOut"],
      },
    },
    {
      name: "kuberaUpdateShares",
      description: "Updates a Kubera portfolio item. For assets with a ticker: value = total shares (Kubera multiplies by market price automatically). For cash assets: value = USD balance. NEVER pass a USD amount for a ticker asset — it would show millions of shares.",
      inputSchema: {
        type: "object",
        properties: {
          custodianId: { type: "string", description: "Kubera custodian ID of the asset" },
          value: { type: "number", description: "New total shares (ticker assets) or USD balance (cash assets)" },
        },
        required: ["custodianId", "value"],
      },
    },
    {
      name: "kuberaFindCustodian",
      description: "Finds the custodianId for a given ticker or asset name in the Kubera Investments portfolio. Use when the custodianId is not known.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Ticker symbol or partial asset name (e.g. 'NU', 'SPY', 'cash')" },
        },
        required: ["query"],
      },
    },
    {
      name: "recordTransaction",
      description: "Records a buy or sell transaction in Airtable (Inversiones portfolio). Use dryRun:true first to preview the payload, then dryRun:false to write. fee is per-unit (not total).",
      inputSchema: {
        type: "object",
        properties: {
          side: { type: "string", enum: ["buy", "sell"], description: "Transaction side" },
          date: { type: "string", description: "Date in YYYY-MM-DD format" },
          ticker: { type: "string", description: "Ticker symbol (e.g. NU, SPY, NVDA)" },
          broker: { type: "string", description: "Broker name: 'Hapi', 'Interactive Brokers', 'Credicorp Capital'" },
          shares: { type: "number", description: "Number of shares (positive)" },
          price: { type: "number", description: "Price per share" },
          fee: { type: "number", description: "Fee per unit (not total). Default: 0" },
          tc: { type: "number", description: "Tipo de cambio / exchange rate (only for PEN transactions)" },
          notes: { type: "string", description: "Optional notes" },
          dryRun: { type: "boolean", description: "If true (default), preview only — no write. Set false to write to Airtable." },
        },
        required: ["side", "date", "ticker", "broker", "shares", "price"],
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
        const result = await getPortfolioPerformance(kubera, yahoo, cache, period);
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
      case "kuberaCashFlow": {
        const custodianId = String(args["custodianId"]);
        const date = String(args["date"]);
        const cashIn = Number(args["cashIn"]);
        const cashOut = Number(args["cashOut"]);
        const currency = args["currency"] ? String(args["currency"]) : "USD";
        const note = args["note"] ? String(args["note"]) : "";
        const result = await kubera.callTool("create_or_update_cash_flow", {
          custodianId, date, currency, cashIn, cashOut, ...(note ? { note } : {}),
        });
        return { content: [{ type: "text", text: KuberaClient.extractText(result) }] };
      }
      case "kuberaUpdateShares": {
        const custodianId = String(args["custodianId"]);
        const value = Number(args["value"]);
        const result = await kubera.callTool("update_portfolio_item", { custodianId, value });
        return { content: [{ type: "text", text: KuberaClient.extractText(result) }] };
      }
      case "kuberaFindCustodian": {
        const query = String(args["query"]).toLowerCase();
        const portfolioResult = await kubera.callTool("get_portfolio", {
          portfolioId: "6bccf4ba-e50d-442b-9f52-5cb3bc64523d",
        });
        const markdown = (() => {
          try {
            const parsed = JSON.parse(KuberaClient.extractText(portfolioResult)) as Record<string, unknown>;
            return String(parsed["markdown"] ?? "");
          } catch {
            return KuberaClient.extractText(portfolioResult);
          }
        })();
        // Extract rows that match query from the markdown table
        const matches = markdown
          .split("\n")
          .filter((line) => line.toLowerCase().includes(query))
          .slice(0, 10)
          .join("\n");
        return {
          content: [{
            type: "text",
            text: matches || `No assets found matching "${args["query"]}" in Investments portfolio`,
          }],
        };
      }
      case "recordTransaction": {
        const side = String(args["side"]);
        const date = String(args["date"]);
        const ticker = String(args["ticker"]);
        const broker = String(args["broker"]);
        const shares = Number(args["shares"]);
        const price = Number(args["price"]);
        const fee = typeof args["fee"] === "number" ? args["fee"] : 0;
        const tc = typeof args["tc"] === "number" ? args["tc"] : null;
        const notes = args["notes"] ? String(args["notes"]) : "";
        const dryRun = args["dryRun"] !== false;

        const INVERSIONES_DIR = "/Users/calepes/Claude Projects/Personal/Agents/Inversiones";
        const pythonBin = `${INVERSIONES_DIR}/.venv/bin/python`;

        const spawnArgs = ["-m", "inversiones.cli", "record", side,
          "--date", date, "--ticker", ticker, "--broker", broker,
          "--shares", String(shares), "--price", String(price)];
        if (fee > 0) spawnArgs.push("--fee", String(fee));
        if (tc !== null) spawnArgs.push("--tc", String(tc));
        if (notes) spawnArgs.push("--notes", notes);
        if (!dryRun) spawnArgs.push("--yes");

        const proc = spawnSync(pythonBin, spawnArgs, {
          cwd: INVERSIONES_DIR,
          env: { ...process.env, PYTHONPATH: "src" },
          encoding: "utf8",
          timeout: 30000,
        });

        if (proc.error) throw proc.error;
        if (proc.status !== 0) {
          return {
            content: [{ type: "text", text: (proc.stderr || proc.stdout || "Unknown error").trim() }],
            isError: true,
          };
        }
        return { content: [{ type: "text", text: (proc.stdout || "").trim() }] };
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
