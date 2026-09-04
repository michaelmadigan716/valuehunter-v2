// Main Session store: one canonical session shared across devices, kept in KV.
// GET  -> { session, universe_meta }   (?universe=1 adds the ticker universe)
// POST -> save the session object (same-origin only)
import { kvGetJSON, kvSetJSON, kvConfigured, wsKey, wsFrom, kvHGetAllJSON } from '../_lib/kv';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  if (!kvConfigured()) return Response.json({ session: null, error: 'KV not configured' });
  const url = new URL(request.url);
  const ws = wsFrom(request);
  const wantUniverse = url.searchParams.get('universe') === '1';
  const [session, universeMeta, watchlist, scanResults, singularity] = await Promise.all([
    kvGetJSON(wsKey(ws, 'main')),
    kvGetJSON('vh:universe:meta'),
    kvGetJSON('vh:watchlist'),
    kvGetJSON(wsKey(ws, 'scanresults')),
    kvHGetAllJSON(wsKey(ws, 'singularity')),
  ]);
  // Overlay singularity scores (hash) then server-side scan results (single-writer blob)
  if (session?.stocks) {
    session.stocks = session.stocks.map(s => ({ ...s, ...(singularity?.[s.ticker] || {}), ...(scanResults?.[s.ticker] || {}) }));
  }
  const out = { ws, session, universe_meta: universeMeta, watchlist: watchlist || {} };
  if (wantUniverse) out.universe = await kvGetJSON('vh:universe');
  return Response.json(out);
}

export async function POST(request) {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (origin && host && new URL(origin).host !== host) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!kvConfigured()) return Response.json({ error: 'KV not configured' }, { status: 500 });
  const body = await request.json();
  const ws = wsFrom(request, body);

  // Seed the Test workspace with the top-N Hunt-tier stocks from Main
  if (body && body.action === 'seed') {
    const main = (await kvGetJSON('vh:main')) || { stocks: [] };
    const n = Math.min(500, Math.max(10, parseInt(body.n) || 100));
    const picked = [...main.stocks]
      .filter(s => s.tier === 'A' || !s.tier)
      .sort((a, b) => (b.compositeScore || 0) - (a.compositeScore || 0))
      .slice(0, n)
      .map(({ aiAnalysis, ...s }) => ({ ...s, aiAnalysis: null }));
    const session = { id: ws, name: ws === 'test' ? 'Test Session' : 'Main Session', stocks: picked, timestamp: Date.now() };
    await kvSetJSON(wsKey(ws, 'main'), session);
    await kvSetJSON(wsKey(ws, 'scanresults'), {});
    return Response.json({ ok: true, seeded: picked.length });
  }

  // Manual watch toggle from the table star
  if (body && body.action === 'watch' && body.ticker) {
    const watchlist = (await kvGetJSON('vh:watchlist')) || {};
    if (body.on) watchlist[body.ticker] = { route: 'manual', reason: 'Starred by you', addedAt: Date.now(), name: body.name || body.ticker };
    else delete watchlist[body.ticker];
    await kvSetJSON('vh:watchlist', watchlist);
    return Response.json({ ok: true, watchlist });
  }

  if (!body || !Array.isArray(body.stocks)) {
    return Response.json({ error: 'session with stocks[] required' }, { status: 400 });
  }
  // MERGE into the existing Main Session: incoming stocks overwrite matching
  // tickers (client-side scan results win), server-added stocks are kept.
  const existing = (await kvGetJSON(wsKey(ws, 'main'))) || { stocks: [] };
  const merged = new Map((existing.stocks || []).map(s => [s.ticker, s]));
  for (const s of body.stocks) {
    const prev = merged.get(s.ticker) || {};
    merged.set(s.ticker, { ...prev, ...s });
  }
  const session = {
    id: ws,
    name: ws === 'test' ? 'Test Session' : 'Main Session',
    stocks: [...merged.values()],
    scanStats: body.scanStats || existing.scanStats || null,
    weights: body.weights || existing.weights || null,
    aiWeights: body.aiWeights || existing.aiWeights || null,
    timestamp: Date.now(),
  };
  await kvSetJSON(wsKey(ws, 'main'), session);
  return Response.json({ ok: true, ws, stocks: session.stocks.length });
}
