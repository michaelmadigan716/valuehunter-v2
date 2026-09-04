// Global app settings shared by the browser and the server jobs.
import { kvGetJSON, kvConfigured } from './kv';

export const DEFAULT_SETTINGS = {
  testingMode: true,          // cap everything at 100 stocks + fastest model while building
  testingLimit: 100,
  smartModel: 'grok-4.6',
  fastModel: 'grok-4.3',
  dailyCap: 50,               // max stocks per daily targeted pass (10 in testing)
  dailyMin: { composite: 65, insiderDays: 30, techScore: 85, playbookScore: 70 },
  rescanDays: 3,              // don't re-run a scan on a stock scanned within N days
  schedules: { weekly: { enabled: true }, daily: { enabled: true } },
  // Dynamic strategy: breadth on the fast model, depth on the smart model for
  // stocks that earn it
  escalation: {
    enabled: true,
    thresholds: { singularityScore: 70, playbookScore: 70, buyoutScore: 70, momentumScore: 75, valuationScore: 75, insiderConviction: 70, techScore: 85 },
    cooldownDays: 7,
  },
  // Staged scanning (cost control for the big fast-model passes):
  //  stage 0 - free gate: no AI at all unless the free composite score (or a
  //            recent insider buy / strong technicals) clears a minimum
  //  stage 1 - the 3 cheap scans (no live search): Conviction, Technical, Valuation
  //  stage 2 - the 4 live-search scans (Momentum, Buyout, Leadership, Playbook)
  //            only if stage 1 shows something worth paying for
  staging: {
    enabled: true,
    minSingularity: 50,   // primary gate: singularity relevance 0-100 (batched, ~1 cheap call per 20 stocks)
    minComposite: null,   // optional secondary gate on the free composite; null = off
    insiderDays: 90,
    minTechScore: 85,
    stage2: { insiderConviction: 50, valuationScore: 60, cupHandleScore: 60 },
  },
};

export const CHEAP_AGENTS = ['conviction', 'technical', 'valuation'];
export const LIVE_SEARCH_AGENTS = ['momentum', 'buyout', 'leadership', 'playbook'];

function daysSince(d) {
  if (d && typeof d === 'object') d = d.date; // lastInsiderPurchase is {date, shares, name, ...}
  if (!d) return Infinity;
  const t = new Date(d).getTime();
  return Number.isFinite(t) ? (Date.now() - t) / 864e5 : Infinity;
}

// Stage 0: does this stock deserve ANY AI spend right now?
export function passesFreeGate(stock, settings) {
  const s = settings.staging || {};
  if (daysSince(stock.lastInsiderPurchase) <= (s.insiderDays ?? 90)) return { ok: true, why: 'recent insider buy' };
  if ((stock.techScore ?? 0) >= (s.minTechScore ?? 85)) return { ok: true, why: `technicals ${stock.techScore}%` };
  if ((stock.compositeScore ?? 0) >= (s.minComposite ?? 25)) return { ok: true, why: `composite ${stock.compositeScore}` };
  return { ok: false, why: `composite ${stock.compositeScore ?? '?'} < ${s.minComposite ?? 45}, no recent insider buy, technicals ${stock.techScore ?? '?'}%` };
}

// Stage 2: did the cheap scans show enough to pay for live-search scans?
export function passesStage2(stock, settings) {
  const s = settings.staging || {};
  const t = s.stage2 || {};
  if (daysSince(stock.lastInsiderPurchase) <= (s.insiderDays ?? 90)) return true;
  if ((stock.techScore ?? 0) >= (s.minTechScore ?? 85)) return true;
  return Object.entries(t).some(([k, min]) => typeof stock[k] === 'number' && stock[k] >= min);
}

export async function getSettings() {
  const saved = kvConfigured() ? await kvGetJSON('vh:settings') : null;
  return { ...DEFAULT_SETTINGS, ...(saved || {}) };
}
export function modelFor(settings) { return settings.testingMode ? settings.fastModel : settings.smartModel; }

// Per-workspace scan configuration. Test = sandbox: 100 stocks, fast model.
export function wsConfig(ws, settings) {
  if (ws === 'test') return { limit: settings.testingLimit || 100, model: settings.fastModel, weeklyModel: settings.fastModel, dailyCap: 10 };
  // Main: weekly breadth pass on the fast model; daily targeted pass on the smart model
  return { limit: 0, model: settings.smartModel, weeklyModel: settings.fastModel, dailyCap: settings.dailyCap };
}

export function meetsEscalation(stock, settings) {
  const t = settings.escalation?.thresholds || {};
  return Object.entries(t).some(([k, min]) => typeof stock[k] === 'number' && stock[k] >= min);
}
