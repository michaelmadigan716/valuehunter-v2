"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { Execution } from "@/app/swing/_lib/types";
import { money, pnl, pnlClass, price, shares } from "@/app/swing/_lib/format";

const PAGE = 100;

export function TradeLog({ executions }: { executions: Execution[] }) {
  const [q, setQ] = useState("");
  const [account, setAccount] = useState("all");
  const [type, setType] = useState("all");
  const [year, setYear] = useState("all");
  const [category, setCategory] = useState("trade");
  const [page, setPage] = useState(0);

  const years = useMemo(() => Array.from(new Set(executions.map((e) => e.date.slice(-4)))).sort().reverse(), [executions]);

  const rows = useMemo(() => {
    const s = q.trim().toUpperCase();
    const dv = (d: string) => Number(d.slice(-4) + d.slice(0, 2) + d.slice(3, 5));
    return executions
      .filter((e) => (!s || e.symbol.includes(s)) && (account === "all" || e.account === account) && (type === "all" || e.type === type) && (year === "all" || e.date.slice(-4) === year) && (category === "all" || (e.category ?? "trade") === category))
      .sort((a, b) => dv(b.date) - dv(a.date));
  }, [executions, q, account, type, year, category]);

  const totals = useMemo(() => {
    const bought = rows.filter((e) => e.type === "Buy").reduce((a, e) => a - e.amount, 0);
    const sold = rows.filter((e) => e.type === "Sell").reduce((a, e) => a + e.amount, 0);
    const realized = rows.reduce((a, e) => a + (e.pnl ?? 0), 0);
    return { bought, sold, realized };
  }, [rows]);

  const pageRows = rows.slice(page * PAGE, page * PAGE + PAGE);
  const pages = Math.ceil(rows.length / PAGE);
  const reset = () => setPage(0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input type="search" placeholder="Ticker" value={q} onChange={(e) => { setQ(e.target.value); reset(); }} className="w-36" />
        <select value={account} onChange={(e) => { setAccount(e.target.value); reset(); }}>
          <option value="all">All accounts</option>
          <option value="Brokerage">Brokerage</option>
          <option value="SEP-IRA">SEP-IRA</option>
        </select>
        <select value={type} onChange={(e) => { setType(e.target.value); reset(); }}>
          <option value="all">Buys + sells</option>
          <option value="Buy">Buys</option>
          <option value="Sell">Sells</option>
        </select>
        <select value={year} onChange={(e) => { setYear(e.target.value); reset(); }}>
          <option value="all">All years</option>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={category} onChange={(e) => { setCategory(e.target.value); reset(); }}>
          <option value="trade">My trades</option>
          <option value="advisor">Advisor liquidations (Apr 2020)</option>
          <option value="all">Everything</option>
        </select>
        <div className="ml-auto text-sm text-ink-2 tnum">
          {rows.length.toLocaleString()} fills · bought {money(totals.bought)} · sold {money(totals.sold)} ·{" "}
          <span className={pnlClass(totals.realized)}>{pnl(totals.realized)}</span> realized
        </div>
      </div>
      <div className="card overflow-x-auto">
        <table className="data">
          <thead>
            <tr>
              <th>Date</th>
              <th>Ticker</th>
              <th>Account</th>
              <th>Side</th>
              <th className="num">Shares</th>
              <th className="num">Price</th>
              <th className="num">Fees</th>
              <th className="num">Amount</th>
              <th className="num">Realized</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((e, i) => (
              <tr key={`${e.date}-${e.symbol}-${i}`}>
                <td className="tnum">{e.date}</td>
                <td><Link href={`/swing/tickers/${encodeURIComponent(e.symbol)}`} className="font-medium hover:underline">{e.symbol}</Link></td>
                <td className="text-ink-2">{e.account}</td>
                <td className={e.type === "Buy" ? "text-accent" : ""}>{e.type}</td>
                <td className="num">{shares(e.qty)}</td>
                <td className="num">{price(e.price)}</td>
                <td className="num text-ink-2">{e.fees ? money(e.fees, true) : "—"}</td>
                <td className="num">{money(e.amount, true)}</td>
                <td className={`num ${pnlClass(e.pnl)}`}>{e.pnl !== undefined && e.pnl !== null ? pnl(e.pnl, true) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex items-center gap-3 text-sm text-ink-2">
          <button className="chip" disabled={page === 0} onClick={() => setPage(page - 1)}>← Prev</button>
          <span className="tnum">Page {page + 1} of {pages}</span>
          <button className="chip" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next →</button>
        </div>
      )}
    </div>
  );
}
