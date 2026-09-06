'use client';
import { useEffect, useState, useCallback } from 'react';

const fmtAgo = (ts) => { if (!ts) return 'never'; const m = Math.round((Date.now() - ts) / 60000); if (m < 1) return 'just now'; if (m < 60) return `${m}m ago`; const h = Math.round(m / 60); if (h < 48) return `${h}h ago`; return `${Math.round(h / 24)}d ago`; };
const Toggle = ({ on, onClick, color = '#10b981' }) => (
  <button onClick={onClick} className="w-11 h-6 rounded-full transition-colors shrink-0" style={{ background: on ? color : 'rgba(71,85,105,0.6)' }}>
    <div className="w-5 h-5 rounded-full bg-white transition-transform" style={{ transform: on ? 'translateX(22px)' : 'translateX(2px)' }} />
  </button>
);
const Card = ({ title, right, children, className = '' }) => (
  <div className={`rounded-2xl border p-5 ${className}`} style={{ background: 'rgba(15,23,42,0.6)', borderColor: 'rgba(51,65,85,0.5)' }}>
    {(title || right) && <div className="flex items-center justify-between mb-3"><h2 className="text-sm font-semibold text-slate-200">{title}</h2>{right}</div>}
    {children}
  </div>
);

export default function ThinkingPage() {
  const [cat, setCat] = useState('robotics');
  const [d, setD] = useState(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [openRun, setOpenRun] = useState(null);
  const [evFilter, setEvFilter] = useState('');

  const load = useCallback(async (c = cat) => {
    try { const r = await fetch(`/api/thinking?category=${c}`, { cache: 'no-store' }); const j = await r.json(); if (!j.error) setD(j); } catch (e) {}
  }, [cat]);
  useEffect(() => { try { const s = localStorage.getItem('vh_thinking_cat'); if (s) setCat(s); } catch (e) {} }, []);
  useEffect(() => { load(cat); try { localStorage.setItem('vh_thinking_cat', cat); } catch (e) {} const t = setInterval(() => load(cat), 60000); return () => clearInterval(t); }, [cat, load]);

  const post = async (body) => { setBusy(true); try { const r = await fetch('/api/thinking', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category: cat, ...body }) }); await r.json(); await load(cat); } catch (e) {} setBusy(false); };
  const cfg = d?.config || { engine: { enabled: true }, categories: {} };
  const st = d?.state || { plays: [], questions: [], evidence: [], runs: [], archive: [] };
  const cats = d?.categories || [];
  const active = cats.find(c => c.id === cat);
  const lastRun = st.runs?.[st.runs.length - 1];
  const running = st.currentRun && Date.now() - st.currentRun.startedAt < 90 * 60000;
  const evidence = [...(st.evidence || [])].reverse().filter(e => !evFilter || (e.ticker || '').includes(evFilter.toUpperCase()) || (e.finding || '').toLowerCase().includes(evFilter.toLowerCase()));

  return (
    <div className="min-h-screen text-slate-200" style={{ background: 'radial-gradient(1200px 600px at 20% -10%, rgba(34,211,238,0.08), transparent), #020617' }}>
      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-4">
            <a href="/" className="px-3 py-1.5 rounded-lg text-xs font-medium border" style={{ background: 'rgba(30,41,59,0.5)', borderColor: 'rgba(51,65,85,0.5)', color: '#94a3b8' }}>← ValueHunter</a>
            <div>
              <h1 className="text-xl font-semibold flex items-center gap-2"><span className="text-cyan-400">◉</span> Always Thinking</h1>
              <p className="text-xs text-slate-500">A Claude cloud routine (see claude.ai/code → Routines; each run also appears as a session in your claude.ai/code sidebar and the mobile app) reasons about each enabled category {cfg.cadence || 'every 4 hours'}: it asks itself the best next questions, fans research out to parallel subagents, red-teams its own favorites, and updates this board. Uses your Max subscription, not xAI credits.</p>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div className="text-right">
              <div className="text-xs font-medium" style={{ color: cfg.engine?.enabled ? '#34d399' : '#f87171' }}>Engine {cfg.engine?.enabled ? 'ON' : 'PAUSED'}</div>
              <div className="text-[11px] text-slate-500">{running ? <span className="text-cyan-400">thinking now…</span> : lastRun ? `last run ${fmtAgo(lastRun.endedAt)}` : 'no runs yet'}</div>
            </div>
            <Toggle on={!!cfg.engine?.enabled} onClick={() => post({ action: 'config', config: { engine: { enabled: !cfg.engine?.enabled } } })} />
            <div className="flex items-center gap-2 rounded-xl border px-3 py-1.5" style={{ borderColor: cfg.mode === 'deep' ? 'rgba(52,211,153,0.4)' : 'rgba(251,191,36,0.4)', background: cfg.mode === 'deep' ? 'rgba(52,211,153,0.06)' : 'rgba(251,191,36,0.06)' }} title="Read by the routine at the start of every run">
              <span className="text-[11px] text-slate-400">Run mode</span>
              <button onClick={() => post({ action: 'config', config: { mode: 'test' } })} className="text-xs font-semibold px-2 py-0.5 rounded" style={{ background: cfg.mode !== 'deep' ? 'rgba(251,191,36,0.25)' : 'transparent', color: cfg.mode !== 'deep' ? '#fbbf24' : '#64748b' }} title={`${cfg.budgets?.test?.cycles ?? 6} cycles of ${cfg.budgets?.test?.minutes ?? 5} min with ${cfg.budgets?.test?.pauseMinutes ?? 2} min pauses, every hour`}>Test · {cfg.budgets?.test?.minutes ?? 5}-min cycles</button>
              <button onClick={() => post({ action: 'config', config: { mode: 'deep' } })} className="text-xs font-semibold px-2 py-0.5 rounded" style={{ background: cfg.mode === 'deep' ? 'rgba(52,211,153,0.25)' : 'transparent', color: cfg.mode === 'deep' ? '#34d399' : '#64748b' }}>Deep · 60-75 min</button>
            </div>
            <a href="https://claude.ai/code/routines/trig_01KagnxmcSaRRff53hJ8g5fs" target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-lg text-xs font-medium border" style={{ background: 'rgba(30,41,59,0.5)', borderColor: 'rgba(51,65,85,0.5)', color: '#94a3b8' }} title="The Claude cloud routine that does the thinking - schedule, past runs, live sessions">Cloud routine ↗</a>
          </div>
        </div>

        <div className="flex items-center gap-2 mb-6 flex-wrap">
          {cats.map(c => { const on = cfg.categories?.[c.id]?.enabled; return (
            <div key={c.id} className="flex items-center gap-2 rounded-xl border px-3 py-2" style={{ borderColor: cat === c.id ? c.color : 'rgba(51,65,85,0.5)', background: cat === c.id ? `${c.color}12` : 'rgba(15,23,42,0.5)' }}>
              <button onClick={() => setCat(c.id)} className="text-sm font-medium" style={{ color: cat === c.id ? c.color : '#cbd5e1' }}>{c.label}</button>
              <span className="text-[10px] text-slate-500">{on ? 'active' : 'off'}</span>
              <Toggle on={!!on} color={c.color} onClick={() => post({ action: 'config', config: { categories: { [c.id]: { enabled: !on } } } })} />
            </div>
          ); })}
        </div>

        {active && <p className="text-xs text-slate-400 mb-5 max-w-4xl"><span className="text-slate-500">Objective:</span> {active.objective}</p>}

        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-12 lg:col-span-8 space-y-6">
            <Card title={`Best plays right now${st.plays?.length ? ` · ${st.plays.length}` : ''}`} right={st.updatedAt && <span className="text-[11px] text-slate-500">updated {fmtAgo(st.updatedAt)}</span>}>
              {!st.plays?.length && <p className="text-sm text-slate-500">Nothing yet. The first run will populate this. {!cfg.categories?.[cat]?.enabled && 'This category is switched off, so the engine skips it.'}</p>}
              <div className="space-y-3">
                {(st.plays || []).map(p => (
                  <div key={p.ticker} className="rounded-xl border p-4" style={{ background: 'rgba(2,6,23,0.5)', borderColor: 'rgba(51,65,85,0.5)' }}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-500 mono">#{p.rank}</span>
                          <span className="text-lg font-semibold" style={{ color: active?.color }}>{p.ticker}</span>
                          <span className="text-sm text-slate-400">{p.name}</span>
                          {p.inValueHunter && <span className="text-[10px] px-1.5 py-0.5 rounded border" style={{ color: '#34d399', borderColor: 'rgba(52,211,153,0.4)' }} title="Also in your ValueHunter eligible pool">in ValueHunter</span>}
                          {p.horizon && <span className="text-[10px] px-1.5 py-0.5 rounded border text-slate-400" style={{ borderColor: 'rgba(100,116,139,0.5)' }}>{p.horizon} swing</span>}
                          {p.sinceEntryPct != null && <span className="text-[10px] px-1.5 py-0.5 rounded border mono" style={{ color: p.sinceEntryPct >= 0 ? '#34d399' : '#f87171', borderColor: 'rgba(100,116,139,0.4)' }} title={`Entered the ranking at $${p.entryPrice} on ${new Date(p.entryAt).toLocaleDateString()}; now $${p.currentPrice}`}>{p.sinceEntryPct >= 0 ? '+' : ''}{p.sinceEntryPct}% since pick</span>}
                        </div>
                      </div>
                      <div className="text-right shrink-0 flex items-start gap-4">
                        {p.expectedMultiple != null && <div><div className="text-xs text-slate-500">target</div><div className="text-base font-semibold mono text-cyan-300">{p.expectedMultiple}x</div></div>}
                        {p.probability != null && <div><div className="text-xs text-slate-500">odds</div><div className="text-base font-semibold mono text-slate-200">{Math.round(p.probability * 100)}%</div></div>}
                        <div><div className="text-xs text-slate-500">confidence</div><div className="text-base font-semibold mono" style={{ color: p.confidence >= 70 ? '#34d399' : p.confidence >= 45 ? '#fbbf24' : '#f87171' }}>{p.confidence}</div></div>
                      </div>
                    </div>
                    {(p.timeframe || p.marketCapM || p.liquidity) && <div className="text-[11px] text-slate-500 mt-1">{[p.timeframe && `horizon ${p.timeframe}`, p.marketCapM && `cap $${p.marketCapM >= 1000 ? (p.marketCapM / 1000).toFixed(1) + 'B' : Math.round(p.marketCapM) + 'M'}`, p.liquidity && `liquidity ${p.liquidity}`].filter(Boolean).join(' · ')}</div>}
                    <p className="text-sm text-slate-300 mt-2 whitespace-pre-wrap">{p.thesis}</p>
                    {(p.setup || p.invalidation) && <div className="grid md:grid-cols-2 gap-3 mt-2 text-xs">
                      {p.setup && <div><span className="text-violet-300 font-medium">Entry setup:</span> <span className="text-slate-400">{p.setup}</span></div>}
                      {p.invalidation && <div><span className="text-rose-300 font-medium">Invalidation:</span> <span className="text-slate-400">{p.invalidation}</span></div>}
                    </div>}
                    <div className="grid md:grid-cols-2 gap-3 mt-3 text-xs">
                      {p.upsideCase && <div><span className="text-emerald-400 font-medium">Upside case:</span> <span className="text-slate-400">{p.upsideCase}</span></div>}
                      {(p.downsidePct != null || p.downsideCase) && <div><span className="text-rose-400 font-medium">If wrong{p.downsidePct != null ? ` (~${p.downsidePct}%)` : ''}:</span> <span className="text-slate-400">{p.downsideCase}</span></div>}
                      {p.catalysts && <div><span className="text-cyan-400 font-medium">Catalysts:</span> <span className="text-slate-400">{p.catalysts}</span></div>}
                      {p.risks && <div><span className="text-red-400 font-medium">Risks:</span> <span className="text-slate-400">{p.risks}</span></div>}
                      {p.changeMind && <div><span className="text-amber-400 font-medium">Would change my mind:</span> <span className="text-slate-400">{p.changeMind}</span></div>}
                    </div>
                    {!!p.sources?.length && <div className="mt-2 flex flex-wrap gap-2">{p.sources.map((s, i) => /^https?:/.test(s) ? <a key={i} href={s} target="_blank" rel="noreferrer" className="text-[11px] text-slate-500 hover:text-cyan-400 underline truncate max-w-[280px]">{s.replace(/^https?:\/\//, '')}</a> : <span key={i} className="text-[11px] text-slate-500">{s}</span>)}</div>}
                  </div>
                ))}
              </div>
            </Card>

            <Card title={`Evidence log · ${st.evidence?.length || 0}`} right={<input value={evFilter} onChange={e => setEvFilter(e.target.value)} placeholder="filter ticker / text" className="text-xs rounded-md px-2 py-1 border outline-none" style={{ background: 'rgba(30,41,59,0.6)', borderColor: 'rgba(51,65,85,0.6)' }} />}>
              {!evidence.length && <p className="text-sm text-slate-500">No findings yet.</p>}
              <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
                {evidence.slice(0, 120).map(e => (
                  <div key={e.id} className="text-xs border-l-2 pl-3 py-1" style={{ borderColor: e.impact === 'bullish' ? '#34d399' : e.impact === 'bearish' ? '#f87171' : '#64748b' }}>
                    <div className="flex items-center gap-2 text-slate-500"><span>{fmtAgo(e.at)}</span>{e.ticker && <span className="font-semibold text-slate-300">{e.ticker}</span>}<span className="uppercase text-[10px]">{e.impact}</span></div>
                    <div className="text-slate-300">{e.finding}</div>
                    {e.source && (/^https?:/.test(e.source) ? <a href={e.source} target="_blank" rel="noreferrer" className="text-slate-500 hover:text-cyan-400 underline">{e.source.replace(/^https?:\/\//, '').slice(0, 80)}</a> : <span className="text-slate-500">{e.source}</span>)}
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <div className="col-span-12 lg:col-span-4 space-y-6">
            <Card title={`Open questions · ${(st.questions?.length || 0) + (d?.inbox?.length || 0)}`}>
              <div className="flex gap-2 mb-3">
                <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && q.trim()) { post({ action: 'ask', question: q.trim() }); setQ(''); } }} placeholder="Ask the engine something for its next run…" className="flex-1 text-sm rounded-lg px-3 py-2 border outline-none" style={{ background: 'rgba(30,41,59,0.6)', borderColor: 'rgba(51,65,85,0.6)' }} />
                <button disabled={busy || !q.trim()} onClick={() => { post({ action: 'ask', question: q.trim() }); setQ(''); }} className="text-xs px-3 rounded-lg border" style={{ borderColor: 'rgba(34,211,238,0.4)', color: '#22d3ee' }}>Ask</button>
              </div>
              <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                {(d?.inbox || []).map(x => (
                  <div key={x.id} className="text-xs rounded-lg p-2 border" style={{ background: 'rgba(34,211,238,0.06)', borderColor: 'rgba(34,211,238,0.25)' }}>
                    <div className="flex justify-between gap-2"><span className="text-cyan-300 font-medium">You · answered next run</span><button onClick={() => post({ action: 'dismiss', id: x.id })} className="text-slate-500 hover:text-red-400">✕</button></div>
                    <div className="text-slate-200 mt-1">{x.question}</div>
                  </div>
                ))}
                {(st.questions || []).sort((a, b) => (a.priority || 3) - (b.priority || 3)).map(x => (
                  <div key={x.id} className="text-xs rounded-lg p-2 border" style={{ background: 'rgba(2,6,23,0.5)', borderColor: 'rgba(51,65,85,0.5)' }}>
                    <div className="flex justify-between gap-2 text-slate-500"><span>{x.angle || 'engine'} · P{x.priority || 3}</span><button onClick={() => post({ action: 'dismiss', id: x.id })} className="hover:text-red-400" title="drop this question">✕</button></div>
                    <div className="text-slate-200 mt-1">{x.question}</div>
                  </div>
                ))}
                {!(st.questions?.length || d?.inbox?.length) && <p className="text-sm text-slate-500">No open questions. Add one above; the next run answers it first.</p>}
              </div>
            </Card>

            {(() => { const items = (st.plays || []).flatMap(pl => (pl.catalystDates || []).map(c => ({ ...c, ticker: pl.ticker }))).filter(c => c.date).sort((a, b) => a.date.localeCompare(b.date)); return items.length ? (
              <Card title={`Upcoming catalysts · ${items.length}`}>
                <div className="space-y-1 max-h-[260px] overflow-y-auto pr-1">
                  {items.slice(0, 30).map((c, i) => { const past = c.date < new Date().toISOString().slice(0, 10); return <div key={i} className="text-xs flex gap-2"><span className="mono shrink-0" style={{ color: past ? '#64748b' : '#22d3ee' }}>{c.date}</span><span className="font-semibold text-slate-300">{c.ticker}</span><span className="text-slate-400">{c.what}</span></div>; })}
                </div>
              </Card>) : null; })()}
            <Card title="Next run plan">
              <p className="text-xs text-slate-300 whitespace-pre-wrap">{st.nextPlan || 'The engine writes its plan for the next run here.'}</p>
              {!!st.recommendedScans?.length && <div className="mt-3">
                <div className="text-xs text-slate-500 mb-1">Wants deep scans on (only runs if Automatic AI scanning is on):</div>
                <div className="flex flex-wrap gap-1">{st.recommendedScans.map(r => <span key={r.ticker} className="text-[11px] px-2 py-0.5 rounded border text-slate-300" style={{ borderColor: 'rgba(51,65,85,0.6)' }} title={r.why}>{r.ticker}</span>)}</div>
              </div>}
            </Card>

            <Card title={`Run history · ${st.runs?.length || 0}`}>
              {!st.runs?.length && <p className="text-sm text-slate-500">No runs yet.</p>}
              <div className="space-y-1 max-h-[300px] overflow-y-auto pr-1">
                {[...(st.runs || [])].reverse().map(r => (
                  <div key={r.id} className="text-xs">
                    <button onClick={() => setOpenRun(openRun === r.id ? null : r.id)} className="w-full text-left flex justify-between text-slate-400 hover:text-slate-200"><span>{fmtAgo(r.endedAt)} · {r.mode || 'run'} · {r.minutes}m · {r.plays} plays · {r.evidence} findings{r.searches ? ` · ${r.searches} searches` : ''}{r.model ? ` · ${r.model.replace('claude-', '')}` : ''}</span><span>{openRun === r.id ? '▾' : '▸'}</span></button>
                    {openRun === r.id && <div className="mt-1 space-y-2">
                      <p className="text-slate-300 whitespace-pre-wrap border-l-2 pl-2" style={{ borderColor: 'rgba(51,65,85,0.6)' }}>{r.summary || 'no summary'}</p>
                      {r.feedback && <p className="text-amber-200/90 whitespace-pre-wrap border-l-2 pl-2" style={{ borderColor: 'rgba(251,191,36,0.5)' }}><span className="font-semibold">Engine feedback on the harness:</span> {r.feedback}</p>}
                    </div>}
                  </div>
                ))}
              </div>
            </Card>

            {!!st.memo && <Card title="Engine notes (its own memory)">
              <p className="text-xs text-slate-300 whitespace-pre-wrap max-h-[360px] overflow-y-auto pr-1">{st.memo}</p>
            </Card>}
            {!!st.rejected?.length && <Card title={`Rejected names · ${st.rejected.length}`}>
              <div className="space-y-1 max-h-[260px] overflow-y-auto pr-1">
                {[...st.rejected].reverse().map(x => <div key={x.ticker} className="text-xs"><span className="text-slate-300 font-semibold">{x.ticker}</span> <span className="text-slate-500">{x.why}</span></div>)}
              </div>
            </Card>}
            {!!st.archive?.length && <Card title={`Answered questions · ${st.archive.length}`}>
              <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                {[...st.archive].reverse().slice(0, 40).map(x => (
                  <details key={x.id} className="text-xs"><summary className="text-slate-300 cursor-pointer">{x.question}</summary><p className="text-slate-400 mt-1 whitespace-pre-wrap pl-2 border-l-2" style={{ borderColor: 'rgba(51,65,85,0.6)' }}>{x.answer}</p></details>
                ))}
              </div>
            </Card>}
          </div>
        </div>
      </div>
    </div>
  );
}
