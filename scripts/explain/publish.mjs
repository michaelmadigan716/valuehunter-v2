#!/usr/bin/env node
// Publish research files to the StockVids board.
//   node scripts/explain/publish.mjs explain/stocks/MOD.json [more.json ...] [--site https://...]
// The secret is read from EXPLAIN_SECRET / THINKING_SECRET (env or .env.local) and never printed.
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
const si = args.indexOf('--site');
const site = (si >= 0 ? args.splice(si, 2)[1] : process.env.EXPLAIN_SITE || 'http://localhost:3000').replace(/\/$/, '');
const env = { ...process.env };
const envFile = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envFile)) for (const l of fs.readFileSync(envFile, 'utf8').split('\n')) { const m = l.match(/^([A-Z_0-9]+)=(.*)$/); if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
const secret = env.EXPLAIN_SECRET || env.THINKING_SECRET;
if (!secret) { console.error('No EXPLAIN_SECRET or THINKING_SECRET found.'); process.exit(1); }
if (!args.length) { console.error('Give at least one research file.'); process.exit(1); }
let bad = 0;
for (const f of args) {
  const stock = JSON.parse(fs.readFileSync(f, 'utf8'));
  const res = await fetch(`${site}/api/explain`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` }, body: JSON.stringify({ action: 'publish', stock }) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out.error) { bad++; console.error(`FAIL ${f}: ${res.status} ${out.error || ''}`); } else console.log(`ok   ${out.ticker} -> ${site}/explain/${out.ticker}`);
}
process.exit(bad ? 1 : 0);
