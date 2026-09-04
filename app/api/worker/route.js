// Job worker: runs queued scan jobs server-side, one stock at a time, writing
// results into the Main Session after every stock. Triggered every minute by
// cron and immediately ("kick") by the client after enqueueing.
import { kvGetJSON, kvSetJSON, kvDel, kvLock, kvConfigured, wsKey } from '../_lib/kv';
import { AGENT_DEFS, setApiBase } from '../../../lib/scanAgents';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const TIME_BUDGET_MS = 250_000;

function authorized(request) {
  const s = process.env.CRON_SECRET;
  return Boolean(s) && (request.headers.get('authorization') === `Bearer ${s}` || new URL(request.url).searchParams.get('secret') === s);
}
function sameOrigin(request) {
  const origin = request.headers.get('origin'), host = request.headers.get('host');
  try { return Boolean(origin && host && new URL(origin).host === host); } catch { return false; }
}

async function saveJob(job) {
  const key = wsKey(job.ws || 'main', 'jobs');
  const jobs = (await kvGetJSON(key)) || [];
  const i = jobs.findIndex(j => j.id === job.id);
  if (i >= 0) jobs[i] = job; else jobs.unshift(job);
  await kvSetJSON(key, jobs);
}

async function runWorker(request) {
  if (!(await kvLock('vh:worker:lock', 290_000))) return Response.json({ ok: true, running: true });
  const deadline = Date.now() + TIME_BUDGET_MS;
  // Call our own /api/grok server -> server. Always use the PUBLIC production
  // URL: cron invocations arrive on deployment-specific hosts that sit behind
  // Vercel deployment protection, so calling back through that host returns
  // an auth page instead of JSON.
  const host = request.headers.get('host') || '';
  const base = host.startsWith('localhost')
    ? `http://${host}`
    : (process.env.APP_PUBLIC_URL || 'https://valuehunter-v2.vercel.app');
  setApiBase(base);
  let processed = 0;
  try {
    while (Date.now() < deadline) {
      // Both workspaces share the worker; test jobs are small so alternate fairly
      let job = null;
      for (const ws of ['test', 'main']) {
        const jobs = (await kvGetJSON(wsKey(ws, 'jobs'))) || [];
        const found = [...jobs].reverse().find(j => j.status === 'queued' || j.status === 'running');
        if (found) { job = { ...found, ws }; break; }
      }
      if (!job) break;
      const wsMainKey = wsKey(job.ws, 'main');
      const wsResultsKey = wsKey(job.ws, 'scanresults');
      job.status = 'running'; job.updatedAt = Date.now();
      await saveJob(job);

      const agents = AGENT_DEFS.filter(a => job.agentIds.includes(a.id));
      const main = (await kvGetJSON(wsMainKey)) || { stocks: [] };
      const byTicker = new Map(main.stocks.map(s => [s.ticker, s]));
      let finished = true;

      // Stock-major processing: for each stock run every remaining agent
      // concurrently, two stocks at a time -> whole rows land together.
      const pending = job.tickers.filter(t => agents.some(a => !(job.completed[a.id] || []).includes(t)));
      let cursor = 0;
      const runOne = async (ticker) => {
        const remainingAgents = agents.filter(a => !(job.completed[a.id] || []).includes(ticker));
        const existingPatch = ((await kvGetJSON(wsResultsKey)) || {})[ticker] || {};
        const stock = byTicker.get(ticker) ? { ...byTicker.get(ticker), ...existingPatch } : null;
        let patch = {};
        if (stock) {
          const results = await Promise.all(remainingAgents.map(async (agent) => {
            try {
              const result = await agent.fn(stock, job.model, { playbooks: job.playbooks || undefined });
              const p = agent.apply({}, result);
              const junk = Object.values(p).some(v => typeof v === 'string' && /^(Error|API Error)/.test(v));
              if (junk) throw new Error('scan returned error text');
              return { agent, p };
            } catch (e) { job.errors++; return { agent, p: null }; }
          }));
          for (const r of results) if (r.p) patch = { ...patch, ...r.p };
          if (Object.keys(patch).length) {
            const all = (await kvGetJSON(wsResultsKey)) || {};
            all[ticker] = { ...(all[ticker] || {}), ...patch, scannedAt: Date.now() };
            await kvSetJSON(wsResultsKey, all);
            byTicker.set(ticker, { ...stock, ...patch });
          }
          // mark every attempted agent complete for this stock (failed ones
          // are retried by the next pass, not looped on forever)
          for (const r of results) { const done = new Set(job.completed[r.agent.id] || []); done.add(ticker); job.completed[r.agent.id] = [...done]; }
        } else {
          job.errors++;
          for (const a of remainingAgents) { const done = new Set(job.completed[a.id] || []); done.add(ticker); job.completed[a.id] = [...done]; }
        }
        job.updatedAt = Date.now();
        job.progress = { done: Object.values(job.completed).reduce((a, arr) => a + arr.length, 0), total: agents.length * job.tickers.length, agent: `${remainingAgents.length} scans`, ticker };
        await saveJob(job);
        processed++;
      };
      while (cursor < pending.length) {
        if (Date.now() > deadline - 45_000) { finished = false; break; }
        const fresh = ((await kvGetJSON(wsKey(job.ws, 'jobs'))) || []).find(j => j.id === job.id);
        if (!fresh || fresh.status === 'paused' || fresh.status === 'cancelled') { job.status = fresh ? fresh.status : 'cancelled'; finished = false; break; }
        const batch = pending.slice(cursor, cursor + 2);
        cursor += batch.length;
        await Promise.all(batch.map(runOne));
      }
      if (finished && cursor < pending.length) finished = false;
      if (finished) { job.status = 'done'; job.finishedAt = Date.now(); await saveJob(job); }
      else if (job.status === 'running') { await saveJob(job); break; } // out of time; next tick continues
      else { await saveJob(job); } // paused/cancelled -> look for another job
    }
    return Response.json({ ok: true, processed });
  } finally {
    await kvDel('vh:worker:lock');
  }
}

export async function GET(request) {
  if (!kvConfigured()) return Response.json({ error: 'KV not configured' }, { status: 500 });
  if (!authorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  return runWorker(request);
}
export async function POST(request) {
  if (!kvConfigured()) return Response.json({ error: 'KV not configured' }, { status: 500 });
  if (!sameOrigin(request)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  return runWorker(request);
}
