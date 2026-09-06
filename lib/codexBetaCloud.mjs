import { timingSafeEqual } from 'node:crypto';
import { betaState, claim, complete } from './codexBetaStore.mjs';

export function cloudAuthorized(request) {
  const secret = process.env.CODEX_BETA_CLOUD_SECRET;
  if (!secret || secret.length < 32) return false;
  const header = request.headers.get('authorization') || '';
  const actual = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// No queue creation, model execution, arbitrary Redis commands or URLs here.
// A cloud researcher can only consume work the owner has already queued.
export async function cloudRequest(request) {
  const headers = { 'Cache-Control': 'no-store' };
  if (!cloudAuthorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401, headers });
  try {
    if (request.method === 'GET') {
      const { run } = await betaState();
      return Response.json({ connected: true, run: run ? {
        id: run.id, ws: run.ws, status: run.status,
        completed: run.completed.length, total: run.targets.length,
        currentTicker: run.claim?.ticker || null,
      } : null }, { headers });
    }
    if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers });
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 100_000) return Response.json({ error: 'Result too large' }, { status: 413, headers });
    const body = JSON.parse(raw);
    if (body.action === 'claim') return Response.json(await claim(), { headers });
    if (body.action === 'complete') return Response.json(await complete(body), { headers });
    return Response.json({ error: 'Only claim and complete are supported' }, { status: 400, headers });
  } catch {
    return Response.json({ error: 'Request failed; check result schema and active claim before retrying' }, { status: 409, headers });
  }
}
