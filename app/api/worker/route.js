// Job worker: runs queued scan jobs server-side, one stock at a time, writing
// results into the Main Session after every stock. Triggered every minute by
// cron and immediately ("kick") by the client after enqueueing.
import { kvGetJSON, kvSetJSON, kvDel, kvLock, kvConfigured } from '../_lib/kv';
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
  const jobs = (await kvGetJSON('vh:jobs')) || [];
  const i = jobs.findIndex(j => j.id === job.id);
  if (i >= 0) jobs[i] = job; else jobs.unshift(job);
  await kvSetJSON('vh:jobs', jobs);
}

async function runWorker(request) {
  if (!(await kvLock('vh:worker:lock', 290_000))) return Response.json({ ok: true, running: true });
  const deadline = Date.now() + TIME_BUDGET_MS;
  // Call our own /api/grok on this deployment (server -> server, no Origin header)
  const host = request.headers.get('host');
  const proto = host && host.startsWith('localhost') ? 'http' : 'https';
  setApiBase(`${proto}://${host}`);
  let processed = 0;
  try {
    while (Date.now() < deadline) {
      const jobs = (await kvGetJSON('vh:jobs')) || [];
      const job = [...jobs].reverse().find(j => j.status === 'queued' || j.status === 'running');
      if (!job) break;
      job.status = 'running'; job.updatedAt = Date.now();
      await saveJob(job);

      const agents = AGENT_DEFS.filter(a => job.agentIds.includes(a.id));
      const main = (await kvGetJSON('vh:main')) || { stocks: [] };
      const byTicker = new Map(main.stocks.map(s => [s.ticker, s]));
      let finished = true;

      outer: for (const agent of agents) {
        const done = new Set(job.completed[agent.id] || []);
        for (const ticker of job.tickers) {
          if (done.has(ticker)) continue;
          if (Date.now() > deadline - 30_000) { finished = false; break outer; }
          // re-check control flags every stock
          const fresh = ((await kvGetJSON('vh:jobs')) || []).find(j => j.id === job.id);
          if (!fresh || fresh.status === 'paused' || fresh.status === 'cancelled') { job.status = fresh ? fresh.status : 'cancelled'; finished = false; break outer; }

          // Scan results live in their own single-writer blob (vh:scanresults)
          // and are overlaid onto the Main Session on read - so nothing else
          // that rewrites vh:main can ever clobber them.
          const existingPatch = ((await kvGetJSON('vh:scanresults')) || {})[ticker] || {};
          const stock = byTicker.get(ticker) ? { ...byTicker.get(ticker), ...existingPatch } : null;
          if (stock) {
            try {
              const result = await agent.fn(stock, job.model, { playbooks: job.playbooks || undefined });
              const patch = agent.apply({}, result);
              const all = (await kvGetJSON('vh:scanresults')) || {};
              all[ticker] = { ...(all[ticker] || {}), ...patch, scannedAt: Date.now() };
              await kvSetJSON('vh:scanresults', all);
              byTicker.set(ticker, { ...stock, ...patch });
            } catch (e) { job.errors++; }
          } else {
            job.errors++;
          }
          done.add(ticker);
          job.completed[agent.id] = [...done];
          job.updatedAt = Date.now();
          job.progress = { done: Object.values(job.completed).reduce((a, arr) => a + arr.length, 0), total: agents.length * job.tickers.length, agent: agent.label, ticker };
          await saveJob(job);
          processed++;
        }
      }
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
