// Used by the signed-in Codex task; no model, market-data, or paid API calls.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
try { process.loadEnvFile(fileURLToPath(new URL('../../.env.local', import.meta.url))); } catch { /* deployed environment may already provide these */ }
const { betaState, control, claim, complete } = await import('../../lib/codexBetaStore.mjs');
const [action, arg] = process.argv.slice(2);
try {
  let result;
  if (action === 'status') { const state = await betaState(); result = { run: state.run ? { ...state.run, claim: state.run.claim ? { ticker: state.run.claim.ticker, expiresAt: state.run.claim.expiresAt } : null } : null, results: Object.keys(state.results).length }; }
  else if (action === 'claim') result = await claim();
  else if (action === 'complete') result = await complete(JSON.parse(await readFile(arg, 'utf8')));
  else if (action === 'start') result = await control('start', { limit: Number(arg || 10), ws: process.argv[4] || 'main' });
  else if (['pause', 'resume', 'cancel'].includes(action)) result = await control(action);
  else throw new Error('Use status | claim | complete <file> | start <3|10|25|100> [main|test] | pause | resume | cancel');
  console.log(JSON.stringify(result, null, 2));
} catch (e) { console.error(e.message); process.exitCode = 1; }
