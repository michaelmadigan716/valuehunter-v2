'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Shell, Box, Tag, SearchBox, C, ago, cleanTicker, verdictColor, levelLabel } from '../ui';

const Src = ({ s }) => {
  const url = typeof s === 'string' ? s : s?.url; const label = typeof s === 'string' ? null : s?.label;
  if (url && /^https?:/.test(url)) return <a href={url} target="_blank" rel="noreferrer" className="text-cyan-500/80 hover:text-cyan-400 underline break-words">{label || url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 70)}</a>;
  return <span>{label || url}</span>;
};
const money = (n) => n == null ? null : n >= 1e12 ? `$${(n / 1e12).toFixed(2)}T` : n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${Math.round(n / 1e6)}M` : `$${n}`;

function Video({ v }) {
  if (!v) return null;
  if (v.youtubeId) return (
    <div className="relative w-full overflow-hidden rounded-2xl border border-slate-800" style={{ paddingTop: '56.25%' }}>
      <iframe className="absolute inset-0 w-full h-full" src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.youtubeId)}`} title={v.title || 'Explainer video'} allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowFullScreen />
    </div>
  );
  if (v.mp4) return <video className="w-full rounded-2xl border border-slate-800" src={v.mp4} controls preload="metadata" />;
  return null;
}

function Missing({ ticker, request }) {
  const [req, setReq] = useState(request);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const ask = async () => {
    setBusy(true); setErr(null);
    try { const r = await fetch('/api/explain', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'request', ticker }) }); const d = await r.json(); if (d.error) setErr(d.error); else setReq(d.request || { status: 'queued', count: 1 }); }
    catch (e) { setErr(String(e)); } finally { setBusy(false); }
  };
  return (
    <Box className="mt-6">
      <h1 className="text-xl font-semibold text-slate-100">{ticker}: no explainer yet</h1>
      {req ? (
        <p className="text-sm text-slate-300 mt-2">{req.status === 'researching' ? 'Research on this stock is under way.' : `It is in the queue${req.count > 1 ? ` (${req.count} requests)` : ''}.`} Check back here; the page fills in when the research is published.</p>
      ) : (
        <>
          <p className="text-sm text-slate-300 mt-2">Nobody has researched this one yet. Ask for it and it joins the queue.</p>
          <button onClick={ask} disabled={busy} className="mt-3 rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50" style={{ background: C.cyan, color: '#02202a' }}>{busy ? 'Sending…' : `Request ${ticker}`}</button>
        </>
      )}
      {err && <p className="text-sm mt-2" style={{ color: C.down }}>{err}</p>}
    </Box>
  );
}

