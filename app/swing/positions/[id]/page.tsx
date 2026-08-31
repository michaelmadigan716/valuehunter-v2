import Link from "next/link";
import { notFound } from "next/navigation";
import { StatTile } from "@/app/swing/_components/StatTile";
import { data, positionById, positionsForSymbol } from "@/app/swing/_lib/data";
import { days, money, pct, pnl, pnlClass, price, shares } from "@/app/swing/_lib/format";

export function generateStaticParams() {
  return data.positions.map((p) => ({ id: p.id }));
}

export default async function PositionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = positionById(id);
  if (!p) notFound();
  const siblings = positionsForSymbol(p.symbol).filter((x) => x.id !== p.id);
  const avgBuy = p.qty_bought ? p.cost / p.qty_bought : 0;
  const soldQty = p.execs.filter((e) => e.type === "Sell").reduce((a, e) => a - e.qty, 0);
  const avgSell = soldQty ? p.proceeds / soldQty : 0;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/swing/positions" className="text-sm text-accent hover:underline">← Positions</Link>
        <div className="flex flex-wrap items-baseline gap-x-3 mt-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            <Link href={`/swing/tickers/${encodeURIComponent(p.symbol)}`} className="hover:underline">{p.symbol}</Link>
          </h1>
          <span className="text-ink-2">{p.name}</span>
          <span className="chip">{p.account}</span>
          {p.status === "open" ? (
            <span className="chip chip-open">Open</span>
          ) : !p.basis_known ? (
            <span className="chip">Transferred in</span>
          ) : p.realized > 0 ? (
            <span className="chip chip-gain">Win</span>
          ) : (
            <span className="chip chip-loss">Loss</span>
          )}
        </div>
        <p className="text-sm text-ink-2 mt-1">
          {p.opened} → {p.closed ?? "still open"} · held {days(p.days)} · {p.buys} buys, {p.sells} sells
        </p>
      </div>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile
          label={p.status === "open" ? "Realized so far" : "Realized P&L"}
          value={pnl(p.realized)}
          tone={p.realized >= 0 ? "gain" : "loss"}
          sub={`${p.return_pct !== null ? `${pct(p.return_pct)} on cost` : ""}${p.tax_realized !== undefined && Math.abs(p.tax_realized - p.realized) > 1 ? ` · taxable ${pnl(p.tax_realized)}` : ""}`}
        />
        <StatTile label="Total cost" value={money(p.cost)} sub={`${shares(p.qty_bought)} sh @ ${price(avgBuy)} avg`} />
        <StatTile label="Total proceeds" value={money(p.proceeds)} sub={soldQty ? `${shares(soldQty)} sh @ ${price(avgSell)} avg` : "no sells yet"} />
        {p.status === "open" ? (
          <StatTile
            label="Still held"
            value={p.unrealized !== undefined ? pnl(p.unrealized) : `${shares(p.open_qty ?? 0)} sh`}
            tone={p.unrealized === undefined ? "neutral" : p.unrealized >= 0 ? "gain" : "loss"}
            sub={`${shares(p.open_qty ?? 0)} sh · basis ${money(p.open_cost)}${p.market_value !== undefined ? ` · now ${money(p.market_value)}` : ""}`}
          />
        ) : (
          <StatTile label="Peak size" value={`${shares(p.max_qty)} sh`} sub={`fees ${money(p.fees, true)}${p.dividends ? ` · dividends ${money(p.dividends, true)}` : ""}`} />
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Executions</h2>
        <div className="card overflow-x-auto">
          <table className="data">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th className="num">Shares</th>
                <th className="num">Price</th>
                <th className="num">Amount</th>
                <th className="num">Realized</th>
                <th className="num">Running shares</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                let run = 0;
                return p.execs.map((e, i) => {
                  if (e.type === "Split") run += e.qty;
                  else run += e.qty;
                  const tone = e.type === "Buy" || e.type === "Reinvest" || e.type === "Transfer in" ? "text-accent" : e.type === "Sell" ? "text-ink" : "text-muted";
                  return (
                    <tr key={i}>
                      <td className="tnum">{e.date}</td>
                      <td className={tone}>
                        {e.type}
                        {e.note && <span className="text-muted"> ({e.note})</span>}
                      </td>
                      <td className="num">{e.qty < 0 ? `−${shares(e.qty)}` : shares(e.qty)}</td>
                      <td className="num">{price(e.price)}</td>
                      <td className={`num ${e.amount > 0 ? "" : "text-ink-2"}`}>{e.amount ? money(e.amount, true) : "—"}</td>
                      <td className={`num ${pnlClass(e.pnl)}`}>
                        {e.pnl !== undefined && e.pnl !== null ? pnl(e.pnl, true) : ""}
                        {e.wash_adj ? <div className="text-xs text-muted" title="Vanguard's taxable figure for this sale differs by this wash-sale basis adjustment">tax basis adj {pnl(e.wash_adj, true)}</div> : null}
                      </td>
                      <td className="num text-ink-2">{shares(Math.max(0, Math.round(run * 1000) / 1000))}</td>
                    </tr>
                  );
                });
              })()}
            </tbody>
          </table>
        </div>
      </section>

      {siblings.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-medium">Other {p.symbol} positions</h2>
          <div className="card overflow-x-auto">
            <table className="data">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Opened</th>
                  <th>Closed</th>
                  <th className="num">Cost</th>
                  <th className="num">Realized</th>
                  <th className="num">Return</th>
                </tr>
              </thead>
              <tbody>
                {siblings.map((s) => (
                  <tr key={s.id}>
                    <td><Link href={`/swing/positions/${s.id}`} className="hover:underline">{s.account}</Link></td>
                    <td className="tnum">{s.opened}</td>
                    <td className="tnum">{s.closed ?? "open"}</td>
                    <td className="num">{money(s.cost)}</td>
                    <td className={`num ${pnlClass(s.realized)}`}>{s.basis_known ? pnl(s.realized) : "n/a"}</td>
                    <td className={`num ${pnlClass(s.return_pct)}`}>{pct(s.return_pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
