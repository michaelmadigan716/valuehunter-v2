// Scouts: three discovery routes feed a triage step that builds the Watchlist.
//   value    - math over vh:fundamentals: mcap <= 1.3x net cash, price < $12
//   momentum - math over price history: volume + price surges in small caps
//   social   - live X/FinTwit + r/wallstreetbets DD sweep (2 AI calls total)
// Triage (fast model, 1 call per new candidate, capped) decides watch/pass and
// adds watched stocks to the Main Session table + Watchlist + feed.
import { kvGetJSON, kvSetJSON, kvDel, kvLock, kvConfigured } from '../_lib/kv';
import { qualifyTicker } from '../_lib/market';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const GROK_KEY = () => process.env.GROK_API_KEY || process.env.NEXT_PUBLIC_GROK_KEY;
const TIME_BUDGET_MS = 240_000;

function authorized(request) {
  const s = process.env.CRON_SECRET;
  return Boolean(s) && (request.headers.get('authorization') === `Bearer ${s}` || new URL(request.url).searchParams.get('secret') === s);
}
function sameOrigin(request) {
  const origin = request.headers.get('origin'), host = request.headers.get('host');
  try { return Boolean(origin && host && new URL(origin).host === host); } catch { return false; }
}

async function grok(prompt, model) {
  const body = { model, input: [{ role: 'system', content: 'You are a precise equity research scout. Follow the output format exactly.' }, { role: 'user', content: prompt }], tools: [{ type: 'web_search' }, { type: 'x_search' }], max_output_tokens: 1800 };
  const res = await fetch('https://api.x.ai/v1/responses', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROK_KEY()}` }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`xAI ${res.status}`);
  const data = await res.json();
  let text = '';
  for (const item of data.output || []) if (item.type === 'message') for (const c of item.content || []) if ((c.type === 'output_text' || c.type === 'text') && c.text) text += c.text;
  return text.replace(/\[\[\d+\]\]\([^)]*\)/g, '').trim();
}

function valueScout(fundamentals) {
  const out = [];
  for (const [t, f] of Object.entries(fundamentals)) {
    if (!f.hasFinancials || !(f.netCash > 0) || !(f.marketCap > 0) || !(f.price > 0)) continue;
    if (f.price < 12 && f.marketCap * 1e6 <= 1.3 * f.netCash) {
      out.push({ ticker: t, route: 'value', reason: `Market cap $${f.marketCap}M vs net cash $${Math.round(f.netCash / 1e6)}M (${(f.marketCap * 1e6 / f.netCash).toFixed(2)}x) at $${f.price.toFixed(2)}` });
    }
  }
  return out.sort((a, b) => a.ticker.localeCompare(b.ticker)).slice(0, 40);
}

function momentumScout(hist, universe, fundamentals) {
  if (!hist || hist.length < 4) return [];
  const last = hist[hist.length - 1].data, prior = hist.slice(-6, -1);
  const out = [];
  for (const [t, [c, v]] of Object.entries(last)) {
    const u = universe.tickers[t]; if (!u) continue;
    const prevBars = prior.map(h => h.data[t]).filter(Boolean);
    if (prevBars.length < 3) continue;
    const avgV = prevBars.reduce((a, b) => a + b[1], 0) / prevBars.length;
    const prevC = prevBars[prevBars.length - 1][0];
    const volRatio = avgV > 0 ? v / avgV : 0;
    const chg = prevC > 0 ? ((c - prevC) / prevC) * 100 : 0;
    const mcap = fundamentals[t]?.marketCap || 0;
    if (volRatio >= 3 && chg >= 15 && c < 20 && v * c > 2e6 && (mcap === 0 || mcap < 2000)) {
      out.push({ ticker: t, route: 'momentum', reason: `${chg.toFixed(0)}% move on ${volRatio.toFixed(1)}x average volume at $${c.toFixed(2)}`, score: volRatio * chg });
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 25);
}

const scoutDebug = { errors: [], socialRaw: [] };
async function socialScout(universe, model) {
  const parse = (text, route) => {
    const out = [];
    for (const line of text.split('\n')) {
      const m = line.replace(/\*\*/g, '').match(/^\s*\$?([A-Z]{1,5})\s*\|\s*(.+)$/);
      if (m && universe.tickers[m[1]]) out.push({ ticker: m[1], route, reason: m[2].trim().slice(0, 240) });
      else if (m) scoutDebug.errors.push(`not in universe: ${m[1]}`);
    }
    return out;
  };
  const results = [];
  try {
    const x = await grok(`Search X/Twitter (FinTwit) for US-listed SMALL and MID-CAP stocks (under ~$5B) that are going viral or seeing a sudden surge in discussion TODAY and in the last 48 hours - breaking news, viral threads, unusual attention. Exclude mega caps and index names.
Output ONLY lines in the form: TICKER | one sentence on why it's trending and whether the attention looks substantive or meme-driven.
Give up to 12 lines.`, model);
    results.push(...parse(x, 'social-x'));
  } catch (e) { scoutDebug.errors.push('x: ' + e.message); }
  try {
    const wsb = await grok(`Search r/wallstreetbets (especially DD-flaired posts), r/pennystocks and r/smallstreetbets for the most upvoted or highest-quality due-diligence posts from the last 3 days on US-listed stocks. Prefer small caps with a real thesis (turnaround, catalyst, undervaluation, buyout).
Output ONLY lines in the form: TICKER | one sentence summary of the thesis and how strong the DD looks.
Give up to 12 lines.`, model);
    results.push(...parse(wsb, 'social-reddit'));
  } catch (e) { scoutDebug.errors.push('reddit: ' + e.message); }
  return results;
}

async function triage(cand, f, model) {
  const prompt = `A discovery scout flagged ${cand.ticker}${f?.name ? ` (${f.name})` : ''} via the "${cand.route}" route: ${cand.reason}
${f ? `Known data: price $${f.price?.toFixed(2)}, market cap $${f.marketCap}M, net cash $${Math.round((f.netCash || 0) / 1e6)}M, sector ${f.sector}, last insider buy ${f.lastInsiderPurchase?.date || 'none'}.` : ''}
Do a quick check (search if needed): is this worth a deep-dive by a small-cap investor whose winning setups are (a) companies positioning for a buyout, (b) niche monopolies about to matter, (c) net-cash deep-value turnarounds with management actively fixing things? Prefer cheap (<$12) small caps.
End with EXACTLY:
WATCH: [yes|no]
PLAYBOOK: [buyoutSeeker|nicheMonopoly|netCashRecovery|none]
NOTE: [one sentence]`;
  const text = await grok(prompt, model);
  const watch = /WATCH[:\s]*yes/i.test(text);
  const playbook = text.match(/PLAYBOOK[:\s]*([A-Za-z]+)/)?.[1] || 'none';
  const note = text.match(/NOTE[:\s]*(.+)/)?.[1]?.trim().slice(0, 300) || '';
  return { watch, playbook, note };
}

async function runScouts() {
  if (!(await kvLock('vh:scouts:lock', 290_000))) return Response.json({ ok: false, running: true });
  const deadline = Date.now() + TIME_BUDGET_MS;
  scoutDebug.errors = []; scoutDebug.socialRaw = [];
  try {
    const config = (await kvGetJSON('vh:research:config')) || { n: 10, model: 'grok-4.3' };
    const [universe, fundamentals, hist] = await Promise.all([kvGetJSON('vh:universe'), kvGetJSON('vh:fundamentals'), kvGetJSON('vh:prices:hist')]);
    if (!universe) return Response.json({ ok: false, note: 'no universe yet' });
    const fund = fundamentals || {};

    const candidates = [
      ...valueScout(fund),
      ...momentumScout(hist, universe, fund),
      ...(await socialScout(universe, config.model)),
    ];

    const watchlist = (await kvGetJSON('vh:watchlist')) || {};
    const triaged = (await kvGetJSON('vh:scouts:triaged')) || {};
    const main = (await kvGetJSON('vh:main')) || { stocks: [] };
    let feed = (await kvGetJSON('vh:research:feed')) || [];
    const added = [];
    let triageCalls = 0;
    const seen = new Set();

    for (const cand of candidates) {
      if (Date.now() > deadline - 20_000 || triageCalls >= 20) break;
      if (seen.has(cand.ticker) || watchlist[cand.ticker]) continue;
      seen.add(cand.ticker);
      if (triaged[cand.ticker] && Date.now() - triaged[cand.ticker] < 7 * 864e5) continue;
      let f = fund[cand.ticker];
      try {
        if (!f) { f = await qualifyTicker(cand.ticker, { name: universe.tickers[cand.ticker]?.name, price: universe.tickers[cand.ticker]?.price }); if (f) fund[cand.ticker] = f; }
        const t = await triage(cand, f, config.model);
        triageCalls++;
        triaged[cand.ticker] = Date.now();
        if (t.watch) {
          watchlist[cand.ticker] = { route: cand.route, reason: cand.reason, note: t.note, playbook: t.playbook, addedAt: Date.now() };
          if (f && !main.stocks.some(s => s.ticker === cand.ticker)) main.stocks.push({ ...f, scoutRoute: cand.route });
          feed.unshift({ type: 'scout', ticker: cand.ticker, name: f?.name || cand.ticker, ts: Date.now(), significance: 60, suggest: t.playbook !== 'none' ? 'playbook' : 'valuation', summary: `Scout (${cand.route}): ${cand.reason}\nTriage: ${t.note}` });
          added.push(cand.ticker);
        }
      } catch (e) {}
    }

    main.timestamp = Date.now();
    await Promise.all([
      kvSetJSON('vh:watchlist', watchlist),
      kvSetJSON('vh:scouts:triaged', triaged),
      kvSetJSON('vh:main', main),
      kvSetJSON('vh:research:feed', feed.slice(0, 300)),
      kvSetJSON('vh:fundamentals', fund),
      kvSetJSON('vh:scouts:latest', { ts: Date.now(), counts: { value: candidates.filter(c => c.route === 'value').length, momentum: candidates.filter(c => c.route === 'momentum').length, social: candidates.filter(c => c.route.startsWith('social')).length }, candidates: candidates.slice(0, 80), added }),
    ]);
    return Response.json({ ok: true, candidates: candidates.length, byRoute: { value: candidates.filter(c => c.route === 'value').length, momentum: candidates.filter(c => c.route === 'momentum').length, social: candidates.filter(c => c.route.startsWith('social')).length }, triaged: triageCalls, added, errors: scoutDebug.errors });
  } finally {
    await kvDel('vh:scouts:lock');
  }
}

export async function GET(request) {
  if (!kvConfigured()) return Response.json({ error: 'KV not configured' }, { status: 500 });
  if (!authorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  return runScouts();
}
export async function POST(request) {
  if (!kvConfigured()) return Response.json({ error: 'KV not configured' }, { status: 500 });
  if (!sameOrigin(request)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  return runScouts();
}
