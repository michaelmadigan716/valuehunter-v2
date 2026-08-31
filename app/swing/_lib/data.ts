import raw from "@/app/swing/_data/trades.json";
import type { TradeData, Position } from "./types";

export const data = raw as unknown as TradeData;

/** Closed round-trips with a known cost basis — the only ones that count toward P&L stats. */
export const closedPositions: Position[] = data.positions.filter(
  (p) => p.status === "closed" && p.basis_known && p.category !== "advisor",
);
/** Holdings that arrived from the former financial advisor's account in March 2020 and were liquidated — not Matt's trades. */
export const advisorPositions: Position[] = data.positions.filter((p) => p.category === "advisor");
export const tradePositions: Position[] = data.positions.filter((p) => p.category !== "advisor");
export const openPositions: Position[] = data.positions.filter(
  (p) => p.status === "open" && (p.open_qty ?? 0) >= 1,
);


export function parseDate(s: string): Date {
  const [m, d, y] = s.split("/").map(Number);
  return new Date(y, m - 1, d);
}
export function isoDate(s: string): string {
  const [m, d, y] = s.split("/");
  return `${y}-${m}-${d}`;
}
export function yearOf(s: string): string {
  return s.slice(-4);
}

export function positionById(id: string): Position | undefined {
  return data.positions.find((p) => p.id === id);
}
export function positionsForSymbol(symbol: string): Position[] {
  return data.positions.filter((p) => p.symbol === symbol);
}
export function allSymbols(): string[] {
  return Array.from(new Set(data.positions.map((p) => p.symbol))).sort();
}

export interface Stats {
  realized: number;
  closed: number;
  wins: number;
  losses: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  avgDays: number;
  medianDays: number;
  profitFactor: number;
  grossWins: number;
  grossLosses: number;
  best: Position | null;
  worst: Position | null;
  fees: number;
  dividends: number;
}

export function computeStats(ps: Position[]): Stats {
  const wins = ps.filter((p) => p.realized > 0);
  const losses = ps.filter((p) => p.realized <= 0);
  const grossWins = wins.reduce((a, p) => a + p.realized, 0);
  const grossLosses = -losses.reduce((a, p) => a + p.realized, 0);
  const days = ps.map((p) => p.days).sort((a, b) => a - b);
  const sorted = [...ps].sort((a, b) => a.realized - b.realized);
  return {
    realized: ps.reduce((a, p) => a + p.realized, 0),
    closed: ps.length,
    wins: wins.length,
    losses: losses.length,
    winRate: ps.length ? wins.length / ps.length : 0,
    avgWin: wins.length ? grossWins / wins.length : 0,
    avgLoss: losses.length ? grossLosses / losses.length : 0,
    avgDays: days.length ? days.reduce((a, b) => a + b, 0) / days.length : 0,
    medianDays: days.length ? days[Math.floor(days.length / 2)] : 0,
    profitFactor: grossLosses ? grossWins / grossLosses : Infinity,
    grossWins,
    grossLosses,
    best: sorted[sorted.length - 1] ?? null,
    worst: sorted[0] ?? null,
    fees: ps.reduce((a, p) => a + p.fees, 0),
    dividends: data.summary.income,
  };
}

/** Cumulative realized P&L over time from every sell execution (partial sells included), one point per day. */
export function cumulativeSeries(): { date: string; cum: number; pnl: number; symbol: string }[] {
  const sells = data.executions.filter((e) => e.type === "Sell" && e.pnl !== null && e.pnl !== undefined);
  const byDay = new Map<string, { pnl: number; symbols: Set<string> }>();
  for (const e of sells) {
    const d = isoDate(e.date);
    const cur = byDay.get(d) ?? { pnl: 0, symbols: new Set<string>() };
    cur.pnl += e.pnl!; cur.symbols.add(e.symbol); byDay.set(d, cur);
  }
  let cum = 0;
  return Array.from(byDay.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, v]) => { cum += v.pnl; return { date, cum: Math.round(cum), pnl: v.pnl, symbol: Array.from(v.symbols).join(", ") }; });
}
