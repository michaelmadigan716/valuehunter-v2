import { PositionsTable } from "@/app/swing/_components/PositionsTable";
import { advisorPositions, data, tradePositions } from "@/app/swing/_lib/data";
import { money, pnl, pnlClass } from "@/app/swing/_lib/format";

export default function PositionsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Positions</h1>
        <p className="text-sm text-ink-2 mt-1">
          Every round trip: a position opens on the first buy from flat and closes when the share count returns to zero.
          Partial sells along the way are included in that position&apos;s realized P&amp;L.
        </p>
      </div>
      <PositionsTable positions={tradePositions} />
      <p className="text-xs text-muted">
        Realized P&amp;L uses the lots Vanguard assigned to each sale (2020 onward) at their original purchase cost; 2019 sales are matched
        first-in-first-out.
      </p>
      <section className="space-y-2 pt-4">
        <h2 className="font-medium">
          Former advisor&apos;s holdings{" "}
          <span className="text-xs text-muted font-normal">
            transferred in {data.summary.advisor.transferred}, liquidated {data.summary.advisor.liquidated} — not trades, kept separate
          </span>
        </h2>
        <p className="text-sm text-ink-2">
          {advisorPositions.length} mutual-fund and ETF positions arrived from the previous financial advisor&apos;s account and were sold within
          three weeks: {money(data.summary.advisor.value_in)} of value in, {money(data.summary.advisor.proceeds)} out,{" "}
          <span className={pnlClass(data.summary.advisor.realized)}>{pnl(data.summary.advisor.realized)}</span> net. They are included in the
          account totals but excluded from win-rate and ticker statistics.
        </p>
        <PositionsTable positions={advisorPositions} showFilters={false} initialSort="closed" />
      </section>
    </div>
  );
}
