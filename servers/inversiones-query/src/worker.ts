import { handleMcp, type McpTool, type McpEnv } from 'worker-mcp-utils';
import { Cache } from './cache.js';
import { KuberaClient } from './clients/kubera.js';
import { YahooClient } from './clients/yahoo.js';
import { AirtableClient } from './clients/airtable.js';
import { getPortfolioSummary, getPortfolioConcentration, getPortfolioPerformance } from './tools/portfolio.js';
import { getDailyMovers } from './tools/movers.js';
import { getTickerNews } from './tools/news.js';
import { getPositionDetail, searchPosition } from './tools/position.js';
import { getPriceHistory } from './tools/prices.js';
import { getTransactionHistory } from './tools/transactions.js';
import { getPortfolioGoal } from './tools/goal.js';
import type { Period } from './types.js';

interface Env extends McpEnv {
  KUBERA_AUTH_TOKEN: string;
  AIRTABLE_TOKEN: string;
  AIRTABLE_BASE_ID: string;
}

const TOOLS: McpTool[] = [
  {
    name: 'getPortfolioSummary',
    description: 'Returns total portfolio value, cost basis, P&L, CAGR YTD, and cash on hand',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'getDailyMovers',
    description: 'Returns top N daily gainers and losers from the portfolio using Yahoo Finance',
    inputSchema: {
      type: 'object',
      properties: { n: { type: 'number', description: 'Number of movers to return (default 5)' } },
      required: [],
    },
  },
  {
    name: 'getTickerNews',
    description: 'Explains WHY a ticker moved: returns its current price change together with recent news headlines (publisher + how many hours ago). Use this whenever asked why a stock rose or fell — never answer that from prior knowledge. Headlines come from a search index and often include unrelated stories: only cite one if it actually names the company, and if none does, say the news does not explain the move rather than forcing a link.',
    inputSchema: {
      type: 'object',
      properties: {
        ticker: { type: 'string', description: 'Ticker symbol (e.g. NU, NVDA)' },
        days: { type: 'number', description: 'How many days back to look for news (default 3)' },
        limit: { type: 'number', description: 'Max headlines to return (default 8)' },
      },
      required: ['ticker'],
    },
  },
  {
    name: 'getPositionDetail',
    description: 'Returns detailed info for a single position: shares, cost basis, P&L, daily change, weight',
    inputSchema: {
      type: 'object',
      properties: { ticker: { type: 'string', description: 'Ticker symbol (e.g. SPY, NVDA)' } },
      required: ['ticker'],
    },
  },
  {
    name: 'getPortfolioPerformance',
    description: 'Returns portfolio performance for a given period: value change and CAGR',
    inputSchema: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['1D', '1W', '1M', 'QTD', 'YTD', '1Y'], description: 'Time period' },
      },
      required: ['period'],
    },
  },
  {
    name: 'getPriceHistory',
    description: 'Returns daily close price history for a ticker with period high/low',
    inputSchema: {
      type: 'object',
      properties: {
        ticker: { type: 'string' },
        days: { type: 'number', description: 'Number of calendar days (default 30)' },
      },
      required: ['ticker'],
    },
  },
  {
    name: 'getTransactionHistory',
    description: 'Returns transaction history from Airtable, optionally filtered by ticker or broker',
    inputSchema: {
      type: 'object',
      properties: {
        ticker: { type: 'string', description: 'Filter by ticker symbol' },
        broker: { type: 'string', description: 'Filter by broker name' },
        limit: { type: 'number', description: 'Max records to return (default 20)' },
      },
      required: [],
    },
  },
  {
    name: 'getPortfolioConcentration',
    description: 'Returns portfolio breakdown by asset type, sector, and broker',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'searchPosition',
    description: "Finds a position by partial name or ticker (e.g. 'credicorp' → BAP, 'nvidia' → NVDA)",
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Ticker or partial name to search' } },
      required: ['query'],
    },
  },
  {
    name: 'kuberaCashFlow',
    description: 'Registers a cash flow entry in Kubera for IRR and cost basis tracking. Use cashIn for buys (money invested), cashOut for sells (money received) or cash debits. Always call this BEFORE kuberaUpdateShares.',
    inputSchema: {
      type: 'object',
      properties: {
        custodianId: { type: 'string', description: 'Kubera custodian ID of the asset (use kuberaFindCustodian if unknown)' },
        date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
        cashIn: { type: 'number', description: 'Total amount invested (buy). Include fees. 0 for sells.' },
        cashOut: { type: 'number', description: 'Total amount received (sell). 0 for buys.' },
        currency: { type: 'string', description: 'Currency code. Default: USD' },
        note: { type: 'string', description: "Human-readable note, e.g. 'NU buy 41.25 @ $12.089 (Hapi)'" },
      },
      required: ['custodianId', 'date', 'cashIn', 'cashOut'],
    },
  },
  {
    name: 'kuberaUpdateShares',
    description: 'Updates a Kubera portfolio item. For assets with a ticker: value = total shares (Kubera multiplies by market price automatically). For cash assets: value = USD balance. NEVER pass a USD amount for a ticker asset — it would show millions of shares.',
    inputSchema: {
      type: 'object',
      properties: {
        custodianId: { type: 'string', description: 'Kubera custodian ID of the asset' },
        value: { type: 'number', description: 'New total shares (ticker assets) or USD balance (cash assets)' },
      },
      required: ['custodianId', 'value'],
    },
  },
  {
    name: 'kuberaFindCustodian',
    description: 'Finds the custodianId for a given ticker or asset name in the Kubera Investments portfolio. Use when the custodianId is not known.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: "Ticker symbol or partial asset name (e.g. 'NU', 'SPY', 'cash')" },
      },
      required: ['query'],
    },
  },
  {
    name: 'recordTransaction',
    description: 'Records a buy or sell transaction in Airtable (Inversiones portfolio). Use dryRun:true first to preview the payload, then dryRun:false to write. fee is per-unit (not total).',
    inputSchema: {
      type: 'object',
      properties: {
        side: { type: 'string', enum: ['buy', 'sell'], description: 'Transaction side' },
        date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
        ticker: { type: 'string', description: 'Ticker symbol (e.g. NU, SPY, NVDA)' },
        broker: { type: 'string', description: 'Broker name: Hapi, Interactive Brokers, Credicorp Capital' },
        shares: { type: 'number', description: 'Number of shares (positive)' },
        price: { type: 'number', description: 'Price per share' },
        fee: { type: 'number', description: 'Fee per unit (not total). Default: 0' },
        tc: { type: 'number', description: 'Tipo de cambio / exchange rate (only for PEN transactions)' },
        notes: { type: 'string', description: 'Optional notes' },
        dryRun: { type: 'boolean', description: 'If true (default), preview only — no write. Set false to write to Airtable.' },
      },
      required: ['side', 'date', 'ticker', 'broker', 'shares', 'price'],
    },
  },
  {
    name: 'getPortfolioGoal',
    description: 'Returns progress toward the annual investment goal (Meta {year} field in Airtable Tracking Portfolio): current value, goal, remaining amount, and progress %.',
    inputSchema: {
      type: 'object',
      properties: { year: { type: 'number', description: 'Goal year, e.g. 2026' } },
      required: ['year'],
    },
  },
];

