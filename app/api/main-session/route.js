// Main Session store: one canonical session shared across devices, kept in KV.
// GET  -> { session, universe_meta }   (?universe=1 adds the ticker universe)
// POST -> save the session object (same-origin only)
import { kvGetJSON, kvSetJSON, kvConfigured } from '../_lib/kv';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  if (!kvConfigured()) return Response.json({ session: null, error: 'KV not configured' });
  const url = new URL(request.url);
  const wantUniverse = url.searchParams.get('universe') === '1';
  const [session, universeMeta] = await Promise.all([
    kvGetJSON('vh:main'),
    kvGetJSON('vh:universe:meta'),
  ]);
  const out = { session, universe_meta: universeMeta };
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
  if (!body || !Array.isArray(body.stocks)) {
    return Response.json({ error: 'session with stocks[] required' }, { status: 400 });
  }
  const session = {
    id: 'main',
    name: 'Main Session',
    stocks: body.stocks,
    scanStats: body.scanStats || null,
    weights: body.weights || null,
    aiWeights: body.aiWeights || null,
    timestamp: Date.now(),
  };
  await kvSetJSON('vh:main', session);
  return Response.json({ ok: true, stocks: session.stocks.length });
}
