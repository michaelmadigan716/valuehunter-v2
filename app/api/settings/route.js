// Global app settings shared by the browser and the server jobs.
import { kvSetJSON, kvConfigured } from '../_lib/kv';
import { getSettings, modelFor } from '../_lib/settings';
export const dynamic = 'force-dynamic';

function sameOrigin(request) {
  const origin = request.headers.get('origin'), host = request.headers.get('host');
  try { return Boolean(origin && host && new URL(origin).host === host); } catch { return false; }
}

export async function GET() {
  const s = await getSettings();
  return Response.json({ settings: s, model: modelFor(s) });
}
export async function POST(request) {
  if (!kvConfigured()) return Response.json({ error: 'KV not configured' }, { status: 500 });
  if (!sameOrigin(request)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const current = await getSettings();
  const next = { ...current, ...(body.settings || {}) };
  await kvSetJSON('vh:settings', next);
  return Response.json({ settings: next, model: modelFor(next) });
}
