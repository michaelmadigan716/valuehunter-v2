import { kvConfigured, wsFrom } from '../../_lib/kv';
import { runWeeklyPass } from '../../_lib/schedule';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorized(request) {
  const s = process.env.CRON_SECRET;
  return Boolean(s) && (request.headers.get('authorization') === `Bearer ${s}` || new URL(request.url).searchParams.get('secret') === s);
}
function sameOrigin(request) {
  const origin = request.headers.get('origin'), host = request.headers.get('host');
  try { return Boolean(origin && host && new URL(origin).host === host); } catch { return false; }
}
export async function GET(request) {
  if (!kvConfigured()) return Response.json({ error: 'KV not configured' }, { status: 500 });
  if (!authorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  return Response.json(await runWeeklyPass('main', { fromCron: true }));
}
export async function POST(request) {
  if (!kvConfigured()) return Response.json({ error: 'KV not configured' }, { status: 500 });
  if (!sameOrigin(request)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  return Response.json(await runWeeklyPass(wsFrom(request, body)));
}
