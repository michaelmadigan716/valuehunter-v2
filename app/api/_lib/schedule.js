// Builds and enqueues scheduled deep-scan jobs.
import { kvGetJSON, kvSetJSON } from './kv';
import { getSettings, modelFor } from './settings';

const ALL_AGENTS = ['conviction', 'technical', 'valuation', 'momentum', 'buyout', 'leadership', 'playbook'];

async function loadStocksWithResults() {
  const [main, results, watchlist] = await Promise.all([kvGetJSON('vh:main'), kvGetJSON('vh:scanresults'), kvGetJSON('vh:watchlist')]);
  const stocks = (main?.stocks || []).map(s => (results?.[s.ticker] ? { ...s, ...results[s.ticker] } : s));
  return { stocks, watchlist: watchlist || {} };
}

async function enqueue(kind, tickers, settings) {
  if (tickers.length === 0) return { ok: true, kind, queued: 0, note: 'no stocks qualified' };
  let jobs = (await kvGetJSON('vh:jobs')) || [];
  if (jobs.some(j => j.kind === kind && (j.status === 'queued' || j.status === 'running'))) {
    return { ok: true, kind, queued: 0, note: `a ${kind} pass is already in progress` };
  }
  const job = {
    id: `job_${Date.now()}_${kind}`,
    kind,
    agentIds: ALL_AGENTS,
    tickers,
    model: modelFor(settings),
    playbooks: null,
    completed: {},
    status: 'queued',
    createdAt: Date.now(), updatedAt: Date.now(), errors: 0,
  };
  jobs = [job, ...jobs].slice(0, 30);
  await kvSetJSON('vh:jobs', jobs);
  return { ok: true, kind, queued: tickers.length, model: job.model, jobId: job.id };
}

// Weekly: every Hunt-tier stock + the watchlist (capped in testing mode)
export async function runWeeklyPass() {
  const settings = await getSettings();
  const { stocks, watchlist } = await loadStocksWithResults();
  const pool = stocks
    .filter(s => s.tier === 'A' || watchlist[s.ticker])
    .sort((a, b) => (b.compositeScore || 0) - (a.compositeScore || 0))
    .map(s => s.ticker);
  const capped = settings.testingMode ? pool.slice(0, settings.testingLimit) : pool.slice(0, 2000);
  return enqueue('weekly', capped, settings);
}

// Daily: only stocks that hit a minimum, not scanned in the last N days
export async function runDailyPass() {
  const settings = await getSettings();
  const { stocks, watchlist } = await loadStocksWithResults();
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
  const cap = settings.testingMode ? 10 : settings.dailyCap;
  return enqueue('daily', pool.slice(0, cap), settings);
}
