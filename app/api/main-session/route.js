// Main Session store: one canonical session shared across devices, kept in KV.
// GET  -> { session, universe_meta }   (?universe=1 adds the ticker universe)
// POST -> save the session object (same-origin only)
import { kvGetJSON, kvSetJSON, kvConfigured } from '../_lib/kv';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  if (!kvConfigured()) return Response.json({ session: null, error: 'KV not configured' });
  const url = new URL(request.url);
  const wantUniverse = url.searchParams.get('universe') === '1';
  const [session, universeMeta, watchlist] = await Promise.all([
    kvGetJSON('vh:main'),
    kvGetJSON('vh:universe:meta'),
    kvGetJSON('vh:watchlist'),
  ]);
  const out = { session, universe_meta: universeMeta, watchlist: watchlist || {} };
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
  const existing = (await kvGetJSON('vh:main')) || { stocks: [] };
  const merged = new Map((existing.stocks || []).map(s => [s.ticker, s]));
  for (const s of body.stocks) {
    const prev = merged.get(s.ticker) || {};
    merged.set(s.ticker, { ...prev, ...s });
  }
  const session = {
    id: 'main',
    name: 'Main Session',
    stocks: [...merged.values()],
    scanStats: body.scanStats || existing.scanStats || null,
    weights: body.weights || existing.weights || null,
    aiWeights: body.aiWeights || existing.aiWeights || null,
    timestamp: Date.now(),
  };
  await kvSetJSON('vh:main', session);
  return Response.json({ ok: true, stocks: session.stocks.length });
}
