// Market data refresh. Runs hourly (Vercel Pro); each stage decides for itself
// whether it has work to do today:
//   universe  - once a day: full NYSE/NASDAQ common-stock list
//   prices    - once a day: previous session OHLCV for the whole market (1 call),
//               appended to a rolling 12-day history for the Momentum Scout
//   enrich    - once a day: refresh price/mcap/insider for Main Session stocks
//   sweep     - every run: qualify the next slice of the universe (Base Scan
//               math server-side) into vh:fundamentals - full market ~daily
import { kvGetJSON, kvSetJSON, kvDel, kvLock, kvConfigured } from '../_lib/kv';
import { qualifyTicker, rate } from '../_lib/market';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const POLYGON_KEY = process.env.NEXT_PUBLIC_POLYGON_KEY;
const FINNHUB_KEY = process.env.NEXT_PUBLIC_FINNHUB_KEY;
const TIME_BUDGET_MS = 240_000;

function authorized(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get('authorization') === `Bearer ${secret}` ||
    new URL(request.url).searchParams.get('secret') === secret;
}
function sameOrigin(request) {
  const origin = request.headers.get('origin'), host = request.headers.get('host');
  try { return Boolean(origin && host && new URL(origin).host === host); } catch { return false; }
}
const today = () => new Date().toISOString().split('T')[0];
function prevTradingDate() {
  const d = new Date(Date.now() - 864e5);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().split('T')[0];
}

async function stageUniverse(meta, deadline) {
  if (meta.universe_date === today()) return meta;
  let url = meta.universe_cursor || `https://api.polygon.io/v3/reference/tickers?market=stocks&active=true&limit=1000&apiKey=${POLYGON_KEY}`;
  const tickers = meta.universe_partial || {};
  while (url && Date.now() < deadline) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Polygon tickers ${res.status}`);
    const data = await res.json();
    for (const t of data.results || []) {
      if (t.type === 'CS' && (t.primary_exchange === 'XNYS' || t.primary_exchange === 'XNAS') && !t.ticker.includes('.') && !t.ticker.includes('-')) {
        tickers[t.ticker] = { name: t.name };
      }
    }
    url = data.next_url ? `${data.next_url}&apiKey=${POLYGON_KEY}` : null;
    await new Promise(r => setTimeout(r, 150));
  }
  if (url) return { ...meta, universe_cursor: url, universe_partial: tickers };
  // carry prices forward from the previous universe so nothing goes blank
  const prev = (await kvGetJSON('vh:universe')) || { tickers: {} };
  for (const t of Object.keys(tickers)) if (prev.tickers[t]) Object.assign(tickers[t], { price: prev.tickers[t].price, volume: prev.tickers[t].volume });
  await kvSetJSON('vh:universe', { tickers, updated: Date.now(), prices_date: prev.prices_date || null });
  return { ...meta, universe_date: today(), universe_cursor: null, universe_partial: null, count: Object.keys(tickers).length };
}

async function stagePrices(meta) {
  const date = prevTradingDate();
  if (meta.prices_date === date) return meta;
  const res = await fetch(`https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${date}?adjusted=true&apiKey=${POLYGON_KEY}`);
  if (!res.ok) throw new Error(`Polygon grouped ${res.status}`);
  const data = await res.json();
  if (!data.results || data.results.length === 0) return { ...meta, prices_note: `no bars for ${date}` };
  const universe = (await kvGetJSON('vh:universe')) || { tickers: {} };
  const day = {};
  for (const bar of data.results) {
    const t = universe.tickers[bar.T];
    if (t) { t.price = bar.c; t.volume = bar.v; t.prevOpen = bar.o; day[bar.T] = [bar.c, bar.v]; }
  }
  universe.prices_date = date; universe.updated = Date.now();
  await kvSetJSON('vh:universe', universe);
  const hist = ((await kvGetJSON('vh:prices:hist')) || []).filter(h => h.date !== date);
  hist.push({ date, data: day });
  await kvSetJSON('vh:prices:hist', hist.slice(-12));
  return { ...meta, prices_date: date };
}

async function stageEnrich(meta, deadline) {
  if (meta.enrich_date === today() && !meta.enrich_index) return meta;
  const main = await kvGetJSON('vh:main');
  if (!main?.stocks?.length) return { ...meta, enrich_date: today(), enrich_index: 0 };
  let i = meta.enrich_index || 0;
  while (i < main.stocks.length && Date.now() < deadline) {
    const batch = main.stocks.slice(i, i + 5);
    await Promise.all(batch.map(async (s) => {
      try {
        const [prevRes, detRes] = await Promise.all([
          fetch(`https://api.polygon.io/v2/aggs/ticker/${s.ticker}/prev?adjusted=true&apiKey=${POLYGON_KEY}`),
          fetch(`https://api.polygon.io/v3/reference/tickers/${s.ticker}?apiKey=${POLYGON_KEY}`),
        ]);
        if (prevRes.ok) { const bar = (await prevRes.json()).results?.[0]; if (bar) { const pc = s.price; s.price = bar.c; if (pc) s.change = ((bar.c - pc) / pc) * 100; } }
        if (detRes.ok) { const det = (await detRes.json()).results; if (det?.market_cap) s.marketCap = Math.round(det.market_cap / 1e6); }
        s.refreshed = Date.now();
      } catch (e) {}
    }));
    i += batch.length;
    await new Promise(r => setTimeout(r, 120));
  }
  main.timestamp = Date.now();
  await kvSetJSON('vh:main', main);
  if (i < main.stocks.length) return { ...meta, enrich_index: i };
  return { ...meta, enrich_date: today(), enrich_index: 0 };
}

