// Scan job queue. Jobs run on the server (see /api/worker) so they survive
// page refreshes and closed tabs.
//   GET  ?id=... | (none)             -> one job | all recent jobs
//   POST {agentIds, tickers, model}    -> enqueue
//   POST {action:'pause'|'resume'|'cancel', id}
import { kvGetJSON, kvSetJSON, kvConfigured, wsKey, wsFrom } from '../_lib/kv';

export const dynamic = 'force-dynamic';

function sameOrigin(request) {
  const origin = request.headers.get('origin'), host = request.headers.get('host');
  try { return Boolean(origin && host && new URL(origin).host === host); } catch { return false; }
}

export async function GET(request) {
  if (!kvConfigured()) return Response.json({ jobs: [] });
  const ws = wsFrom(request);
  const jobs = (await kvGetJSON(wsKey(ws, 'jobs'))) || [];
  const id = new URL(request.url).searchParams.get('id');
  if (id) return Response.json({ job: jobs.find(j => j.id === id) || null });
  return Response.json({ jobs: jobs.slice(0, 20) });
}

export async function POST(request) {
  if (!kvConfigured()) return Response.json({ error: 'KV not configured' }, { status: 500 });
  if (!sameOrigin(request)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const ws = wsFrom(request, body);
  let jobs = (await kvGetJSON(wsKey(ws, 'jobs'))) || [];

  if (body.action && body.id) {
    const job = jobs.find(j => j.id === body.id);
    if (!job) return Response.json({ error: 'job not found' }, { status: 404 });
    if (body.action === 'pause' && (job.status === 'queued' || job.status === 'running')) job.status = 'paused';
    if (body.action === 'resume' && job.status === 'paused') job.status = 'queued';
    if (body.action === 'cancel') job.status = 'cancelled';
    if (body.action === 'model' && typeof body.model === 'string') job.model = body.model; // takes effect within a few stocks, no restart
    job.updatedAt = Date.now();
    await kvSetJSON(wsKey(ws, 'jobs'), jobs);
    return Response.json({ ok: true, job });
  }

  if (!Array.isArray(body.agentIds) || !Array.isArray(body.tickers) || body.agentIds.length === 0 || body.tickers.length === 0) {
    return Response.json({ error: 'agentIds[] and tickers[] required' }, { status: 400 });
  }
  const job = {
    id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    ws,
    agentIds: body.agentIds,
    tickers: body.tickers.slice(0, 500),
    model: body.model || 'grok-4.6',
    playbooks: body.playbooks || null,
    completed: {},
    status: 'queued',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    errors: 0,
  };
  jobs = [job, ...jobs].slice(0, 30);
  await kvSetJSON(wsKey(ws, 'jobs'), jobs);
  return Response.json({ ok: true, job });
}
