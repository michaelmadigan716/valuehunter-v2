export type Account = "Brokerage" | "SEP-IRA";

export interface Exec {
  date: string;
  type: "Buy" | "Sell" | "Split" | "Transfer in" | "Transfer out" | "Reinvest" | "Sell cancel";
  qty: number;
  price: number | null;
  amount: number;
  pnl?: number | null;
  wash_adj?: number | null;
  note?: string;
}

export interface Position {
  id: string;
  account: Account;
  symbol: string;
  name: string;
  opened: string;
  closed: string | null;
  status: "open" | "closed";
  buys: number;
  sells: number;
  qty_bought: number;
  max_qty: number;
  cost: number;
  proceeds: number;
  fees: number;
  realized: number;
  tax_realized?: number;
  return_pct: number | null;
  days: number;
  basis_known: boolean;
  transferred_in?: boolean;
  category?: "trade" | "advisor";
  dividends: number;
  open_qty?: number;
  open_cost?: number;
  last_price?: number;
  market_value?: number;
  unrealized?: number;
  open_lots?: { date: string; qty: number; price: number }[];
  execs: Exec[];
}

export interface Execution {
  date: string;
  account: Account;
  symbol: string;
  type: "Buy" | "Sell";
  qty: number;
  price: number;
  fees: number;
  amount: number;
  category?: "trade" | "advisor";
  pnl?: number | null;
  tax_pnl?: number | null;
  wash_adj?: number | null;
  note?: string;
}

export interface VanguardTotals {
  investment_returns: number;
  market: number;
  income: number;
  flows: number;
  ending: number;
  since: string;
}

export interface Summary {
  realized: number;
  realized_closed: number;
  realized_open: number;
  taxable_realized: number;
  unrealized: number;
  vanguard_unrealized: number | null;
  wash_deferred: number | null;
  market_value: number;
  open_cost: number;
  income: number;
  fees: number;
  other: number;
  deposits: number;
  withdrawals: number;
  net_deposits: number;
  account_value: number;
  cash: number;
  ledger_cash: number;
  ledger_cash_by_account: Record<string, number>;
  prices_as_of: string;
  vanguard: VanguardTotals;
  components_total: number;
  realized_trades: number;
  advisor: { positions: number; value_in: number; proceeds: number; realized: number; transferred: string; liquidated: string };
}

export interface Cashflow {
  date: string;
  account: Account;
  type: string;
  amount: number;
  name: string;
}

export interface TaxYear {
  year: string;
  brk_taxable: number;
  st: number;
  lt: number;
  ny_base: number;
  est_federal: number;
  est_ny: number;
  est_total: number;
  ny_rate: number;
  note: string;
}

export interface TaxEstimate {
  years: TaxYear[];
  total: number;
  fed_st: number;
  fed_lt: number;
  assumptions: string[];
}

export interface TradeData {
  generated: string;
  as_of: string;
  first_date: string;
  accounts: Account[];
  summary: Summary;
  tax_estimate: TaxEstimate;
  positions: Position[];
  executions: Execution[];
  cashflows: Cashflow[];
  by_year: Record<string, { realized: number; taxable: number; disallowed: number; closed: number; wins: number; source: string; total_gain: number }>;
  by_symbol: Record<string, { realized: number; unrealized: number; total: number; trades: number; wins: number; losses: number; open: boolean; advisor: boolean }>;
  balance_history: { date: string; value: number; net_deposits: number; gain: number; month: string; market: number; income: number }[];
  names: Record<string, string>;
  warnings: string[];
}
