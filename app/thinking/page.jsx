'use client';
import { useEffect, useMemo, useState, useCallback } from 'react';

// ───────────────────────── helpers ─────────────────────────
const ago = (ts) => { if (!ts) return 'never'; const m = Math.round((Date.now() - ts) / 60000); if (m < 1) return 'just now'; if (m < 60) return `${m}m ago`; const h = Math.round(m / 60); if (h < 48) return `${h}h ago`; return `${Math.round(h / 24)}d ago`; };
const fmtCap = (m) => m == null ? null : m >= 1000 ? `$${(m / 1000).toFixed(1)}B` : `$${Math.round(m)}M`;
const today = () => new Date().toISOString().slice(0, 10);
const evOf = (p) => (p.probability != null && p.expectedMultiple != null) ? p.probability * (p.expectedMultiple - 1) - (1 - p.probability) * (Math.abs(p.downsidePct || 0) / 100) : null;
const nextCat = (p) => (p.catalystDates || []).filter(c => c.date >= today()).sort((a, b) => a.date.localeCompare(b.date))[0] || null;
const firstLine = (s, n = 110) => { if (!s) return ''; const t = s.split(/(?<=[.!?])\s/)[0] || s; return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const C = { up: '#34d399', down: '#f87171', warn: '#fbbf24', cyan: '#22d3ee', mute: '#64748b', text: '#cbd5e1' };
const hz = (h) => h === 'short' ? { label: 'short', color: '#fb923c' } : h === 'long' ? { label: 'long', color: '#a78bfa' } : h === 'medium' ? { label: 'medium', color: '#22d3ee' } : null;

// ───────────────────────── atoms ─────────────────────────
const Pill = ({ children, color = C.mute, bg, onClick, title, active }) => (
  <button onClick={onClick} title={title} className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full border whitespace-nowrap ${onClick ? 'cursor-pointer hover:brightness-125' : 'cursor-default'}`} style={{ color, borderColor: active ? color : 'rgba(71,85,105,0.5)', background: bg || (active ? `${color}18` : 'rgba(15,23,42,0.5)') }}>{children}</button>
);
const Num = ({ label, value, color = C.text, sub }) => (
  <div className="min-w-[52px]"><div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div><div className="text-base font-semibold mono leading-tight" style={{ color }}>{value ?? '–'}</div>{sub && <div className="text-[10px] text-slate-500">{sub}</div>}</div>
);
const Bar = ({ v, max, color = C.cyan }) => <div className="h-1 rounded bg-slate-800 w-full"><div className="h-1 rounded" style={{ width: `${max ? Math.max(4, Math.min(100, (v / max) * 100)) : 0}%`, background: color }} /></div>;
const Box = ({ title, right, children, className = '', pad = 'p-4' }) => (
  <div className={`rounded-2xl border ${pad} ${className}`} style={{ background: 'rgba(15,23,42,0.6)', borderColor: 'rgba(51,65,85,0.5)' }}>
    {(title || right) && <div className="flex items-center justify-between mb-2"><h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h3>{right}</div>}
    {children}
  </div>
);
const Fold = ({ title, count, children, open = false }) => (
  <details open={open} className="group rounded-xl border" style={{ borderColor: 'rgba(51,65,85,0.5)', background: 'rgba(2,6,23,0.35)' }}>
    <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-slate-300 flex items-center justify-between"><span>{title}{count != null && <span className="text-slate-500 font-normal"> · {count}</span>}</span><span className="text-slate-600 group-open:rotate-90 transition-transform">▸</span></summary>
    <div className="px-3 pb-3">{children}</div>
  </details>
);
const Src = ({ s }) => /^https?:/.test(s) ? <a href={s} target="_blank" rel="noreferrer" className="text-[11px] text-slate-500 hover:text-cyan-400 underline truncate max-w-[260px] inline-block align-bottom">{s.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60)}</a> : <span className="text-[11px] text-slate-500">{s}</span>;

// ───────────────────────── play details (shared) ─────────────────────────
function PlayDetails({ p, color }) {
  const cat = (p.catalystDates || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-200 whitespace-pre-wrap leading-relaxed">{p.thesis}</p>
      <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-xs">
        {p.upsideCase && <div><span className="font-semibold" style={{ color: C.up }}>If right:</span> <span className="text-slate-300">{p.upsideCase}</span></div>}
        {(p.downsideCase || p.downsidePct != null) && <div><span className="font-semibold" style={{ color: C.down }}>If wrong{p.downsidePct != null ? ` (~${p.downsidePct}%)` : ''}:</span> <span className="text-slate-300">{p.downsideCase}</span></div>}
        {p.setup && <div><span className="font-semibold text-violet-300">Entry:</span> <span className="text-slate-300">{p.setup}</span></div>}
        {p.invalidation && <div><span className="font-semibold text-rose-300">Bail if:</span> <span className="text-slate-300">{p.invalidation}</span></div>}
      </div>
      {!!cat.length && <div className="text-xs"><span className="font-semibold" style={{ color: C.cyan }}>Dated catalysts:</span> {cat.map((c, i) => <span key={i} className="ml-2 text-slate-300"><span className="mono text-slate-400">{c.date}</span> {c.what}</span>)}</div>}
      <Fold title="Risks, what would change its mind, catalysts, sources">
        <div className="space-y-2 text-xs mt-2">
          {p.risks && <div><span className="font-semibold text-slate-400">Risks:</span> <span className="text-slate-300">{p.risks}</span></div>}
          {p.changeMind && <div><span className="font-semibold text-slate-400">Would change its mind:</span> <span className="text-slate-300">{p.changeMind}</span></div>}
          {p.catalysts && <div><span className="font-semibold text-slate-400">Catalysts:</span> <span className="text-slate-300">{p.catalysts}</span></div>}
          {!!p.sources?.length && <div className="flex flex-wrap gap-2 pt-1">{p.sources.map((s, i) => <Src key={i} s={s} />)}</div>}
          <div className="text-slate-600">confidence in verification {p.confidence}/100 · {fmtCap(p.marketCapM) || 'cap ?'} · {p.liquidity || 'liquidity ?'} · entered at ${p.entryPrice ?? '?'} {p.entryAt ? new Date(p.entryAt).toLocaleDateString() : ''}{p.inValueHunter ? ' · in ValueHunter' : ''}</div>
        </div>
      </Fold>
    </div>
  );
}

// ───────────────────────── derived "what changed" ─────────────────────────
function useChanges(st) {
  return useMemo(() => {
    const runs = st.runs || []; const last = runs[runs.length - 1]; if (!last) return { items: [], since: null };
    const since = last.startedAt - 1;
    const items = [];
    for (const p of st.plays || []) {
      if ((p.entryAt || 0) >= since) items.push({ kind: 'new', text: `${p.ticker} entered at #${p.rank}`, ticker: p.ticker, color: C.up });
      else if (p.prevRank != null && p.prevRank !== p.rank) items.push({ kind: 'move', text: `${p.ticker} ${p.prevRank > p.rank ? '↑' : '↓'} #${p.prevRank} → #${p.rank}`, ticker: p.ticker, color: p.prevRank > p.rank ? C.up : C.warn });
    }
    for (const x of st.rejected || []) if ((x.at || 0) >= since) items.push({ kind: 'kill', text: `${x.ticker} rejected: ${x.why}`, ticker: x.ticker, color: C.down });
    for (const q of st.archive || []) if ((q.updatedAt || 0) >= since) items.push({ kind: 'answered', text: `Answered: ${q.question}`, detail: q.answer, color: C.cyan });
    const ev = (st.evidence || []).filter(e => (e.at || 0) >= since);
    return { items, since, evidenceCount: ev.length, last };
  }, [st]);
}

