// The research team: a daily change-detector that watches the top stocks in
// the Main Session. It NEVER writes scan scores - it only appends findings to
// a feed and suggests which deep scan to re-run.
import { kvGetJSON, kvSetJSON, kvDel, kvLock, kvConfigured } from '../_lib/kv';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const TIME_BUDGET_MS = 240_000;
const GROK_KEY = () => process.env.GROK_API_KEY || process.env.NEXT_PUBLIC_GROK_KEY;

function cronAuthorized(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get('authorization') === `Bearer ${secret}` ||
    new URL(request.url).searchParams.get('secret') === secret;
}

function sameOrigin(request) {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  return Boolean(origin && host && (() => { try { return new URL(origin).host === host; } catch { return false; } })());
}

async function researchStock(stock, sinceDate, model) {
  const prompt = `You are a research analyst on a continuous-monitoring desk. Check what has CHANGED for ${stock.ticker} (${stock.name || ''}), sector ${stock.sector || 'Unknown'}, since ${sinceDate}.
Search the web and X for: news, SEC filings, insider buys/sells, executive or board changes, contract wins/losses, analyst actions, buyout chatter, unusual volume narratives.
Summarize ONLY genuinely new information in 2-4 sentences. If nothing meaningful happened, say "No significant developments."
Then rate how significant the change is for an investor holding a thesis on this stock, and if significant, which deep scan should be re-run.
End with EXACTLY:
SIGNIFICANCE: [0-100]
SUGGEST_SCAN: [buyout|momentum|passion|playbook|conviction|valuation|none]`;

  const res = await fetch('https://api.x.ai/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROK_KEY()}` },
    body: JSON.stringify({
      model,
      input: [
        { role: 'system', content: 'You are a concise equity research monitor. Follow the format exactly.' },
        { role: 'user', content: prompt },
      ],
      tools: [{ type: 'web_search' }, { type: 'x_search' }],
      max_output_tokens: 1500,
    }),
  });
  if (!res.ok) throw new Error(`xAI ${res.status}`);
  const data = await res.json();
  let text = '';
  for (const item of data.output || []) {
    if (item.type === 'message') for (const c of item.content || []) {
      if ((c.type === 'output_text' || c.type === 'text') && c.text) text += c.text;
    }
  }
  text = text.replace(/\[\[\d+\]\]\([^)]*\)/g, '').trim();
  const significance = Math.min(100, Math.max(0, parseInt(text.match(/SIGNIFICANCE[:\s]*(\d+)/i)?.[1] ?? '0')));
  const suggest = (text.match(/SUGGEST_SCAN[:\s]*([a-z]+)/i)?.[1] || 'none').toLowerCase();
  const summary = text.replace(/SIGNIFICANCE[:\s]*\d+/gi, '').replace(/SUGGEST_SCAN[:\s]*[a-z]+/gi, '').trim().slice(0, 1500);
  return { significance, suggest, summary };
}

async function runResearchPass() {
  if (!(await kvLock('vh:research:lock', 280_000))) {
    return Response.json({ ok: false, running: true });
  }
  const deadline = Date.now() + TIME_BUDGET_MS;
  try {
    const config = (await kvGetJSON('vh:research:config')) || { n: 10, model: 'grok-4.3' };
    const main = await kvGetJSON('vh:main');
    if (!main || !Array.isArray(main.stocks) || main.stocks.length === 0) {
      return Response.json({ ok: true, note: 'no main session yet' });
    }
    // Research the Watchlist (scout finds + manual stars). Fall back to the
    // top composite scores only if nothing is being watched yet.
    const watchlist = (await kvGetJSON('vh:watchlist')) || {};
    const watched = Object.keys(watchlist);
    const byTicker = new Map(main.stocks.map(s => [s.ticker, s]));
    let targets = watched.map(t => byTicker.get(t) || { ticker: t, name: watchlist[t].name || t, sector: 'Unknown' })
      .sort((a, b) => (watchlist[b.ticker]?.addedAt || 0) - (watchlist[a.ticker]?.addedAt || 0))
      .slice(0, config.n);
    if (targets.length === 0) {
      targets = [...main.stocks].sort((a, b) => (b.compositeScore || 0) - (a.compositeScore || 0)).slice(0, config.n);
    }

    const seen = (await kvGetJSON('vh:research:seen')) || {};
    let feed = (await kvGetJSON('vh:research:feed')) || [];
    let state = (await kvGetJSON('vh:research:state')) || { index: 0, run_started: Date.now() };
    // A pass older than 20h is a new day's pass
    if (Date.now() - (state.run_started || 0) > 20 * 3600 * 1000) state = { index: 0, run_started: Date.now() };

    let processed = 0;
    while (state.index < targets.length && Date.now() < deadline) {
      const stock = targets[state.index];
      const last = seen[stock.ticker];
      const sinceDate = last ? new Date(last).toISOString().split('T')[0] : '2 weeks ago';
      try {
        const r = await researchStock(stock, sinceDate, config.model);
        feed.unshift({ ticker: stock.ticker, name: stock.name, ts: Date.now(), ...r });
        seen[stock.ticker] = Date.now();
        processed++;
      } catch (e) {
        // transient failure - next pass retries this ticker
      }
      state.index++;
      await kvSetJSON('vh:research:state', state);
      await kvSetJSON('vh:research:seen', seen);
      await kvSetJSON('vh:research:feed', feed.slice(0, 300));
    }
    const done = state.index >= targets.length;
    if (done) await kvSetJSON('vh:research:state', { index: 0, run_started: 0 });
    return Response.json({ ok: true, processed, done, watched: targets.length });
  } finally {
    await kvDel('vh:research:lock');
  }
}

export async function GET(request) {
  if (!kvConfigured()) return Response.json({ error: 'KV not configured' }, { status: 500 });
  const url = new URL(request.url);
  if (url.searchParams.get('feed') === '1') {
    const [feed, config, watchlist, scouts] = await Promise.all([
      kvGetJSON('vh:research:feed'), kvGetJSON('vh:research:config'), kvGetJSON('vh:watchlist'), kvGetJSON('vh:scouts:latest'),
    ]);
    return Response.json({ feed: feed || [], config: config || { n: 10, model: 'grok-4.3' }, watchlist: watchlist || {}, scouts: scouts || null });
  }
  if (!cronAuthorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  return runResearchPass();
}

export async function POST(request) {
  if (!kvConfigured()) return Response.json({ error: 'KV not configured' }, { status: 500 });
  if (!sameOrigin(request)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  if (body && body.config) {
    const n = Math.min(50, Math.max(1, parseInt(body.config.n) || 10));
    const model = ['grok-4.3', 'grok-4.6', 'grok-4.20'].includes(body.config.model) ? body.config.model : 'grok-4.3';
    await kvSetJSON('vh:research:config', { n, model });
    return Response.json({ ok: true, config: { n, model } });
  }
  return runResearchPass();
}
