import Link from "next/link";
import { StatTile } from "@/app/swing/_components/StatTile";
import { PnlBySymbol, PnlByYear, TotalGainOverTime } from "@/app/swing/_components/Charts";
import { PositionsTable } from "@/app/swing/_components/PositionsTable";
import { closedPositions, computeStats, cumulativeSeries, data, openPositions, parseDate } from "@/app/swing/_lib/data";
import { days, money, pct, pnl, pnlClass, shares } from "@/app/swing/_lib/format";

export default function Overview() {
  const sm = data.summary;
  const vg = sm.vanguard;
  const stats = computeStats(closedPositions);
  const yearRows = Object.entries(data.by_year).map(([year, v]) => ({ year, ...v }));
  const cum = cumulativeSeries();
  const bySym = Object.entries(data.by_symbol)
    .filter(([, v]) => !v.advisor)
    .map(([symbol, v]) => ({ symbol, ...v }))
    .sort((a, b) => b.total - a.total);
  const winners = bySym.filter((r) => r.total > 0);
  const losers = bySym.filter((r) => r.total < 0).reverse();
  // one shared scale for both charts, so bar lengths are comparable across winners and losers;
  // capped tight: $100K above the biggest ticker either way
  const tickerScale = Math.max(...bySym.map((r) => Math.abs(r.total))) + 100_000;
  const withTotal = (p: (typeof data.positions)[number]) => p.realized + (p.unrealized ?? 0);
  const allByTotal = [...data.positions].filter((p) => p.category !== "advisor").sort((a, b) => withTotal(b) - withTotal(a));
  const bestOverall = allByTotal[0];
  const worstOverall = allByTotal[allByTotal.length - 1];
  const recentlyClosed = [...closedPositions]
    .sort((a, b) => parseDate(b.closed!).getTime() - parseDate(a.closed!).getTime())
    .slice(0, 12);
  const multiple = vg.flows ? vg.investment_returns / vg.flows : 0;

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Trading record</h1>
        <p className="text-sm text-ink-2 mt-1">
          Vanguard Brokerage + SEP-IRA · {data.first_date} to {data.as_of} · {data.executions.length.toLocaleString()} executions across{" "}
          {data.positions.length} positions · reconciled to Vanguard&apos;s performance and cost-basis records
        </p>
      </section>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile
          label="Investment returns (Vanguard)"
          value={pnl(vg.investment_returns)}
          tone={vg.investment_returns >= 0 ? "gain" : "loss"}
          sub={`${money(vg.flows)} net money in → ${money(vg.ending)} · ${multiple.toFixed(1)}× on capital`}
        />
        <StatTile
          label="Realized P&L"
          value={pnl(sm.realized)}
          tone={sm.realized >= 0 ? "gain" : "loss"}
          sub={`${pnl(sm.realized_closed)} closed trades · ${pnl(sm.realized_open)} partial sells on open · ${pnl(sm.advisor.realized)} advisor liquidation`}
        />
        <StatTile
          label="Unrealized (open)"
          value={pnl(sm.unrealized)}
          tone={sm.unrealized >= 0 ? "gain" : "loss"}
          sub={`${money(sm.market_value)} market value · ${money(sm.open_cost)} cost · ${sm.prices_as_of} close`}
        />
        <StatTile label="Closed positions" value={String(stats.closed)} sub={`${stats.wins} wins · ${stats.losses} losses`} />
      </section>

      <section className="grid md:grid-cols-2 gap-4">
        <div className="card p-4">
          <h2 className="font-medium mb-2">
            Total gain over time{" "}
            <span className="text-xs text-muted font-normal">
              <span style={{ color: "var(--series-1)" }}>■</span> Vanguard cumulative investment returns (monthly) ·{" "}
              <span style={{ color: "var(--series-2)" }}>■</span> realized P&amp;L
            </span>
          </h2>
          <TotalGainOverTime rows={data.balance_history} realized={cum} />
        </div>
        <div className="card p-4">
          <h2 className="font-medium mb-2">
            P&amp;L by year{" "}
            <span className="text-xs text-muted font-normal">
              <span style={{ color: "var(--series-1)" }}>■</span> total gain incl. unrealized (Vanguard) ·{" "}
              <span style={{ color: "var(--series-2)" }}>■</span> realized
            </span>
          </h2>
          <PnlByYear rows={yearRows} />
        </div>
      </section>

      <section className="grid md:grid-cols-2 gap-4">
        <div className="card p-4">
          <h2 className="font-medium mb-2">
            Biggest winners by ticker <span className="text-xs text-muted font-normal">(realized + unrealized · same scale as losers)</span>
          </h2>
          <PnlBySymbol rows={winners} expandLabel={`Show all ${winners.length} winners`} domain={[0, tickerScale]} />
        </div>
        <div className="card p-4">
          <h2 className="font-medium mb-2">
            Biggest losers by ticker <span className="text-xs text-muted font-normal">(realized + unrealized · same scale as winners)</span>
          </h2>
          <PnlBySymbol rows={losers} expandLabel={`Show all ${losers.length} losers`} domain={[-tickerScale, 0]} />
        </div>
      </section>

      {openPositions.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-baseline justify-between">
            <h2 className="font-medium">Open positions</h2>
            <span className="text-xs text-muted">Lots and prices as shown on Vanguard&apos;s Holdings page, {sm.prices_as_of} close</span>
          </div>
          <div className="card overflow-x-auto">
            <table className="data">
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Account</th>
                  <th>Opened</th>
                  <th className="num">Held</th>
                  <th className="num">Shares</th>
                  <th className="num">Cost basis</th>
                  <th className="num">Avg cost</th>
                  <th className="num">Last</th>
                  <th className="num">Market value</th>
                  <th className="num">Unrealized</th>
                  <th className="num">Realized so far</th>
                </tr>
              </thead>
              <tbody>
                {openPositions.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/swing/positions/${p.id}`} className="font-medium hover:underline">{p.symbol}</Link>
                      <div className="text-xs text-muted">{p.name}</div>
                    </td>
                    <td className="text-ink-2">{p.account}</td>
                    <td className="tnum">{p.opened}</td>
                    <td className="num text-ink-2">{days(p.days)}</td>
                    <td className="num">{shares(p.open_qty ?? 0)}</td>
                    <td className="num">{money(p.open_cost)}</td>
                    <td className="num">{money((p.open_cost ?? 0) / (p.open_qty ?? 1), true)}</td>
                    <td className="num">{p.last_price !== undefined ? money(p.last_price, true) : "—"}</td>
                    <td className="num">{p.market_value !== undefined ? money(p.market_value) : "—"}</td>
                    <td className={`num font-medium ${pnlClass(p.unrealized)}`}>{p.unrealized !== undefined ? pnl(p.unrealized) : "—"}</td>
                    <td className={`num ${pnlClass(p.realized)}`}>{p.sells ? pnl(p.realized) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="card p-4 space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="font-medium">How this ties to Vanguard</h2>
          <span className="text-xs text-muted">as of {sm.prices_as_of} close</span>
        </div>
        <div className="grid md:grid-cols-2 gap-6 text-sm">
          <div>
            <div className="text-xs text-ink-2 uppercase tracking-wide mb-1">Vanguard Performance page, since {vg.since}</div>
            <table className="data">
              <tbody>
                <tr><td>Market gain/loss</td><td className="num">{pnl(vg.market, true)}</td></tr>
                <tr><td>Income returns</td><td className="num">{pnl(vg.income, true)}</td></tr>
                <tr><td className="font-medium">Investment returns</td><td className="num font-medium">{pnl(vg.investment_returns, true)}</td></tr>
                <tr><td>Deposits &amp; withdrawals, net</td><td className="num">{money(vg.flows, true)}</td></tr>
                <tr><td className="font-medium">Ending balance</td><td className="num font-medium">{money(vg.ending, true)}</td></tr>
              </tbody>
            </table>
          </div>
          <div>
            <div className="text-xs text-ink-2 uppercase tracking-wide mb-1">This site, from every transaction plus Vanguard&apos;s lot records</div>
            <table className="data">
              <tbody>
                <tr><td>Realized on your trades (Vanguard&apos;s lots, original cost)</td><td className="num">{pnl(sm.realized_trades, true)}</td></tr>
                <tr><td>Realized on the advisor holdings liquidated Apr 2020</td><td className="num">{pnl(sm.advisor.realized, true)}</td></tr>
                <tr><td>Unrealized on open lots</td><td className="num">{pnl(sm.unrealized, true)}</td></tr>
                <tr><td>Dividends &amp; interest income</td><td className="num">{pnl(sm.income, true)}</td></tr>
                <tr><td className="font-medium">Total</td><td className={`num font-medium ${pnlClass(sm.components_total)}`}>{pnl(sm.components_total, true)}</td></tr>
                <tr><td>Ledger cash / margin balance (Vanguard: {money(sm.cash, true)})</td><td className="num">{money(sm.ledger_cash, true)}</td></tr>
                <tr><td>Holdings × Vanguard prices + cash (Vanguard: {money(sm.account_value, true)})</td><td className="num">{money(sm.market_value + sm.ledger_cash, true)}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <p className="text-xs text-muted">
          Every sale from 2020 on uses the exact lots Vanguard assigned (the ones on the 1099-B); 2019 sales predate Vanguard&apos;s cost-basis
          report and are matched first-in-first-out. Lot costs are original purchase prices, so wash-sale basis adjustments — a tax-timing
          effect — are left out here and shown in the tax view. Vanguard&apos;s Holdings page reports unrealized of{" "}
          {money(sm.vanguard_unrealized ?? 0)}, {money(Math.abs(sm.wash_deferred ?? 0))} lower, because that much disallowed loss is currently
          embedded in the basis of an open IMMX lot.
        </p>
      </section>

      <section className="card p-4 space-y-2">
        <h2 className="font-medium">
          Tax view <span className="text-xs text-muted font-normal">from Vanguard&apos;s realized gain/loss reports</span>
        </h2>
        <div className="overflow-x-auto">
          <table className="data">
            <thead>
              <tr>
                <th>Year</th>
                <th className="num">Realized (economic)</th>
                <th className="num">Taxable per Vanguard</th>
                <th className="num">Wash-sale losses disallowed</th>
                <th className="num">Closed positions</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {yearRows.map((r) => (
                <tr key={r.year}>
                  <td className="tnum">{r.year}</td>
                  <td className={`num ${pnlClass(r.realized)}`}>{pnl(r.realized)}</td>
                  <td className={`num ${pnlClass(r.taxable)}`}>{pnl(r.taxable)}</td>
                  <td className="num text-ink-2">{r.disallowed ? money(r.disallowed) : "—"}</td>
                  <td className="num text-ink-2">{r.closed}</td>
                  <td className="text-xs text-muted">{r.source}</td>
                </tr>
              ))}
              <tr>
                <td className="font-medium">Total</td>
                <td className={`num font-medium ${pnlClass(sm.realized)}`}>{pnl(sm.realized)}</td>
                <td className={`num font-medium ${pnlClass(sm.taxable_realized)}`}>{pnl(sm.taxable_realized)}</td>
                <td className="num text-ink-2">{money(yearRows.reduce((a, r) => a + r.disallowed, 0))}</td>
                <td className="num text-ink-2">{stats.closed}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="pt-2">
          <h3 className="font-medium text-sm mb-1">Roughly what that meant in tax <span className="text-xs text-muted font-normal">(Brokerage only — the SEP-IRA is tax-deferred)</span></h3>
          <div className="overflow-x-auto">
            <table className="data max-w-3xl">
              <thead>
                <tr>
                  <th>Year</th>
                  <th className="num">Taxable gain (Brokerage)</th>
                  <th className="num">Short-term</th>
                  <th className="num">Long-term</th>
                  <th className="num">Est. federal (40.8% ST / 23.8% LT)</th>
                  <th className="num">Est. NY state</th>
                  <th className="num">Est. total owed</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {data.tax_estimate.years.map((t) => (
                  <tr key={t.year}>
                    <td className="tnum">{t.year}</td>
                    <td className={`num ${pnlClass(t.brk_taxable)}`}>{pnl(t.brk_taxable)}</td>
                    <td className={`num ${pnlClass(t.st)}`}>{t.st ? pnl(t.st) : "—"}</td>
                    <td className={`num ${pnlClass(t.lt)}`}>{t.lt ? pnl(t.lt) : "—"}</td>
                    <td className="num">{t.est_federal ? money(t.est_federal) : "—"}</td>
                    <td className="num">{t.est_ny ? `${money(t.est_ny)} (${(t.ny_rate * 100).toFixed(2)}%)` : "—"}</td>
                    <td className="num font-medium">{t.est_total ? money(t.est_total) : "—"}</td>
                    <td className="text-xs text-muted">{t.note}</td>
                  </tr>
                ))}
                <tr>
                  <td className="font-medium">Total</td>
                  <td></td><td></td><td></td><td></td><td></td>
                  <td className="num font-medium">{money(data.tax_estimate.total)}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
          <ul className="text-xs text-muted mt-2 space-y-0.5 list-disc pl-4">
            {data.tax_estimate.assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-muted">
          &ldquo;Taxable&rdquo; is what Vanguard reports for the year after wash-sale rules: a loss on shares repurchased within 30 days is
          disallowed that year and added to the replacement shares&apos; basis, so it comes back when those shares are sold. Over the whole
          history the two columns converge; the remaining gap is the 2020 transferred-in funds (Vanguard carries the prior broker&apos;s cost,
          this site uses their value on arrival) plus the deferral still sitting in open lots. SEP-IRA activity is included in both columns
          but is not taxable.
        </p>
      </section>

      <section className="grid md:grid-cols-2 gap-4">
        {stats.best && (
          <div className="card p-4">
            <div className="text-xs text-ink-2 uppercase tracking-wide">Best closed trade</div>
            <Link href={`/swing/positions/${stats.best.id}`} className="text-lg font-semibold hover:underline">
              {stats.best.symbol} <span className="text-gain">{pnl(stats.best.realized)}</span>
            </Link>
            <div className="text-sm text-ink-2">
              {pct(stats.best.return_pct)} · {stats.best.opened} → {stats.best.closed} · {days(stats.best.days)} · {stats.best.account}
            </div>
          </div>
        )}
        {stats.worst && (
          <div className="card p-4">
            <div className="text-xs text-ink-2 uppercase tracking-wide">Worst closed trade</div>
            <Link href={`/swing/positions/${stats.worst.id}`} className="text-lg font-semibold hover:underline">
              {stats.worst.symbol} <span className="text-loss">{pnl(stats.worst.realized)}</span>
            </Link>
            <div className="text-sm text-ink-2">
              {pct(stats.worst.return_pct)} · {stats.worst.opened} → {stats.worst.closed} · {days(stats.worst.days)} · {stats.worst.account}
            </div>
          </div>
        )}
      </section>

      <section className="grid md:grid-cols-2 gap-4">
        {bestOverall && (
          <div className="card p-4">
            <div className="text-xs text-ink-2 uppercase tracking-wide">Best trade overall (open or closed)</div>
            <Link href={`/swing/positions/${bestOverall.id}`} className="text-lg font-semibold hover:underline">
              {bestOverall.symbol} <span className={withTotal(bestOverall) >= 0 ? "text-gain" : "text-loss"}>{pnl(withTotal(bestOverall))}</span>
            </Link>
            <div className="text-sm text-ink-2">
              {bestOverall.status === "open"
                ? `still open · ${pnl(bestOverall.realized)} realized + ${pnl(bestOverall.unrealized ?? 0)} unrealized`
                : `closed ${bestOverall.closed}`}{" "}
              · {bestOverall.opened} → {bestOverall.closed ?? "now"} · {days(bestOverall.days)} · {bestOverall.account}
            </div>
          </div>
        )}
        {worstOverall && (
          <div className="card p-4">
            <div className="text-xs text-ink-2 uppercase tracking-wide">Worst trade overall (open or closed)</div>
            <Link href={`/swing/positions/${worstOverall.id}`} className="text-lg font-semibold hover:underline">
              {worstOverall.symbol} <span className={withTotal(worstOverall) >= 0 ? "text-gain" : "text-loss"}>{pnl(withTotal(worstOverall))}</span>
            </Link>
            <div className="text-sm text-ink-2">
              {worstOverall.status === "open"
                ? `still open · ${pnl(worstOverall.realized)} realized + ${pnl(worstOverall.unrealized ?? 0)} unrealized`
                : `closed ${worstOverall.closed}`}{" "}
              · {worstOverall.opened} → {worstOverall.closed ?? "now"} · {days(worstOverall.days)} · {worstOverall.account}
            </div>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h2 className="font-medium">Recently closed</h2>
          <Link href="/swing/positions" className="text-sm text-accent hover:underline">All positions →</Link>
        </div>
        <PositionsTable positions={recentlyClosed} showFilters={false} compactMode />
      </section>
    </div>
  );
}
