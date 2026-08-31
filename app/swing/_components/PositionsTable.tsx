"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { Position } from "@/app/swing/_lib/types";
import { days, money, pct, pnl, pnlClass, shares } from "@/app/swing/_lib/format";

type SortKey = "opened" | "closed" | "symbol" | "account" | "cost" | "realized" | "return_pct" | "days";

export function PositionsTable({
  positions,
  showFilters = true,
  initialSort = "closed",
  compactMode = false,
}: {
  positions: Position[];
  showFilters?: boolean;
  initialSort?: SortKey;
  compactMode?: boolean;
}) {
  const [q, setQ] = useState("");
  const [account, setAccount] = useState("all");
  const [status, setStatus] = useState("all");
  const [year, setYear] = useState("all");
  const [outcome, setOutcome] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>(initialSort);
  const [desc, setDesc] = useState(true);

  const years = useMemo(
    () => Array.from(new Set(positions.map((p) => (p.closed ?? p.opened).slice(-4)))).sort().reverse(),
    [positions],
  );

  const rows = useMemo(() => {
    const s = q.trim().toUpperCase();
    let r = positions.filter((p) => {
      if (s && !p.symbol.includes(s) && !p.name.toUpperCase().includes(s)) return false;
      if (account !== "all" && p.account !== account) return false;
      if (status !== "all" && p.status !== status) return false;
      if (year !== "all" && (p.closed ?? p.opened).slice(-4) !== year) return false;
      if (outcome === "win" && !(p.status === "closed" && p.realized > 0)) return false;
      if (outcome === "loss" && !(p.status === "closed" && p.realized <= 0)) return false;
      return true;
    });
    const dateVal = (s: string | null) => (s ? Number(s.slice(-4) + s.slice(0, 2) + s.slice(3, 5)) : 99999999);
    r = [...r].sort((a, b) => {
      let av: number | string, bv: number | string;
      switch (sortKey) {
        case "opened": av = dateVal(a.opened); bv = dateVal(b.opened); break;
        case "closed": av = dateVal(a.closed); bv = dateVal(b.closed); break;
        case "symbol": av = a.symbol; bv = b.symbol; break;
        case "account": av = a.account; bv = b.account; break;
        case "cost": av = a.cost; bv = b.cost; break;
        case "realized": av = a.realized; bv = b.realized; break;
        case "return_pct": av = a.return_pct ?? -Infinity; bv = b.return_pct ?? -Infinity; break;
        case "days": av = a.days; bv = b.days; break;
      }
      const c = av < bv ? -1 : av > bv ? 1 : 0;
      return desc ? -c : c;
    });
    return r;
  }, [positions, q, account, status, year, outcome, sortKey, desc]);

  const totals = useMemo(() => {
    const closed = rows.filter((p) => p.status === "closed" && p.basis_known);
    return {
      realized: closed.reduce((a, p) => a + p.realized, 0),
      count: rows.length,
      wins: closed.filter((p) => p.realized > 0).length,
      closed: closed.length,
    };
  }, [rows]);

  const th = (key: SortKey, label: string, num = false) => (
    <th
      className={`sortable ${num ? "num" : ""}`}
      onClick={() => {
        if (sortKey === key) setDesc(!desc);
        else { setSortKey(key); setDesc(true); }
      }}
      aria-sort={sortKey === key ? (desc ? "descending" : "ascending") : "none"}
    >
      {label} {sortKey === key ? (desc ? "↓" : "↑") : ""}
    </th>
  );

  return (
    <div className="space-y-3">
      {showFilters && (
        <div className="flex flex-wrap items-center gap-2">
          <input type="search" placeholder="Ticker or name" value={q} onChange={(e) => setQ(e.target.value)} className="w-44" />
          <select value={account} onChange={(e) => setAccount(e.target.value)}>
            <option value="all">All accounts</option>
            <option value="Brokerage">Brokerage</option>
            <option value="SEP-IRA">SEP-IRA</option>
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">Open + closed</option>
            <option value="closed">Closed</option>
            <option value="open">Open</option>
          </select>
          <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value="all">Wins + losses</option>
            <option value="win">Winners</option>
            <option value="loss">Losers</option>
          </select>
          <select value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="all">All years</option>
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <div className="ml-auto text-sm text-ink-2 tnum">
            {totals.count} positions · {totals.wins}/{totals.closed} won ·{" "}
            <span className={pnlClass(totals.realized)}>{pnl(totals.realized)}</span> realized
          </div>
        </div>
      )}
      <div className="card overflow-x-auto">
        <table className="data">
          <thead>
            <tr>
              {th("symbol", "Ticker")}
              {!compactMode && th("account", "Account")}
              {th("opened", "Opened")}
              {th("closed", "Closed")}
              {th("days", "Held", true)}
              {!compactMode && <th className="num">Shares</th>}
              {th("cost", "Cost", true)}
              {th("realized", "Realized P&L", true)}
              {th("return_pct", "Return", true)}
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link href={`/swing/positions/${p.id}`} className="font-medium hover:underline">{p.symbol}</Link>
                  {!compactMode && <div className="text-xs text-muted truncate max-w-[220px]">{p.name}</div>}
                </td>
                {!compactMode && <td className="text-ink-2">{p.account}</td>}
                <td className="tnum">{p.opened}</td>
                <td className="tnum">{p.closed ?? "—"}</td>
                <td className="num text-ink-2">{days(p.days)}</td>
                {!compactMode && <td className="num">{shares(p.max_qty)}</td>}
                <td className="num">{money(p.cost)}</td>
                <td className={`num font-medium ${pnlClass(p.realized)}`}>{pnl(p.realized)}</td>
                <td className={`num ${pnlClass(p.return_pct)}`}>{pct(p.return_pct)}</td>
                <td>
                  {p.status === "open" ? (
                    <span className="chip chip-open">Open</span>
                  ) : !p.basis_known ? (
                    <span className="chip">Transferred in</span>
                  ) : p.realized > 0 ? (
                    <span className="chip chip-gain">Win</span>
                  ) : (
                    <span className="chip chip-loss">Loss</span>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="text-center text-muted py-8">No positions match those filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
