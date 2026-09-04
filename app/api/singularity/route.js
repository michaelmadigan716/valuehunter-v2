// POST /api/singularity?secret=CRON_SECRET  body {ws:'main'|'test', limit:100, model?, all?}
// Scores singularity relevance for unscored stocks in cheap batches and stores
// them in the per-workspace hash. Safe to call repeatedly until remaining=0.
import { kvGetJSON, kvConfigured, wsKey, wsFrom, kvHSetMany, kvHGetAllJSON } from '../_lib/kv';
import { getSettings } from '../_lib/settings';
import { scoreSingularityBatch, setApiBase } from '../../../lib/scanAgents';

export const maxDuration = 300;

export async function POST(request) {
  if (!kvConfigured()) return Response.json({ error: 'KV not configured' }, { status: 500 });
  const url = new URL(request.url);
  const secret = url.searchParams.get('secret') || request.headers.get('authorization')?.replace('Bearer ', '');
  const origin = request.headers.get('origin'); const host = request.headers.get('host');
  const sameOrigin = origin && host && new URL(origin).host === host;
  if (!sameOrigin && secret !== process.env.CRON_SECRET) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const ws = wsFrom(request, body);
  const limit = Math.min(300, Math.max(1, Number(body.limit) || 100));
  const settings = await getSettings();
  const model = body.model || settings.fastModel || 'grok-4.3';
  setApiBase(host?.startsWith('localhost') ? `http://${host}` : (process.env.APP_PUBLIC_URL || 'https://valuehunter-v2.vercel.app'));

  const key = wsKey(ws, 'singularity');
  const [main, have] = await Promise.all([kvGetJSON(wsKey(ws, 'main')), kvHGetAllJSON(key)]);
  const stocks = (main?.stocks || []).filter(s => typeof s.singularityScore !== 'number' && typeof have[s.ticker]?.singularityScore !== 'number');
  const pool = body.all ? stocks : stocks.filter(s => !s.tier || s.tier === 'A');
  const todo = pool.slice(0, limit);
  const batches = []; for (let i = 0; i < todo.length; i += 20) batches.push(todo.slice(i, i + 20));
  let scored = 0;
  for (let i = 0; i < batches.length; i += 5) {
    const results = await Promise.all(batches.slice(i, i + 5).map(b => scoreSingularityBatch(b, model)));
    for (const r of results) { const n = Object.keys(r).length; if (n) { await kvHSetMany(key, r); scored += n; } }
  }
  return Response.json({ ok: true, ws, model, scored, attempted: todo.length, remaining: Math.max(0, pool.length - todo.length) });
}