async function stageSweep(meta, deadline) {
  const universe = (await kvGetJSON('vh:universe')) || { tickers: {} };
  const list = Object.keys(universe.tickers).sort();
  if (list.length === 0) return meta;
  const fundamentals = (await kvGetJSON('vh:fundamentals')) || {};
  let idx = meta.sweep_index || 0;
  if (idx >= list.length) idx = 0;
  let done = 0, sleepMs = 400;
  rate.finnhub429 = 0;
  while (idx < list.length && Date.now() < deadline - 15_000) {
    const batch = list.slice(idx, idx + 4);
    await Promise.all(batch.map(async (t) => {
      const u = universe.tickers[t] || {};
      const rec = await qualifyTicker(t, { name: u.name, price: u.price });
      if (rec) fundamentals[t] = rec;
    }));
    idx += batch.length; done += batch.length;
    if (rate.finnhub429 > 0) { sleepMs = Math.min(4000, sleepMs * 2); rate.finnhub429 = 0; }
    await new Promise(r => setTimeout(r, sleepMs));
  }
  await kvSetJSON('vh:fundamentals', fundamentals);
  // Stamp fresh tier / technicals / liquidity onto matching Main Session stocks
  try {
    const main = await kvGetJSON('vh:main');
    if (main?.stocks?.length) {
      let touched = 0;
      main.stocks = main.stocks.map(s => {
        const f = fundamentals[s.ticker];
        if (!f || !f.sweptAt || (s.sweptAt && s.sweptAt >= f.sweptAt)) return s;
        touched++;
        // Daily Base Scan refresh: overlay ALL fresh qualifier data (price,
        // market cap, 52w position, net cash, latest insider buy, agent
        // scores, tier, technicals) but never touch AI scan results.
        const { compositeScore, aiAnalysis, id, ...fresh } = f;
        return { ...s, ...fresh };
      });
      if (touched) { main.timestamp = Date.now(); await kvSetJSON('vh:main', main); }
    }
  } catch (e) {}
  return { ...meta, sweep_index: idx >= list.length ? 0 : idx, sweep_last: Date.now(), sweep_done_this_run: done, sweep_total: list.length, swept_count: Object.keys(fundamentals).length };
}

async function runRefresh() {
  if (!(await kvLock('vh:refresh:lock', 290_000))) return Response.json({ ok: false, running: true });
  const deadline = Date.now() + TIME_BUDGET_MS;
  try {
    let meta = (await kvGetJSON('vh:refresh:meta')) || {};
    meta = await stageUniverse(meta, deadline); await kvSetJSON('vh:refresh:meta', meta);
    if (Date.now() < deadline) { meta = await stagePrices(meta); await kvSetJSON('vh:refresh:meta', meta); }
    // Enrich gets at most ~70s per run (it rotates through the Main Session
    // across hourly runs); the sweep always gets the remainder.
    if (Date.now() < deadline) { meta = await stageEnrich(meta, Math.min(deadline, Date.now() + 70_000)); await kvSetJSON('vh:refresh:meta', meta); }
    if (Date.now() < deadline) { meta = await stageSweep(meta, deadline); await kvSetJSON('vh:refresh:meta', meta); }
    await kvSetJSON('vh:universe:meta', { updated: Date.now(), prices_date: meta.prices_date || null, count: meta.count || null, swept: meta.swept_count || 0, sweep_total: meta.sweep_total || 0, last_run: Date.now() });
    const done = meta.universe_date === today() && !meta.enrich_index;
    return Response.json({ ok: true, done, meta: { universe_date: meta.universe_date, prices_date: meta.prices_date, swept: meta.swept_count, total: meta.sweep_total, swept_this_run: meta.sweep_done_this_run } });
  } finally {
    await kvDel('vh:refresh:lock');
  }
}

export async function GET(request) {
  if (!kvConfigured()) return Response.json({ error: 'KV not configured' }, { status: 500 });
  if (!authorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  return runRefresh();
}
export async function POST(request) {
  if (!kvConfigured()) return Response.json({ error: 'KV not configured' }, { status: 500 });
  if (!sameOrigin(request)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  return runRefresh();
}
