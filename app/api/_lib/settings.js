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
};

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
