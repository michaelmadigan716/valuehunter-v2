"use client";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useState } from "react";
import { compact, money, pnl } from "@/app/swing/_lib/format";

const axisStyle = { fontSize: 12, fill: "var(--text-3)" };

type YearRow = { year: string; realized: number; taxable: number; disallowed: number; closed: number; wins: number; total_gain: number };

/** P&L per year: Vanguard's investment returns for the year (realized + unrealized change + income) next to realized. */
export function PnlByYear({ rows }: { rows: YearRow[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={rows} margin={{ top: 8, right: 8, left: 8, bottom: 0 }} barCategoryGap="25%" barGap={2}>
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis dataKey="year" tick={axisStyle} axisLine={{ stroke: "var(--border)" }} tickLine={false} />
        <YAxis tick={axisStyle} axisLine={false} tickLine={false} tickFormatter={(v) => compact(v)} width={64} />
        <ReferenceLine y={0} stroke="var(--text-3)" />
        <Tooltip
          cursor={{ fill: "var(--surface-3)" }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const r = payload[0].payload as YearRow;
            return (
              <div className="viz-tip">
                <div className="font-medium">{r.year}</div>
                <div>
                  Total gain <span className={r.total_gain >= 0 ? "text-gain" : "text-loss"}>{pnl(r.total_gain)}</span>
                </div>
                <div className="text-ink-2">
                  Realized <span className={r.realized >= 0 ? "text-gain" : "text-loss"}>{pnl(r.realized)}</span> · taxable per Vanguard {pnl(r.taxable)}
                </div>
                <div className="text-ink-2">{r.closed} closed · {r.wins} winners{r.disallowed ? ` · ${money(r.disallowed)} wash-sale disallowed` : ""}</div>
              </div>
            );
          }}
        />
        <Bar dataKey="total_gain" name="Total gain" radius={[4, 4, 0, 0]} fill="var(--series-1)" isAnimationActive={false} />
        <Bar dataKey="realized" name="Realized" radius={[4, 4, 0, 0]} fill="var(--series-2)" isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

type CumRow = { date: string; cum: number; pnl: number; symbol: string };

/** Cumulative realized P&L, one point per position close. */
export function CumulativePnl({ rows }: { rows: CumRow[] }) {
  const data = rows.map((r) => ({ ...r, t: Date.parse(r.date) }));
  const y0 = Number(rows[0]?.date.slice(0, 4) ?? 2019);
  const y1 = Number(rows[rows.length - 1]?.date.slice(0, 4) ?? 2026);
  const ticks: number[] = [];
  for (let y = y0; y <= y1 + 1; y++) ticks.push(Date.UTC(y, 0, 1));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis
          dataKey="t"
          type="number"
          domain={[ticks[0], ticks[ticks.length - 1]]}
          ticks={ticks}
          tick={axisStyle}
          axisLine={{ stroke: "var(--border)" }}
          tickLine={false}
          tickFormatter={(t: number) => String(new Date(t).getUTCFullYear())}
        />
        <YAxis tick={axisStyle} axisLine={false} tickLine={false} tickFormatter={(v) => compact(v)} width={64} />
        <ReferenceLine y={0} stroke="var(--text-3)" />
        <Tooltip
          cursor={{ stroke: "var(--text-3)", strokeDasharray: "3 3" }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const r = payload[0].payload as CumRow;
            return (
              <div className="viz-tip">
                <div className="font-medium">{r.date}</div>
                <div>
                  Cumulative <span className="tnum">{money(r.cum)}</span>
                </div>
                <div className="text-ink-2">
                  {r.symbol}: <span className={r.pnl >= 0 ? "text-gain" : "text-loss"}>{pnl(r.pnl)}</span>
                </div>
              </div>
            );
          }}
        />
        <Line
          type="stepAfter"
          dataKey="cum"
          stroke="var(--series-1)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 5, stroke: "var(--surface)", strokeWidth: 2 }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

type SymRow = { symbol: string; realized: number; unrealized: number; total: number; trades: number; open: boolean };

/** Horizontal bars: total P&L by ticker (realized + unrealized), expandable to the full list. */
export function PnlBySymbol({ rows, initial = 8, expandLabel, domain }: { rows: SymRow[]; initial?: number; expandLabel: string; domain?: [number, number] }) {
  const [expanded, setExpanded] = useState(false);
  const [shared, setShared] = useState(true);   // shared scale with the sibling chart by default; toggle for per-chart auto
  const shown = expanded ? rows : rows.slice(0, initial);
  const h = Math.max(160, shown.length * 26 + 20);
  return (
    <div className="space-y-2">
      <ResponsiveContainer width="100%" height={h}>
        <BarChart data={shown} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }} barCategoryGap="25%">
          <CartesianGrid horizontal={false} stroke="var(--grid)" />
          <XAxis type="number" domain={shared && domain ? domain : ["auto", "auto"]} tick={axisStyle} axisLine={false} tickLine={false} tickFormatter={(v) => compact(v)} allowDataOverflow />
          <YAxis type="category" dataKey="symbol" tick={{ ...axisStyle, fill: "var(--text-2)" }} axisLine={false} tickLine={false} width={80} />
          <ReferenceLine x={0} stroke="var(--text-3)" />
          <Tooltip
            cursor={{ fill: "var(--surface-3)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const r = payload[0].payload as SymRow;
              return (
                <div className="viz-tip">
                  <div className="font-medium">{r.symbol}</div>
                  <div className={r.total >= 0 ? "text-gain" : "text-loss"}>{pnl(r.total)} total</div>
                  <div className="text-ink-2">{pnl(r.realized)} realized{r.open ? ` · ${pnl(r.unrealized)} unrealized` : ""}</div>
                  <div className="text-ink-2">{r.trades} closed round trips{r.open ? " · still open" : ""}</div>
                </div>
              );
            }}
          />
          <Bar dataKey="total" radius={[0, 4, 4, 0]} isAnimationActive={false}>
            {shown.map((r) => (
              <Cell key={r.symbol} fill={r.total >= 0 ? "var(--gain)" : "var(--loss)"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="flex items-center gap-2">
        {rows.length > initial && (
          <button className="chip" onClick={() => setExpanded(!expanded)}>
            {expanded ? "Show top " + initial : expandLabel}
          </button>
        )}
        {domain && (
          <button
            className="chip"
            onClick={() => setShared(!shared)}
            title={shared ? "Bars are comparable across the winners and losers charts" : "Each chart stretches to its own biggest bar"}
          >
            Scale: {shared ? "shared" : "auto"}
          </button>
        )}
      </div>
    </div>
  );
}

type GainRow = { date: string; value: number; net_deposits: number; gain: number; month: string; market: number; income: number };

/** Total gain over time = account value − cumulative net money in, from Vanguard balance history. */
export function TotalGainOverTime({ rows, realized }: { rows: GainRow[]; realized: CumRow[] }) {
  const data = rows.map((r) => ({ ...r, t: Date.parse(r.date) }));
  const y0 = Number(rows[0]?.date.slice(0, 4) ?? 2019);
  const y1 = Number(rows[rows.length - 1]?.date.slice(0, 4) ?? 2026);
  const ticks: number[] = [];
  for (let y = y0; y <= y1 + 1; y++) ticks.push(Date.UTC(y, 0, 1));
  // realized series resampled onto the same timeline (step)
  const realizedAt = (t: number) => {
    let v = 0;
    for (const r of realized) { if (Date.parse(r.date) <= t) v = r.cum; else break; }
    return v;
  };
  const merged = data.map((d) => ({ ...d, realized: realizedAt(d.t) }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={merged} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis dataKey="t" type="number" domain={[ticks[0], ticks[ticks.length - 1]]} ticks={ticks} tick={axisStyle} axisLine={{ stroke: "var(--border)" }} tickLine={false} tickFormatter={(t: number) => String(new Date(t).getUTCFullYear())} />
        <YAxis tick={axisStyle} axisLine={false} tickLine={false} tickFormatter={(v) => compact(v)} width={64} />
        <ReferenceLine y={0} stroke="var(--text-3)" />
        <Tooltip
          cursor={{ stroke: "var(--text-3)", strokeDasharray: "3 3" }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const r = payload[0].payload as GainRow & { realized: number };
            return (
              <div className="viz-tip">
                <div className="font-medium">End of {r.month}</div>
                <div>Cumulative investment returns <span className={r.gain >= 0 ? "text-gain" : "text-loss"}>{pnl(r.gain)}</span></div>
                <div className="text-ink-2">This month: {pnl(r.market + r.income)} · realized to date {pnl(r.realized)}</div>
                <div className="text-ink-2">Balance {money(r.value)} · net money in {money(r.net_deposits)}</div>
              </div>
            );
          }}
        />
        <Line type="monotone" dataKey="gain" name="Total gain" stroke="var(--series-1)" strokeWidth={2} dot={false} activeDot={{ r: 5, stroke: "var(--surface)", strokeWidth: 2 }} isAnimationActive={false} />
        <Line type="stepAfter" dataKey="realized" name="Realized" stroke="var(--series-2)" strokeWidth={2} dot={false} activeDot={{ r: 5, stroke: "var(--surface)", strokeWidth: 2 }} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
