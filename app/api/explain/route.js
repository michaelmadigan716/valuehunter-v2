// StockVids: one research file per stock, written by Claude research
// sessions (subscription, not the API) and rendered at /explain.
//
// GET  /api/explain                 -> { stocks:[index rows, newest first], requests:[...] }
// GET  /api/explain?ticker=MOD      -> { stock | null, request | null }
// POST /api/explain (same-origin UI): { action:'request', ticker }
// POST /api/explain (runner, Authorization: Bearer EXPLAIN_SECRET or THINKING_SECRET):
//        { action:'publish', stock:{...} }  upsert a research file (see explain/HARNESS.md)
//        { action:'claim',   ticker }       mark a request as being researched
//        { action:'remove',  ticker }       delete a research file
import { kvHSetMany, kvHGetJSON, kvHGetAllJSON, kvHDel, kvConfigured } from '../_lib/kv';

export const maxDuration = 30;

const STOCKS = 'vh:explain:stocks';
const REQUESTS = 'vh:explain:requests';
const MAX_PENDING = 300;

const cleanTicker = (t) => {
  const s = String(t || '').trim().toUpperCase().replace(/^\$/, '');
  return /^[A-Z0-9][A-Z0-9.\-]{0,9}$/.test(s) ? s : null;
};
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

function isRunner(request) {
  const auth = request.headers.get('authorization') || '';
  const secrets = [process.env.EXPLAIN_SECRET, process.env.THINKING_SECRET].filter(Boolean);
  return secrets.some(s => auth === `Bearer ${s}`);
}

// What the list view needs; the full file is fetched per ticker.
const indexRow = (s) => ({
  ticker: s.ticker, name: s.name || s.ticker, category: s.category || null, level: s.level || 'brief',
  asOf: s.asOf || null, updatedAt: s.updatedAt || null, price: s.price ?? null,
  verdict: s.verdict?.label || null, oneLine: s.verdict?.oneLine || s.summary?.slice(0, 160) || null,
  hasVideo: Boolean(s.video?.youtubeId || s.video?.mp4), minutes: s.video?.minutes || null,
  lastChange: (s.changes || [])[0] || null,
});

export async function GET(request) {
  if (!kvConfigured()) return json({ error: 'storage not configured' }, 503);
  const q = new URL(request.url).searchParams;
  if (q.get('ticker')) {
    const ticker = cleanTicker(q.get('ticker'));
    if (!ticker) return json({ error: 'bad ticker' }, 400);
    const [stock, req] = await Promise.all([kvHGetJSON(STOCKS, ticker), kvHGetJSON(REQUESTS, ticker)]);
    return json({ stock: stock || null, request: req || null });
  }
  const [all, reqs] = await Promise.all([kvHGetAllJSON(STOCKS), kvHGetAllJSON(REQUESTS)]);
  const stocks = Object.values(all).map(indexRow).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const requests = Object.values(reqs).filter(r => r.status !== 'done' && !all[r.ticker])
    .sort((a, b) => (b.count || 0) - (a.count || 0) || (a.firstAt || 0) - (b.firstAt || 0));
  return json({ stocks, requests });
}

export async function POST(request) {
  if (!kvConfigured()) return json({ error: 'storage not configured' }, 503);
  let body; try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
  const action = body?.action;

  if (action === 'request') {
    const ticker = cleanTicker(body.ticker);
    if (!ticker) return json({ error: 'bad ticker' }, 400);
    if (await kvHGetJSON(STOCKS, ticker)) return json({ ok: true, exists: true });
    const prev = await kvHGetJSON(REQUESTS, ticker);
    if (!prev) {
      const pending = Object.values(await kvHGetAllJSON(REQUESTS)).filter(r => r.status !== 'done').length;
      if (pending >= MAX_PENDING) return json({ error: 'request queue is full' }, 429);
    }
    const now = Date.now();
    const rec = prev ? { ...prev, count: Math.min((prev.count || 1) + 1, 9999), lastAt: now }
      : { ticker, count: 1, firstAt: now, lastAt: now, status: 'queued' };
    await kvHSetMany(REQUESTS, { [ticker]: rec });
    return json({ ok: true, request: rec });
  }

  if (!isRunner(request)) return json({ error: 'unauthorized' }, 401);

  if (action === 'publish') {
    const s = body.stock || {};
    const ticker = cleanTicker(s.ticker);
    if (!ticker) return json({ error: 'bad ticker' }, 400);
    if (!s.summary && !s.verdict?.oneLine) return json({ error: 'stock needs a summary or verdict.oneLine' }, 400);
    const prev = (await kvHGetJSON(STOCKS, ticker)) || {};
    // changes: newest first; a publish may pass `change` (one line) instead of the whole log
    let changes = Array.isArray(s.changes) ? s.changes : (prev.changes || []);
    if (s.change) changes = [{ date: new Date().toISOString().slice(0, 10), text: String(s.change).slice(0, 400) }, ...changes];
    const { change, ...rest } = s;
    const rec = { ...prev, ...rest, ticker, changes: changes.slice(0, 50), createdAt: prev.createdAt || Date.now(), updatedAt: Date.now() };
    await kvHSetMany(STOCKS, { [ticker]: rec });
    const req = await kvHGetJSON(REQUESTS, ticker);
    if (req) await kvHSetMany(REQUESTS, { [ticker]: { ...req, status: 'done', doneAt: Date.now() } });
    return json({ ok: true, ticker, updatedAt: rec.updatedAt });
  }

  if (action === 'claim') {
    const ticker = cleanTicker(body.ticker);
    const req = ticker && await kvHGetJSON(REQUESTS, ticker);
    if (!req) return json({ error: 'no such request' }, 404);
    await kvHSetMany(REQUESTS, { [ticker]: { ...req, status: 'researching', claimedAt: Date.now() } });
    return json({ ok: true });
  }

  if (action === 'remove') {
    const ticker = cleanTicker(body.ticker);
    if (!ticker) return json({ error: 'bad ticker' }, 400);
    await kvHDel(STOCKS, ticker);
    return json({ ok: true });
  }

  return json({ error: 'unknown action' }, 400);
}
