import { randomUUID } from 'node:crypto';
import { BETA_RUN_KEY, BETA_RESULTS_KEY, resultKey, selectTargets, stockContext, validateResult } from './codexBeta.mjs';

async function redis(...args) {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) throw new Error('Storage is not configured');
  const res = await fetch(process.env.KV_REST_API_URL, { method: 'POST', cache: 'no-store',
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  if (!res.ok) throw new Error(`Storage request failed (${res.status})`);
  const data = await res.json(); if (data.error) throw new Error('Storage command failed'); return data.result;
}
const parse = value => value ? JSON.parse(value) : null;
export async function betaState() {
  const [raw, flat] = await Promise.all([redis('GET', BETA_RUN_KEY), redis('HGETALL', BETA_RESULTS_KEY)]);
  const results = {}; for (let i = 0; i < (flat || []).length; i += 2) results[flat[i]] = parse(flat[i + 1]);
  return { run: parse(raw), results };
}
export async function session(ws) { return parse(await redis('GET', ws === 'test' ? 'vh:test:main' : 'vh:main')) || { stocks: [] }; }

// All run mutations use Redis CAS so pause/cancel cannot be overwritten by a
// stale worker. A claim is owned by a unique token and expires if a task stops.
async function mutate(fn) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const old = await redis('GET', BETA_RUN_KEY);
    const next = await fn(parse(old));
    if (!next) return null;
    const ok = await redis('EVAL', "local v=redis.call('GET',KEYS[1]); if (v or '')~=ARGV[1] then return 0 end; redis.call('SET',KEYS[1],ARGV[2]); return 1", 1, BETA_RUN_KEY, old || '', JSON.stringify(next));
    if (ok) return next;
  }
  throw new Error('Queue changed; please retry');
}
export async function control(action, opts = {}) {
  if (action === 'start') {
    const ws = opts.ws === 'test' ? 'test' : 'main';
    const limit = [3, 10, 25, 100].includes(Number(opts.limit)) ? Number(opts.limit) : 10;
    const [data, state] = await Promise.all([session(ws), betaState()]);
    const targets = selectTargets(data.stocks || [], state.results, ws, limit);
    if (!targets.length) throw new Error('No eligible stocks need a beta scan (seven-day freshness window)');
    return mutate(run => {
      if (run && ['running', 'paused'].includes(run.status)) throw new Error('Finish or cancel the existing beta batch first');
      return { id: randomUUID(), ws, targets, completed: [], status: 'running', createdAt: Date.now(), updatedAt: Date.now(), claim: null };
    });
  }
  if (!['pause', 'resume', 'cancel'].includes(action)) throw new Error('Unknown action');
  return mutate(run => {
    if (!run || !['running', 'paused'].includes(run.status)) throw new Error('No active beta batch');
    if (opts.id && opts.id !== run.id) throw new Error('Batch changed; refresh first');
    return { ...run, status: action === 'cancel' ? 'cancelled' : action === 'pause' ? 'paused' : 'running',
      claim: action === 'cancel' ? null : run.claim, updatedAt: Date.now() };
  });
}
export async function claim() {
  const token = randomUUID();
  const run = await mutate(run => {
    if (!run || run.status !== 'running' || (run.claim && run.claim.expiresAt > Date.now())) return null;
    const ticker = run.targets.find(t => !run.completed.includes(t));
    if (!ticker) return { ...run, status: 'complete', claim: null, updatedAt: Date.now() };
    return { ...run, claim: { ticker, token, expiresAt: Date.now() + 30 * 60e3 }, updatedAt: Date.now() };
  });
  if (!run?.claim || run.claim.token !== token) return { idle: true, reason: 'No available beta work' };
  const data = await session(run.ws);
  const stock = data.stocks.find(s => s.ticker === run.claim.ticker);
  if (!stock) throw new Error('Queued stock no longer exists in the session');
  return { runId: run.id, ws: run.ws, token, stock: stockContext(stock), capturedAt: new Date().toISOString() };
}
export async function complete(input) {
  const result = validateResult(input.result);
  result.scannedAt = Date.now();
  result.model = typeof input.model === 'string' ? input.model.slice(0, 100) : 'Codex (model not reported)';
  const raw = await redis('GET', BETA_RUN_KEY), run = parse(raw);
  if (!run || run.id !== input.runId || !['running', 'paused'].includes(run.status) || run.claim?.token !== input.token || run.claim?.ticker !== result.ticker || run.claim.expiresAt <= Date.now()) throw new Error('Claim expired or batch cancelled; result not saved');
  result.runId = run.id;
  const data = await session(run.ws);
  result.context = stockContext(data.stocks.find(s => s.ticker === result.ticker) || { ticker: result.ticker });
  const completed = [...new Set([...run.completed, result.ticker])];
  const next = { ...run, completed, claim: null, status: completed.length === run.targets.length ? 'complete' : run.status, updatedAt: Date.now() };
  const ok = await redis('EVAL', "if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end; redis.call('HSET',KEYS[2],ARGV[3],ARGV[4]); redis.call('SET',KEYS[1],ARGV[2]); return 1", 2, BETA_RUN_KEY, BETA_RESULTS_KEY, raw, JSON.stringify(next), resultKey(run.ws, result.ticker), JSON.stringify(result));
  if (!ok) throw new Error('Queue changed while saving; retry the same result');
  return { ok: true, ticker: result.ticker, completed: completed.length, total: run.targets.length };
}
