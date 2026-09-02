// Builds and enqueues scheduled deep-scan jobs.
import { kvGetJSON, kvSetJSON, wsKey } from './kv';
import { getSettings, wsConfig } from './settings';

const ALL_AGENTS = ['conviction', 'technical', 'valuation', 'momentum', 'buyout', 'leadership', 'playbook'];

async function loadStocksWithResults(ws) {
  const [main, results, watchlist] = await Promise.all([kvGetJSON(wsKey(ws, 'main')), kvGetJSON(wsKey(ws, 'scanresults')), kvGetJSON('vh:watchlist')]);
  const stocks = (main?.stocks || []).map(s => (results?.[s.ticker] ? { ...s, ...results[s.ticker] } : s));
  return { stocks, watchlist: watchlist || {} };
}

async function enqueue(kind, tickers, cfg, ws) {
  if (tickers.length === 0) return { ok: true, kind, ws, queued: 0, note: 'no stocks qualified' };
  let jobs = (await kvGetJSON(wsKey(ws, 'jobs'))) || [];
  if (jobs.some(j => j.kind === kind && (j.status === 'queued' || j.status === 'running'))) {
    return { ok: true, kind, queued: 0, note: `a ${kind} pass is already in progress` };
  }
  const job = {
    id: `job_${Date.now()}_${kind}`,
    kind, ws,
    agentIds: ALL_AGENTS,
    tickers,
    model: cfg.model,
    playbooks: null,
    completed: {},
    status: 'queued',
    createdAt: Date.now(), updatedAt: Date.now(), errors: 0,
  };
  jobs = [job, ...jobs].slice(0, 30);
  await kvSetJSON(wsKey(ws, 'jobs'), jobs);
  return { ok: true, kind, ws, queued: tickers.length, model: job.model, jobId: job.id };
}

// Weekly: every Hunt-tier stock + the watchlist (capped in testing mode)
export async function runWeeklyPass(ws = 'main') {
  const settings = await getSettings();
  const cfg = wsConfig(ws, settings);
  const { stocks, watchlist } = await loadStocksWithResults(ws);
  const pool = stocks
    .filter(s => s.tier === 'A' || watchlist[s.ticker])
    .sort((a, b) => (b.compositeScore || 0) - (a.compositeScore || 0))
    .map(s => s.ticker);
  const capped = cfg.limit ? pool.slice(0, cfg.limit) : pool.slice(0, 2000);
  return enqueue('weekly', capped, cfg, ws);
}

// Daily: only stocks that hit a minimum, not scanned in the last N days
export async function runDailyPass(ws = 'main') {
  const settings = await getSettings();
  const cfg = wsConfig(ws, settings);
  const { stocks, watchlist } = await loadStocksWithResults(ws);
  const m = settings.dailyMin;
  const cutoff = Date.now() - settings.rescanDays * 864e5;
  const qualifies = (s) => {
    if (watchlist[s.ticker]) return true;
    if ((s.compositeScore || 0) >= m.composite) return true;
    if ((s.techScore || 0) >= m.techScore) return true;
    if ((s.playbookScore || 0) >= m.playbookScore) return true;
    const d = s.lastInsiderPurchase?.date;
    if (d && Date.now() - new Date(d).getTime() < m.insiderDays * 864e5) return true;
    return false;
  };
  const pool = stocks
    .filter(s => s.tier !== 'C')
    .filter(qualifies)
    .filter(s => !s.scannedAt || s.scannedAt < cutoff)
    .sort((a, b) => (watchlist[b.ticker] ? 1 : 0) - (watchlist[a.ticker] ? 1 : 0) || (b.compositeScore || 0) - (a.compositeScore || 0))
    .map(s => s.ticker);
  return enqueue('daily', pool.slice(0, cfg.dailyCap), cfg, ws);
}