// ───────────────────────── page ─────────────────────────
export default function ThinkingPage() {
  const [cat, setCat] = useState('robotics');
  const [d, setD] = useState(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(null);      // expanded play ticker
  const [tab, setTab] = useState('changes');
  const [sort, setSort] = useState('ev');

  const load = useCallback(async (c) => { try { const r = await fetch(`/api/thinking?category=${c}`, { cache: 'no-store' }); const j = await r.json(); if (!j.error) setD(j); } catch (e) {} }, []);
  useEffect(() => { try { const s = localStorage.getItem('vh_thinking_cat'); if (s) setCat(s); } catch (e) {} }, []);
  useEffect(() => { load(cat); try { localStorage.setItem('vh_thinking_cat', cat); } catch (e) {} const t = setInterval(() => load(cat), 60000); return () => clearInterval(t); }, [cat, load]);
  const post = async (body) => { setBusy(true); try { await fetch('/api/thinking', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category: cat, ...body }) }); await load(cat); } catch (e) {} setBusy(false); };
  const ask = () => { if (!q.trim()) return; post({ action: 'ask', question: q.trim() }); setQ(''); };

  const cfg = d?.config || { engine: { enabled: true }, categories: {}, mode: 'test' };
  const st = d?.state || { plays: [], questions: [], evidence: [], runs: [], archive: [], rejected: [] };
  const cats = d?.categories || [];
  const active = cats.find(c => c.id === cat); const color = active?.color || C.cyan;
  const lastRun = st.runs?.[st.runs.length - 1];
  const running = st.currentRun && Date.now() - st.currentRun.startedAt < 95 * 60000;
  const plays = useMemo(() => { const arr = (st.plays || []).map(p => ({ ...p, ev: evOf(p), next: nextCat(p) })); const key = { ev: p => p.ev ?? -9, upside: p => p.expectedMultiple ?? 0, odds: p => p.probability ?? 0, conf: p => p.confidence ?? 0, since: p => p.sinceEntryPct ?? -999, rank: p => -p.rank }[sort]; return [...arr].sort((a, b) => key(b) - key(a)); }, [st.plays, sort]);
  const maxEv = Math.max(0.01, ...plays.map(p => p.ev || 0));
  const changes = useChanges(st);
  const catalysts = useMemo(() => (st.plays || []).flatMap(p => (p.catalystDates || []).map(c => ({ ...c, ticker: p.ticker }))).filter(c => c.date).sort((a, b) => a.date.localeCompare(b.date)), [st.plays]);
  const openQs = [...(d?.inbox || []).map(x => ({ ...x, mine: true })), ...(st.questions || []).sort((a, b) => (a.priority || 3) - (b.priority || 3))];

  // ── shared header ──
  const Header = () => (
    <div className="space-y-3 mb-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <a href="/" className="text-xs px-2.5 py-1.5 rounded-lg border text-slate-400 hover:text-white" style={{ borderColor: 'rgba(51,65,85,0.6)' }}>← ValueHunter</a>
          <h1 className="text-lg font-semibold flex items-center gap-2"><span style={{ color }}>◉</span> Always Thinking</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Pill color={cfg.engine?.enabled ? C.up : C.down} active onClick={() => post({ action: 'config', config: { engine: { enabled: !cfg.engine?.enabled } } })} title="Master switch for the cloud routine">● {cfg.engine?.enabled ? 'Engine on' : 'Engine paused'}</Pill>
          <Pill color={cfg.mode === 'deep' ? C.up : C.warn} active onClick={() => post({ action: 'config', config: { mode: cfg.mode === 'deep' ? 'test' : 'deep' } })} title={cfg.mode === 'deep' ? 'Deep: hourly relay legs until the search cap or ~50 min. Click for Test.' : 'Test: ~5-min cycles with feedback. Click for Deep.'}>{cfg.mode === 'deep' ? 'Deep mode' : 'Test mode'}</Pill>
          <Pill color={running ? C.cyan : C.mute} title="Runs every hour">{running ? 'thinking now…' : lastRun ? `last run ${ago(lastRun.endedAt)}` : 'no runs yet'}</Pill>
          <a href="https://claude.ai/code/routines/trig_01KagnxmcSaRRff53hJ8g5fs" target="_blank" rel="noreferrer" className="text-[11px] text-slate-500 hover:text-cyan-400 underline">routine ↗</a>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {cats.map(c => { const on = cfg.categories?.[c.id]?.enabled; return (
          <div key={c.id} className="flex items-center gap-1">
            <Pill color={c.color} active={cat === c.id} onClick={() => setCat(c.id)}>{c.label}</Pill>
            <button onClick={() => post({ action: 'config', config: { categories: { [c.id]: { enabled: !on } } } })} title={on ? 'engine works this category - click to switch off' : 'switched off - click to enable'} className="text-[10px] px-1.5 py-1 rounded border" style={{ color: on ? C.up : C.mute, borderColor: 'rgba(71,85,105,0.4)' }}>{on ? 'on' : 'off'}</button>
          </div>); })}
        <div className="flex-1" />
        <div className="flex items-center gap-1 w-full sm:w-auto">
          <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && ask()} placeholder="Ask the engine (answered first, next run)…" className="flex-1 sm:w-72 text-xs rounded-lg px-3 py-1.5 border outline-none" style={{ background: 'rgba(30,41,59,0.6)', borderColor: 'rgba(51,65,85,0.6)' }} />
          <button disabled={busy || !q.trim()} onClick={ask} className="text-xs px-3 py-1.5 rounded-lg border" style={{ color: C.cyan, borderColor: 'rgba(34,211,238,0.4)' }}>Ask</button>
        </div>
      </div>
    </div>
  );

  // ── shared secondary tabs ──
  const Tabs = ({ list }) => (
    <div>
      <div className="flex gap-1 flex-wrap mb-3">{list.map(t => <button key={t.id} onClick={() => setTab(t.id)} className="text-xs px-3 py-1.5 rounded-lg border" style={{ color: tab === t.id ? '#e2e8f0' : C.mute, borderColor: tab === t.id ? color : 'rgba(51,65,85,0.5)', background: tab === t.id ? `${color}12` : 'transparent' }}>{t.label}{t.count != null ? <span className="text-slate-500"> {t.count}</span> : null}</button>)}</div>
      {tab === 'changes' && <ChangesList />}
      {tab === 'questions' && <QuestionsList />}
      {tab === 'catalysts' && <CatalystList />}
      {tab === 'evidence' && <EvidenceList />}
      {tab === 'engine' && <EngineNotes />}
      {tab === 'runs' && <RunsList />}
    </div>
  );
  const ChangesList = () => (
    <div className="space-y-1.5 text-xs">
      {!changes.items.length && <p className="text-slate-500">{lastRun ? 'Nothing moved in the last run.' : 'No runs yet.'}</p>}
      {changes.last && <p className="text-slate-500 mb-2">Since the run that started {ago(changes.last.startedAt)} · {changes.evidenceCount} new findings</p>}
      {changes.items.map((it, i) => <div key={i} className="flex gap-2"><span className="mono shrink-0" style={{ color: it.color }}>{it.kind}</span><span className="text-slate-300">{it.text}{it.detail && <details className="inline ml-1"><summary className="inline cursor-pointer text-slate-500">answer</summary><span className="block text-slate-400 mt-1 whitespace-pre-wrap">{it.detail}</span></details>}</span></div>)}
      {lastRun?.summary && <Fold title="Last run summary" open={false}><p className="text-slate-300 whitespace-pre-wrap mt-1">{lastRun.summary}</p></Fold>}
    </div>
  );
  const QuestionsList = () => (
    <div className="space-y-1.5 text-xs">
      {!openQs.length && <p className="text-slate-500">No open questions. Ask one above.</p>}
      {openQs.map(x => <div key={x.id} className="flex gap-2 items-start rounded-lg px-2 py-1.5 border" style={{ borderColor: x.mine ? 'rgba(34,211,238,0.35)' : 'rgba(51,65,85,0.4)', background: x.mine ? 'rgba(34,211,238,0.05)' : 'transparent' }}><span className="mono shrink-0 text-slate-500">{x.mine ? 'you' : `P${x.priority || 3} ${x.angle || ''}`}</span><span className="flex-1 text-slate-200">{x.question}</span><button onClick={() => post({ action: 'dismiss', id: x.id })} className="text-slate-600 hover:text-red-400">✕</button></div>)}
      {!!st.archive?.length && <Fold title="Answered" count={st.archive.length}><div className="space-y-1 mt-1">{[...st.archive].reverse().slice(0, 40).map(x => <details key={x.id}><summary className="cursor-pointer text-slate-300">{x.question}</summary><p className="text-slate-400 whitespace-pre-wrap pl-2 mt-1 border-l" style={{ borderColor: 'rgba(51,65,85,0.6)' }}>{x.answer}</p></details>)}</div></Fold>}
    </div>
  );
  const CatalystList = () => (
    <div className="space-y-1 text-xs">
      {!catalysts.length && <p className="text-slate-500">No dated catalysts on the board yet.</p>}
      {catalysts.map((c, i) => { const past = c.date < today(); return <div key={i} className="flex gap-2"><span className="mono shrink-0" style={{ color: past ? C.mute : C.cyan }}>{c.date}</span><span className="font-semibold text-slate-200">{c.ticker}</span><span className="text-slate-400">{c.what}</span></div>; })}
    </div>
  );
  const EvidenceList = () => {
    const byRun = {}; for (const e of [...(st.evidence || [])].reverse()) (byRun[e.runId || '?'] ||= []).push(e);
    return <div className="space-y-2 text-xs">{Object.entries(byRun).slice(0, 12).map(([rid, list]) => <Fold key={rid} title={`Run ${ago(list[0].at)}`} count={list.length} open={rid === (st.evidence || []).slice(-1)[0]?.runId}><div className="space-y-1 mt-1">{list.map(e => <div key={e.id} className="border-l-2 pl-2" style={{ borderColor: e.impact === 'bullish' ? C.up : e.impact === 'bearish' ? C.down : C.mute }}><span className="font-semibold text-slate-300 mr-1">{e.ticker || ''}</span><span className="text-slate-300">{e.finding}</span> {e.source && <Src s={e.source} />}</div>)}</div></Fold>)}</div>;
  };
  const EngineNotes = () => (
    <div className="space-y-2 text-xs">
      <Fold title="Next run plan" open><p className="text-slate-300 whitespace-pre-wrap mt-1">{st.nextPlan || '—'}</p></Fold>
      <Fold title="Engine memo (its own memory)"><p className="text-slate-300 whitespace-pre-wrap mt-1 max-h-[400px] overflow-y-auto">{st.memo || '—'}</p></Fold>
      <Fold title="Rejected names" count={st.rejected?.length || 0}><div className="space-y-1 mt-1">{[...(st.rejected || [])].reverse().map(x => <div key={x.ticker}><span className="font-semibold text-slate-300">{x.ticker}</span> <span className="text-slate-500">{x.why}</span></div>)}</div></Fold>
      {!!st.recommendedScans?.length && <Fold title="Wants ValueHunter deep scans on" count={st.recommendedScans.length}><div className="flex flex-wrap gap-1 mt-1">{st.recommendedScans.map(r => <span key={r.ticker} className="px-2 py-0.5 rounded border text-slate-300" style={{ borderColor: 'rgba(51,65,85,0.6)' }} title={r.why}>{r.ticker}</span>)}</div></Fold>}
    </div>
  );
  const RunsList = () => (
    <div className="space-y-1 text-xs">{[...(st.runs || [])].reverse().map(r => <Fold key={r.id} title={`${ago(r.endedAt)} · ${r.mode || 'run'} · ${r.minutes}m · ${r.plays} plays · ${r.evidence} findings${r.searches ? ` · ${r.searches} searches` : ''}${r.model ? ` · ${r.model.replace('claude-', '')}` : ''}`}><p className="text-slate-300 whitespace-pre-wrap mt-1">{r.summary || 'no summary'}</p>{r.feedback && <p className="mt-2 whitespace-pre-wrap border-l-2 pl-2 text-amber-200/90" style={{ borderColor: 'rgba(251,191,36,0.5)' }}><b>Engine feedback:</b> {r.feedback}</p>}</Fold>)}</div>
  );
  const tabList = [{ id: 'changes', label: 'What changed', count: changes.items.length || null }, { id: 'questions', label: 'Questions', count: openQs.length }, { id: 'catalysts', label: 'Catalysts', count: catalysts.filter(c => c.date >= today()).length }, { id: 'evidence', label: 'Evidence', count: st.evidence?.length || 0 }, { id: 'engine', label: 'Engine notes' }, { id: 'runs', label: 'Runs', count: st.runs?.length || 0 }];

  // ── play renderers ──
  const NumRow = ({ p }) => (
    <div className="flex items-end gap-4 flex-wrap">
      <Num label="Upside" value={p.expectedMultiple != null ? `${p.expectedMultiple}x` : null} color={C.up} />
      <Num label="Odds" value={p.probability != null ? `${Math.round(p.probability * 100)}%` : null} />
      <Num label="If wrong" value={p.downsidePct != null ? `${p.downsidePct}%` : null} color={C.down} />
      <div className="min-w-[90px]"><div className="text-[10px] uppercase tracking-wide text-slate-500">Risk-adj. EV</div><div className="text-base font-semibold mono leading-tight" style={{ color: C.cyan }}>{p.ev != null ? p.ev.toFixed(2) : '–'}</div><Bar v={p.ev || 0} max={maxEv} /></div>
      <Num label="Verified" value={p.confidence} color={p.confidence >= 70 ? C.up : p.confidence >= 45 ? C.warn : C.down} />
      {p.sinceEntryPct != null && <Num label="Since pick" value={`${p.sinceEntryPct >= 0 ? '+' : ''}${p.sinceEntryPct}%`} color={p.sinceEntryPct >= 0 ? C.up : C.down} />}
    </div>
  );
  const Chips = ({ p }) => { const h = hz(p.horizon); return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {h && <Pill color={h.color}>{h.label} swing</Pill>}
      {p.next && <Pill color={C.cyan} title={p.next.what}>⏱ {p.next.date}</Pill>}
      {p.inValueHunter && <Pill color={C.up} title="Also in your ValueHunter eligible pool">VH</Pill>}
      {p.prevRank != null && p.prevRank !== p.rank && <Pill color={p.prevRank > p.rank ? C.up : C.warn}>{p.prevRank > p.rank ? '↑' : '↓'} from #{p.prevRank}</Pill>}
      {(p.entryAt || 0) >= (changes.since || 0) && lastRun && <Pill color={C.up}>new</Pill>}
    </div>); };

  const Leaderboard = () => (
    <div className="space-y-5">
      <Box pad="p-0">
        <div className="flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: 'rgba(51,65,85,0.5)' }}>
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Ranking · {plays.length}</span>
          <div className="flex items-center gap-1 text-[11px] text-slate-500">sort {[['ev', 'EV'], ['upside', 'upside'], ['odds', 'odds'], ['conf', 'verified'], ['since', 'since pick'], ['rank', 'engine rank']].map(([k, l]) => <button key={k} onClick={() => setSort(k)} className="px-1.5 py-0.5 rounded" style={{ color: sort === k ? '#e2e8f0' : C.mute, background: sort === k ? 'rgba(51,65,85,0.6)' : 'transparent' }}>{l}</button>)}</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-[10px] uppercase tracking-wide text-slate-500"><th className="text-left px-4 py-2">#</th><th className="text-left py-2">Stock</th><th className="py-2">Horizon</th><th className="py-2 text-right">Upside</th><th className="py-2 text-right">Odds</th><th className="py-2 text-right">If wrong</th><th className="py-2 text-left pl-3 w-28">Risk-adj EV</th><th className="py-2 text-right">Verified</th><th className="py-2 text-right">Since pick</th><th className="py-2 text-right pr-4">Next catalyst</th></tr></thead>
            <tbody>
              {plays.map(p => (<>
                <tr key={p.ticker} onClick={() => setOpen(open === p.ticker ? null : p.ticker)} className="cursor-pointer hover:bg-slate-800/40 border-t" style={{ borderColor: 'rgba(51,65,85,0.35)' }}>
                  <td className="px-4 py-2 mono text-slate-500">{p.rank}</td>
                  <td className="py-2"><div className="font-semibold" style={{ color }}>{p.ticker} <span className="text-slate-500 font-normal">{p.name}</span></div><div className="text-slate-400 truncate max-w-[420px]">{p.hook || firstLine(p.thesis, 100)}</div></td>
                  <td className="py-2 text-center">{hz(p.horizon) ? <span style={{ color: hz(p.horizon).color }}>{hz(p.horizon).label}</span> : '–'}</td>
                  <td className="py-2 text-right mono" style={{ color: C.up }}>{p.expectedMultiple != null ? `${p.expectedMultiple}x` : '–'}</td>
                  <td className="py-2 text-right mono">{p.probability != null ? `${Math.round(p.probability * 100)}%` : '–'}</td>
                  <td className="py-2 text-right mono" style={{ color: C.down }}>{p.downsidePct != null ? `${p.downsidePct}%` : '–'}</td>
                  <td className="py-2 pl-3"><div className="mono" style={{ color: C.cyan }}>{p.ev != null ? p.ev.toFixed(2) : '–'}</div><Bar v={p.ev || 0} max={maxEv} /></td>
                  <td className="py-2 text-right mono" style={{ color: p.confidence >= 70 ? C.up : p.confidence >= 45 ? C.warn : C.down }}>{p.confidence}</td>
                  <td className="py-2 text-right mono" style={{ color: p.sinceEntryPct == null ? C.mute : p.sinceEntryPct >= 0 ? C.up : C.down }}>{p.sinceEntryPct != null ? `${p.sinceEntryPct >= 0 ? '+' : ''}${p.sinceEntryPct}%` : '–'}</td>
                  <td className="py-2 text-right pr-4 mono text-slate-400">{p.next ? p.next.date : '–'}</td>
                </tr>
                {open === p.ticker && <tr key={p.ticker + '-d'}><td colSpan={10} className="px-4 pb-4 pt-1 bg-slate-900/40"><Chips p={p} /><div className="mt-3"><PlayDetails p={p} color={color} /></div></td></tr>}
              </>))}
              {!plays.length && <tr><td colSpan={10} className="px-4 py-6 text-slate-500">Nothing on the board yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Box>
      <Box><Tabs list={tabList} /></Box>
    </div>
  );

  return (
    <div className="min-h-screen text-slate-200" style={{ background: 'radial-gradient(1000px 500px at 20% -10%, rgba(34,211,238,0.07), transparent), #020617' }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5">
        <Header />
        {active && <p className="text-[11px] text-slate-500 mb-4">{active.objective}</p>}
        <Leaderboard />
      </div>
    </div>
  );
}
