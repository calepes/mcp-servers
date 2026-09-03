// Shared types for all 8 tools

export type TransactionType =
  | "Compra"
  | "Venta"
  | "Utilidad"
  | "Split"
  | "Renta"
  | "Staking";

export type Period = "1D" | "1W" | "1M" | "QTD" | "YTD" | "1Y";

// Tool 1
export interface PortfolioSummary {
  totalValue: number;
  costBasis: number;
  totalGain: number;
  totalGainPct: number;
  unrealizedGain: number;
  cagrYTD: number;
  cashOnHand: number;
  positionCount: number;
  currency: "USD";
  asOf: string;
}

// Tool 2
export interface DailyMover {
  ticker: string;
  name: string;
  changePct: number;
  changeUSD: number;       // per share
  shares: number;
  totalChangeUSD: number;  // changeUSD * shares (portfolio impact)
  currentPrice: number;
  currency: string;
}

export interface DailyMovers {
  gainers: DailyMover[];
  losers: DailyMover[];
  marketDate: string;
  marketOpen: boolean;
}

// Tool 3
export interface PositionDetail {
  ticker: string;
  name: string;
  shares: number;
  currentPrice: number;
  avgCostBasis: number;
  totalCost: number;
  currentValue: number;
  gainLossUSD: number;
  gainLossPct: number;
  dayChangePct: number;
  dayChangeUSD: number;
  weight: number;
  broker: string;
  currency: string;
}

// Tool 4
export interface PortfolioPerformance {
  period: Period;
  startValue: number;
  endValue: number;
  deltaUSD: number;
  deltaPct: number;
  cagr: number | null;
}

// Tool 5
export interface PricePoint {
  date: string;
  close: number;
  changePct: number;
}

export interface PriceHistory {
  ticker: string;
  currency: string;
  history: PricePoint[];
  periodHigh: number;
  periodLow: number;
  periodChangePct: number;
}

// Tool 6
export interface Transaction {
  date: string;
  ticker: string;
  type: TransactionType;
  shares: number;
  pricePerShare: number;
  totalAmount: number;
  fee: number;
  broker: string;
  notes: string;
}

export interface TransactionHistory {
  transactions: Transaction[];
  total: number;
}

// Tool 7
export interface ConcentrationSlice {
  label: string;
  valuePct: number;
  valueUSD: number;
}

export interface PortfolioConcentration {
  byAssetType: ConcentrationSlice[];
  bySector: ConcentrationSlice[];
  byBroker: ConcentrationSlice[];
}

// Internal — Kubera position shape after parsing get_portfolio
export interface KuberaPosition {
  custodianId: string;
  ticker: string | null;
  name: string;
  value: number;
  costBasis: number;
  quantity: number;
  broker: string;
  assetType: string;
  sector: string;
  currency: string;
}

export interface KuberaPortfolio {
  totalValue: number;
  costBasis: number;
  unrealizedGain: number;
  cagrYTD: number;
  cashOnHand: number;
  positions: KuberaPosition[];
  asOf: string;
}

// Tool 13
export interface PortfolioGoal {
  year: number;
  goal: number;
  current: number;
  progressPct: number;
  remaining: number;
}

// Tool 14
export interface NewsItem {
  title: string;
  publisher: string;
  publishedAt: string;
  hoursAgo: number;
  link: string;
}

export interface TickerNews {
  ticker: string;
  name: string;
  changePct: number;
  currentPrice: number;
  currency: string;
  marketDate: string;
  windowDays: number;
  news: NewsItem[];
}

// Internal — Yahoo Finance quote shape
export interface YahooQuote {
  symbol: string;
  shortName: string;
  regularMarketPrice: number;
  regularMarketChangePercent: number;
  regularMarketChange: number;
  currency: string;
  regularMarketTime: number;
  marketState: string;
}