const PORTFOLIO_ID = '6bccf4ba-e50d-442b-9f52-5cb3bc64523d';

async function dispatchTool(name: string, args: unknown, env: Record<string, unknown>): Promise<unknown> {
  const e = env as unknown as Env;
  const cache = new Cache();
  const kubera = new KuberaClient(e.KUBERA_AUTH_TOKEN);
  const yahoo = new YahooClient();
  const airtable = new AirtableClient(e.AIRTABLE_TOKEN, e.AIRTABLE_BASE_ID);
  const a = (args ?? {}) as Record<string, unknown>;

  switch (name) {
    case 'getPortfolioSummary':
      return getPortfolioSummary(kubera, cache);

    case 'getDailyMovers':
      return getDailyMovers(kubera, yahoo, cache, (a['n'] as number) ?? 5);

    case 'getTickerNews':
      return getTickerNews(a['ticker'] as string, yahoo, cache, a['days'] as number | undefined, a['limit'] as number | undefined);

    case 'getPositionDetail':
      return getPositionDetail(a['ticker'] as string, kubera, yahoo, cache);

    case 'searchPosition':
      return searchPosition(a['query'] as string, kubera, yahoo, cache);

    case 'getPriceHistory':
      return getPriceHistory(a['ticker'] as string, (a['days'] as number) ?? 30, yahoo, cache);

    case 'getTransactionHistory':
      return getTransactionHistory(
        {
          ticker: a['ticker'] ? String(a['ticker']) : undefined,
          broker: a['broker'] ? String(a['broker']) : undefined,
          limit: typeof a['limit'] === 'number' ? a['limit'] : 20,
        },
        airtable,
        cache,
      );

    case 'getPortfolioConcentration':
      return getPortfolioConcentration(kubera, cache);

    case 'getPortfolioPerformance': {
      const period = String(a['period']) as Period;
      const validPeriods: Period[] = ['1D', '1W', '1M', 'QTD', 'YTD', '1Y'];
      if (!validPeriods.includes(period)) throw new Error(`Invalid period: ${period}. Must be one of ${validPeriods.join(', ')}`);
      return getPortfolioPerformance(kubera, yahoo, cache, period);
    }

    case 'kuberaCashFlow': {
      const custodianId = String(a['custodianId']);
      const date = String(a['date']);
      const cashIn = Number(a['cashIn']);
      const cashOut = Number(a['cashOut']);
      const currency = a['currency'] ? String(a['currency']) : 'USD';
      const note = a['note'] ? String(a['note']) : '';
      const result = await kubera.callTool('create_or_update_cash_flow', {
        custodianId, date, currency, cashIn, cashOut, ...(note ? { note } : {}),
      });
      return KuberaClient.extractText(result);
    }

    case 'kuberaUpdateShares': {
      const custodianId = String(a['custodianId']);
      const value = Number(a['value']);
      const result = await kubera.callTool('update_portfolio_item', { custodianId, value });
      return KuberaClient.extractText(result);
    }

    case 'kuberaFindCustodian': {
      const query = String(a['query']).toLowerCase();
      const portfolioResult = await kubera.callTool('get_portfolio', { portfolioId: PORTFOLIO_ID });
      const markdown = (() => {
        try {
          const parsed = JSON.parse(KuberaClient.extractText(portfolioResult)) as Record<string, unknown>;
          return String(parsed['markdown'] ?? '');
        } catch {
          return KuberaClient.extractText(portfolioResult);
        }
      })();
      const matches = markdown
        .split('\n')
        .filter((line) => line.toLowerCase().includes(query))
        .slice(0, 10)
        .join('\n');
      return matches || `No assets found matching "${a['query']}" in Investments portfolio`;
    }

    case 'recordTransaction':
      throw new Error('recordTransaction is not supported in the CF Worker — use the local stdio MCP (mcp-inversiones-query) instead');

    case 'getPortfolioGoal':
      return getPortfolioGoal(kubera, airtable, cache, Number(a['year']));

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    return handleMcp(req, env, TOOLS, 'inversiones-query', dispatchTool);
  },
} satisfies ExportedHandler<Env>;
