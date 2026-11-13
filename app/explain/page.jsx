'use client';
import { useEffect, useMemo, useState } from 'react';
import { Shell, Box, Tag, SearchBox, C, ago, verdictColor, levelLabel } from './ui';

export default function ExplainHome() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [cat, setCat] = useState('all');
  useEffect(() => { fetch('/api/explain').then(r => r.json()).then(d => d.error ? setErr(d.error) : setData(d)).catch(e => setErr(String(e))); }, []);

  const cats = useMemo(() => ['all', ...new Set((data?.stocks || []).map(s => s.category).filter(Boolean))], [data]);
  const stocks = (data?.stocks || []).filter(s => cat === 'all' || s.category === cat);
  const dayAgo = Date.now() - 36 * 3600e3;

  return (
    <Shell>
      <h1 className="text-2xl font-semibold text-slate-100 mb-1">Look up a stock. Watch the explainer.</h1>
      <p className="text-sm text-slate-400 mb-4">Each page is one researched stock: the video, the verdict, the numbers with sources, and what changed since last time.</p>
      <SearchBox autoFocus />

      {err && <p className="mt-6 text-sm" style={{ color: C.down }}>Could not load: {err}</p>}
      {!data && !err && <p className="mt-6 text-sm text-slate-500">Loading…</p>}

      {data && (
        <>
          <div className="flex items-center justify-between mt-8 mb-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Newest</h2>
            <div className="flex gap-1.5 flex-wrap justify-end">
              {cats.length > 2 && cats.map(c => (
                <button key={c} onClick={() => setCat(c)} className="text-[11px] px-2 py-1 rounded-full border" style={{ color: cat === c ? C.cyan : C.mute, borderColor: cat === c ? C.cyan : 'rgba(71,85,105,0.5)' }}>{c === 'all' ? 'All' : c}</button>
              ))}
            </div>
          </div>
          {stocks.length === 0 && <Box><p className="text-sm text-slate-400">No explainers yet. Type a ticker above to request the first one.</p></Box>}
          <div className="grid gap-3 sm:grid-cols-2">
            {stocks.map(s => (
              <a key={s.ticker} href={`/explain/${s.ticker}`} className="block rounded-2xl border p-4 hover:border-cyan-600 transition-colors" style={{ background: 'rgba(15,23,42,0.6)', borderColor: 'rgba(51,65,85,0.5)' }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2"><span className="text-lg font-semibold text-slate-100">{s.ticker}</span><span className="text-xs text-slate-400 truncate">{s.name}</span></div>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    {s.updatedAt > dayAgo && <Tag color={C.cyan}>New</Tag>}
                    {s.verdict && <Tag color={verdictColor(s.verdict)}>{s.verdict}</Tag>}
                  </div>
                </div>
                {s.oneLine && <p className="text-sm text-slate-300 mt-2 leading-snug">{s.oneLine}</p>}
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3 text-[11px] text-slate-500">
                  <span>{s.hasVideo ? `▶ Video${s.minutes ? ` · ${s.minutes} min` : ''}` : 'Research only'}</span>
                  <span>{levelLabel(s.level)}</span>
                  {s.asOf && <span>Figures as of {s.asOf}</span>}
                  <span>Updated {ago(s.updatedAt)}</span>
                </div>
                {s.lastChange && <p className="text-[11px] text-slate-400 mt-2">What changed ({s.lastChange.date}): {s.lastChange.text}</p>}
              </a>
            ))}
          </div>

          {data.requests.length > 0 && (
            <>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400 mt-8 mb-3">Requested, in the queue</h2>
              <div className="flex flex-wrap gap-2">
                {data.requests.slice(0, 40).map(r => (
                  <a key={r.ticker} href={`/explain/${r.ticker}`}><Tag color={r.status === 'researching' ? C.warn : C.mute}>{r.ticker}{r.count > 1 ? ` ×${r.count}` : ''}{r.status === 'researching' ? ' · researching' : ''}</Tag></a>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </Shell>
  );
}
