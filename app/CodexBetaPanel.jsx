'use client';
import { useEffect, useState } from 'react';
import { BETA_METRICS } from '../lib/codexBeta.mjs';

export default function CodexBetaPanel({ source, onSource, workspace, onResults }) {
  const [run, setRun] = useState(null), [limit, setLimit] = useState(10), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [canControl, setCanControl] = useState(false), [password, setPassword] = useState('');
  useEffect(() => {
    let alive = true;
    async function refresh() {
      try {
        const res = await fetch('/api/codex-beta', { cache: 'no-store' });
        const data = await res.json(); if (!res.ok) throw new Error(data.error);
        if (alive) { setRun(data.run); onResults(data.results || {}); setCanControl(data.canControl); }
      } catch { if (alive) setError('Beta status unavailable. Showing the last loaded results.'); }
    }
    refresh(); const timer = setInterval(refresh, 15000);
    return () => { alive = false; clearInterval(timer); };
  }, [onResults]);
  async function act(action) {
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/codex-beta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, id: run?.id, ws: workspace, limit, ...(action === 'login' ? { password } : {}) }) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error); if (action === 'login') { setCanControl(true); setPassword(''); } else setRun(data.run);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  const active = run && ['running', 'paused'].includes(run.status);
  const working = run?.claim && run.claim.expiresAt > Date.now();
  return <section className="rounded-xl border border-slate-700 bg-slate-900/70 p-3 mb-4 text-sm">
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-slate-300 font-semibold">Table AI data</span>
      <div className="flex rounded-lg border border-slate-600 overflow-hidden" role="group" aria-label="Table AI data source">
        {[['grok', 'Grok'], ['chatgpt', 'ChatGPT Beta']].map(([id, label]) => <button key={id} aria-pressed={source === id} onClick={() => onSource(id)} className={`px-3 py-2 ${source === id ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}>{label}</button>)}
      </div>
      {run && <span className="text-xs text-slate-400">Beta · {run.ws} · {run.completed.length}/{run.targets.length} · {run.status === 'running' ? (working ? `Researching ${run.claim.ticker}` : 'Queued for Codex') : run.status}</span>}
    </div>
    {source === 'chatgpt' && <div className="mt-3 space-y-2">
      <p className="text-xs text-slate-400">One combined research pass per stock using Codex subscription usage. Separate saved results; no Grok calls. Missing evidence stays unscored. Prices, financials, insider buys and calculated technical opinion are shared market data.</p>
      <div className="flex flex-wrap items-center gap-2">
        {!canControl ? <form onSubmit={e => { e.preventDefault(); act('login'); }} className="flex flex-wrap items-center gap-2"><input aria-label="Existing trade-record site password" type="password" autoComplete="current-password" placeholder="Trade-record site password" value={password} onChange={e => setPassword(e.target.value)} className="rounded bg-slate-800 p-2 text-slate-200" /><button disabled={busy} className="px-3 py-2 rounded bg-slate-700 text-white">Unlock beta controls</button></form> : !active ? <><label className="text-xs text-slate-400">Batch <select aria-label="Beta batch size" value={limit} onChange={e => setLimit(Number(e.target.value))} className="ml-2 rounded bg-slate-800 p-2">{[3, 10, 25, 100].map(n => <option key={n} value={n}>{n} stocks</option>)}</select></label><button disabled={busy} onClick={() => act('start')} className="px-3 py-2 rounded bg-indigo-600 text-white">Queue beta batch</button></>
          : <><button disabled={busy} onClick={() => act(run.status === 'paused' ? 'resume' : 'pause')} className="px-3 py-2 rounded bg-slate-700 text-white">{run.status === 'paused' ? 'Resume beta' : 'Pause beta'}</button><button disabled={busy} onClick={() => act('cancel')} className="px-3 py-2 rounded border border-slate-600 text-slate-300">Cancel beta</button></>}
        <span className="text-xs text-slate-500">Eligible stocks only · skips beta results newer than 7 days</span>
      </div>
      <p className="text-xs text-slate-500">Codex must be available to process queued work. Refreshing this page keeps progress. Pause stops new stocks; an already-running assessment may finish. Cancel rejects late results.</p>
    </div>}
    {error && <p role="alert" className="mt-2 text-xs text-amber-400">{error}</p>}
  </section>;
}
export function BetaEvidence({ result }) {
  if (!result) return <p className="text-sm text-slate-400">No ChatGPT beta assessment yet. Existing Grok results are available through the Grok toggle.</p>;
  return <section className="space-y-4 text-sm" onClick={e => e.stopPropagation()}>
    <div><h3 className="font-semibold text-indigo-300">ChatGPT Beta · combined assessment</h3><p className="text-xs text-slate-500">{new Date(result.scannedAt).toLocaleString()} · {result.model} · scores are research ratings, not probabilities</p></div>
    <p className="text-slate-200">{result.summary}</p>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{BETA_METRICS.map(([key, label]) => { const a = result.assessments[key]; return <div key={key} className="rounded-lg border border-slate-700 p-3"><h4 className="text-slate-200 font-medium">{label} · {a.score ?? 'Insufficient evidence'}{a.score !== null ? '/100' : ''}</h4><p className="text-xs text-slate-500">Evidence confidence: {a.confidence}</p><p className="text-slate-400 mt-1">{a.reason}</p><div className="flex gap-2 mt-2">{a.sources.map(i => <a key={i} href={result.sources[i].url} target="_blank" rel="noreferrer" className="text-indigo-400 underline">Source {i + 1}</a>)}</div></div>; })}</div>
    <div><h4 className="text-amber-300">Risks / what could invalidate the thesis</h4><ul className="list-disc pl-5 text-slate-400">{result.risks.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
    <div><h4 className="text-slate-200">Next questions</h4><ul className="list-disc pl-5 text-slate-400">{result.nextQuestions.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
    <div className="text-xs text-slate-500">{result.sources.map((s, i) => <p key={i}><a href={s.url} target="_blank" rel="noreferrer" className="underline">{i + 1}. {s.title}</a> · published {s.publishedAt || 'date unknown'} · checked {s.accessedAt}</p>)}</div>
  </section>;
}
