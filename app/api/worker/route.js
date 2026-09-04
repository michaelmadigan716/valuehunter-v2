// Job worker: runs queued scan jobs server-side, one stock at a time, writing
// results into the Main Session after every stock. Triggered every minute by
// cron and immediately ("kick") by the client after enqueueing.
import { kvGetJSON, kvSetJSON, kvDel, kvLock, kvConfigured, wsKey, kvHSetMany, kvHGetAllJSON, kvHGetJSON } from '../_lib/kv';
import { AGENT_DEFS, setApiBase, scoreSingularityBatch } from '../../../lib/scanAgents';
import { getSettings, autoScansOn, meetsEscalation, passesFreeGate, passesStage2, CHEAP_AGENTS, LIVE_SEARCH_AGENTS } from '../_lib/settings';

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

// Queue a smart-model deep re-scan for a stock that cleared a threshold on
// the fast pass. One open 'escalate' job per workspace collects them.
async function escalate(ws, ticker, settings) {
  const key = wsKey(ws, 'jobs');
  const jobs = (await kvGetJSON(key)) || [];
  let job = jobs.find(j => j.kind === 'escalate' && (j.status === 'queued' || j.status === 'running'));
  if (job) {
    if (job.tickers.includes(ticker)) return false;
    job.tickers.push(ticker); job.updatedAt = Date.now();
  } else {
    job = { id: `job_${Date.now()}_escalate`, ws, kind: 'escalate', agentIds: AGENT_DEFS.map(a => a.id), tickers: [ticker], model: settings.smartModel, playbooks: null, completed: {}, status: 'queued', createdAt: Date.now(), updatedAt: Date.now(), errors: 0 };
    jobs.unshift(job);
  }
  await kvSetJSON(key, jobs.slice(0, 30));
  return true;
}

