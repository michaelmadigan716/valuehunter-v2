import Link from "next/link";
import { notFound } from "next/navigation";
import { StatTile } from "@/app/swing/_components/StatTile";
import { PositionsTable } from "@/app/swing/_components/PositionsTable";
import { allSymbols, computeStats, data, positionsForSymbol } from "@/app/swing/_lib/data";
import { money, pnl } from "@/app/swing/_lib/format";

export function generateStaticParams() {
  return allSymbols().map((symbol) => ({ symbol }));
}

export default async function TickerPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const sym = decodeURIComponent(symbol);
  const ps = positionsForSymbol(sym);
  if (!ps.length) notFound();
  const closed = ps.filter((p) => p.status === "closed" && p.basis_known);
  const s = computeStats(closed);
  const dividends = ps.reduce((a, p) => a + p.dividends, 0);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/swing/positions" className="text-sm text-accent hover:underline">← Positions</Link>
        <h1 className="text-2xl font-semibold tracking-tight mt-1">{sym}</h1>
        <p className="text-sm text-ink-2">{data.names[sym] ?? ""}</p>
      </div>
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile label="Realized P&L" value={pnl(s.realized)} tone={s.realized >= 0 ? "gain" : "loss"} sub={`${closed.length} closed round trips`} />
        <StatTile label="Win rate" value={closed.length ? `${(s.winRate * 100).toFixed(0)}%` : "—"} sub={`${s.wins} wins · ${s.losses} losses`} />
        <StatTile label="Total deployed" value={money(ps.reduce((a, p) => a + p.cost, 0))} sub="sum of all buys" />
        <StatTile label="Dividends" value={money(dividends, true)} />
      </section>
      <PositionsTable positions={ps} showFilters={false} initialSort="opened" />
    </div>
  );
}