export default function StockPage() {
  const ticker = cleanTicker(decodeURIComponent(useParams()?.ticker || ''));
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { if (!ticker) return; fetch(`/api/explain?ticker=${encodeURIComponent(ticker)}`).then(r => r.json()).then(d => d.error ? setErr(d.error) : setData(d)).catch(e => setErr(String(e))); }, [ticker]);
  const s = data?.stock;

  return (
    <Shell>
      <SearchBox initial="" />
      {err && <p className="mt-6 text-sm" style={{ color: C.down }}>Could not load: {err}</p>}
      {!data && !err && <p className="mt-6 text-sm text-slate-500">Loading {ticker}…</p>}
      {data && !s && <Missing ticker={ticker} request={data.request} />}
      {s && (
        <div className="mt-6 space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="flex items-baseline gap-3 flex-wrap"><h1 className="text-3xl font-semibold text-slate-100">{s.ticker}</h1><span className="text-slate-400">{s.name}</span></div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-xs text-slate-500">
                {s.asOf && <span>Figures as of {s.asOf}</span>}
                {s.price != null && <span>Price then ${s.price}</span>}
                {s.marketCap != null && <span>Market value then {money(s.marketCap)}</span>}
                <span>Updated {ago(s.updatedAt)}</span>
              </div>
            </div>
            <div className="flex gap-1.5">
              {s.category && <Tag>{s.category}</Tag>}
              <Tag>{levelLabel(s.level)}</Tag>
              {s.verdict?.label && <Tag color={verdictColor(s.verdict.label)}>{s.verdict.label}</Tag>}
            </div>
          </div>

          {s.verdict?.oneLine && <p className="text-lg text-slate-100 leading-snug">{s.verdict.oneLine}</p>}

          <Video v={s.video} />
          {s.video?.publishedAt && <p className="text-[11px] text-slate-500 -mt-2">Video published {s.video.publishedAt}{s.video.minutes ? ` · ${s.video.minutes} min` : ''}. Anything newer is in "What changed" below.</p>}

          {(s.changes || []).length > 0 && (
            <Box title="What changed">
              <ul className="space-y-1.5 text-sm">{s.changes.slice(0, 8).map((c, i) => <li key={i} className="flex gap-3"><span className="text-slate-500 mono shrink-0 text-xs pt-0.5">{c.date}</span><span className="text-slate-300">{c.text}</span></li>)}</ul>
            </Box>
          )}

          {s.summary && <Box title="The short version"><p className="text-sm text-slate-300 leading-relaxed whitespace-pre-line">{s.summary}</p></Box>}

          {(s.facts || []).length > 0 && (
            <Box title="Key numbers">
              <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                {s.facts.map((f, i) => (
                  <div key={i} className="flex items-baseline justify-between gap-3 border-b border-slate-800/70 pb-1.5">
                    <span className="text-xs text-slate-400">{f.label}{f.source && <> · <span className="text-[10px]"><Src s={f.source} /></span></>}</span>
                    <span className="text-sm font-semibold mono text-slate-100 text-right">{f.value}</span>
                  </div>
                ))}
              </div>
            </Box>
          )}

          {(s.sections || []).map((sec, i) => (
            <Box key={i} title={sec.title}><p className="text-sm text-slate-300 leading-relaxed whitespace-pre-line">{sec.body}</p></Box>
          ))}

          {(s.scenarios || []).length > 0 && (
            <Box title="Three routes (illustrations, not predictions)">
              <div className="grid gap-3 sm:grid-cols-3">
                {s.scenarios.map((sc, i) => (
                  <div key={i} className="rounded-xl border border-slate-800 p-3">
                    <div className="flex items-center justify-between"><span className="text-sm font-semibold text-slate-100">{sc.name}</span>{sc.odds && <span className="text-xs text-slate-400">{sc.odds}</span>}</div>
                    {sc.outcome && <div className="text-base font-semibold mono mt-1" style={{ color: C.cyan }}>{sc.outcome}</div>}
                    {sc.how && <p className="text-xs text-slate-400 mt-1 leading-snug">{sc.how}</p>}
                  </div>
                ))}
              </div>
            </Box>
          )}

          {(s.risks || []).length > 0 && <Box title="Risks"><ul className="list-disc pl-5 space-y-1 text-sm text-slate-300">{s.risks.map((r, i) => <li key={i}>{r}</li>)}</ul></Box>}

          {(s.watch || []).length > 0 && (
            <Box title="Dates to watch">
              <ul className="space-y-1.5 text-sm">{s.watch.map((w, i) => <li key={i} className="flex gap-3"><span className="text-slate-500 mono shrink-0 text-xs pt-0.5">{w.date}</span><span className="text-slate-300">{w.event}</span></li>)}</ul>
            </Box>
          )}

          {(s.sources || []).length > 0 && <Box title="Sources"><ul className="space-y-1 text-xs text-slate-400">{s.sources.map((x, i) => <li key={i}><Src s={x} /></li>)}</ul></Box>}

          {s.disclosure && <p className="text-xs text-slate-500">{s.disclosure}</p>}
        </div>
      )}
    </Shell>
  );
}