async function runWorker(request) {
  const settings = await getSettings();
  if (!autoScansOn(settings)) return Response.json({ ok: true, paused: true, note: 'automatic scanning is off (Settings)' });
  if (!(await kvLock('vh:worker:lock', 290_000))) return Response.json({ ok: true, running: true });
  const deadline = Date.now() + TIME_BUDGET_MS;
  let escalated = 0;
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
    const order = (new Date().getUTCMinutes() % 2 === 0) ? ['main', 'test'] : ['test', 'main'];
    let turn = 0, idleTurns = 0;
    while (Date.now() < deadline) {
      // Both workspaces share the worker: round-robin, a few stocks per turn,
      // so Main and Test genuinely run at the same time.
      const ws = order[turn % order.length]; turn++;
      const jobs = (await kvGetJSON(wsKey(ws, 'jobs'))) || [];
      const found = [...jobs].reverse().find(j => j.status === 'queued' || j.status === 'running');
      if (!found) { if (++idleTurns >= order.length) break; continue; }
      idleTurns = 0;
      const job = { ...found, ws };
      const MAX_BATCHES_PER_TURN = 2; // two batches, then yield to the other workspace
      const wsMainKey = wsKey(job.ws, 'main');
      const wsResultsKey = wsKey(job.ws, 'scanres'); // HASH ticker -> JSON (per-field writes; concurrent stocks never clobber each other)
      job.status = 'running'; job.updatedAt = Date.now();
      await saveJob(job);

      const agents = AGENT_DEFS.filter(a => job.agentIds.includes(a.id));
      const main = (await kvGetJSON(wsMainKey)) || { stocks: [] };
      const byTicker = new Map(main.stocks.map(s => [s.ticker, s]));
      // Singularity scores live in their own hash (per-field writes, no clobbering)
      const sgKey = wsKey(job.ws, 'singularity');
      const sgAll = await kvHGetAllJSON(sgKey);
      for (const [t, v] of Object.entries(sgAll)) if (byTicker.has(t)) byTicker.set(t, { ...byTicker.get(t), ...v });
      const stagedJob = settings.staging?.enabled !== false && (job.kind === 'weekly' || job.kind === 'eligible-topup');
      // Score singularity for any batch stocks that lack it - ONE cheap call per batch
      const ensureSingularity = async (tickers) => {
        const need = tickers.map(t => byTicker.get(t)).filter(s => s && typeof s.singularityScore !== 'number');
        if (!need.length) return;
        const scored = await scoreSingularityBatch(need, settings.fastModel || 'grok-4.3');
        if (Object.keys(scored).length) {
          await kvHSetMany(sgKey, scored);
          for (const [t, v] of Object.entries(scored)) if (byTicker.has(t)) byTicker.set(t, { ...byTicker.get(t), ...v });
        }
      };
      let finished = true;

      // Stock-major processing: for each stock run every remaining agent
      // concurrently, two stocks at a time -> whole rows land together.
      const pending = job.tickers.filter(t => agents.some(a => !(job.completed[a.id] || []).includes(t)));
      let cursor = 0;
      const runOne = async (ticker) => {
        const remainingAgents = agents.filter(a => !(job.completed[a.id] || []).includes(ticker));
        const existingPatch = (await kvHGetJSON(wsResultsKey, ticker)) || {};
        const stock = byTicker.get(ticker) ? { ...byTicker.get(ticker), ...existingPatch } : null;
        let patch = {};
        // Staged scanning applies to the big fast-model passes only; targeted
        // passes (daily, escalate, manual) always run everything requested.
        const staged = settings.staging?.enabled !== false && (job.kind === 'weekly' || job.kind === 'eligible-topup');
        const skippedAgents = [];
        const runAgents = async (list) => Promise.all(list.map(async (agent) => {
          try {
            const result = await agent.fn({ ...stock, ...patch }, job.model, { playbooks: job.playbooks || undefined });
            const p = agent.apply({}, result);
            const junk = Object.values(p).some(v => typeof v === 'string' && /^(Error|API Error)/.test(v));
            if (junk) throw new Error('scan returned error text');
            return { agent, p };
          } catch (e) { job.errors++; return { agent, p: null }; }
        }));
        if (stock) {
          let results = [];
          if (staged) {
            const gate = passesFreeGate(stock, settings);
            if (!gate.ok) {
              // stage 0 failed: zero AI spend on this stock this pass
              skippedAgents.push(...remainingAgents);
              patch = { stagedOut: 'free-gate', stagedWhy: gate.why };
            } else {
              const cheap = remainingAgents.filter(a => CHEAP_AGENTS.includes(a.id));
              const pricey = remainingAgents.filter(a => LIVE_SEARCH_AGENTS.includes(a.id));
              results = await runAgents(cheap);
              for (const r of results) if (r.p) patch = { ...patch, ...r.p };
              if (pricey.length) {
                if (passesStage2({ ...stock, ...patch }, settings)) {
                  const more = await runAgents(pricey);
                  for (const r of more) if (r.p) patch = { ...patch, ...r.p };
                  results = results.concat(more);
                } else {
                  skippedAgents.push(...pricey);
                  patch.stagedOut = 'stage-2'; patch.stagedWhy = 'cheap scans did not clear the bar for live-search scans';
                }
              }
              if (!patch.stagedOut) { patch.stagedOut = null; patch.stagedWhy = null; }
            }
          } else {
            results = await runAgents(remainingAgents);
            for (const r of results) if (r.p) patch = { ...patch, ...r.p };
          }
          job.skipped = (job.skipped || 0) + skippedAgents.length;
          if (Object.keys(patch).length) {
            const current = (await kvHGetJSON(wsResultsKey, ticker)) || {};
            const scannedSomething = Object.keys(patch).some(k => !/^staged/.test(k));
            const merged = { ...current, ...patch, ...(scannedSomething ? { scannedAt: Date.now() } : {}) };
            // Dynamic strategy: a fast-model scan that clears a threshold earns a
            // smart-model deep re-scan (once per cooldown window)
            const fastPass = job.kind !== 'escalate' && job.model !== settings.smartModel;
            const cooled = !merged.escalatedAt || Date.now() - merged.escalatedAt > (settings.escalation?.cooldownDays || 7) * 864e5;
            if (settings.escalation?.enabled !== false && fastPass && cooled && meetsEscalation({ ...stock, ...merged }, settings)) {
              if (await escalate(job.ws, ticker, settings)) { merged.escalatedAt = Date.now(); escalated++; }
            }
            await kvHSetMany(wsResultsKey, { [ticker]: merged });
            byTicker.set(ticker, { ...stock, ...merged });
          }
          // mark every attempted OR staged-out agent complete for this stock
          // (failed ones are retried by the next pass, not looped on forever)
          for (const a of [...results.map(r => r.agent), ...skippedAgents]) { const done = new Set(job.completed[a.id] || []); done.add(ticker); job.completed[a.id] = [...done]; }
        } else {
          job.errors++;
          for (const a of remainingAgents) { const done = new Set(job.completed[a.id] || []); done.add(ticker); job.completed[a.id] = [...done]; }
        }
        job.updatedAt = Date.now();
        job.progress = { done: Object.values(job.completed).reduce((a, arr) => a + arr.length, 0), total: agents.length * job.tickers.length, agent: `${remainingAgents.length} scans`, ticker };
        await saveJob(job);
        processed++;
      };
      let batchesThisTurn = 0;
      while (cursor < pending.length) {
        if (Date.now() > deadline - 45_000) { finished = false; break; }
        if (batchesThisTurn >= MAX_BATCHES_PER_TURN) { finished = false; break; }
        batchesThisTurn++;
        const fresh = ((await kvGetJSON(wsKey(job.ws, 'jobs'))) || []).find(j => j.id === job.id);
        if (!fresh || fresh.status === 'paused' || fresh.status === 'cancelled') { job.status = fresh ? fresh.status : 'cancelled'; finished = false; break; }
        const batch = pending.slice(cursor, cursor + 15); // 15 stocks concurrently (x7 scans = 105 calls; account allows 6000/min)
        cursor += batch.length;
        if (stagedJob) await ensureSingularity(batch);
        await Promise.all(batch.map(runOne));
      }
      if (finished && cursor < pending.length) finished = false;
      if (finished) { job.status = 'done'; job.finishedAt = Date.now(); await saveJob(job); }
      else { await saveJob(job); } // yielded turn, out of time, paused or cancelled -> loop decides
    }
    return Response.json({ ok: true, processed, escalated });
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
