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
};

export async function getSettings() {
  const saved = kvConfigured() ? await kvGetJSON('vh:settings') : null;
  return { ...DEFAULT_SETTINGS, ...(saved || {}) };
}
export function modelFor(settings) { return settings.testingMode ? settings.fastModel : settings.smartModel; }

// Per-workspace scan configuration. Test = sandbox: 100 stocks, fast model.
export function wsConfig(ws, settings) {
  if (ws === 'test') return { limit: settings.testingLimit || 100, model: settings.fastModel, dailyCap: 10 };
  return { limit: 0, model: settings.smartModel, dailyCap: settings.dailyCap };
}
