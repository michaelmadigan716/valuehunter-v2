// Daily data refresh, cron-driven and chunk-safe.
// Stages (cursor persisted in KV so any run continues where the last stopped):
//  1. universe  - full NYSE/NASDAQ common-stock list from Polygon reference API
//  2. prices    - previous trading day OHLCV for the whole market (1 grouped call)
//  3. enrich    - for stocks in the Main Session: fresh price/market cap + latest
//                 insider purchases (chunked under the time budget)
// Auth: Vercel cron sends Authorization: Bearer CRON_SECRET; manual runs pass ?secret=.
import { kvGetJSON, kvSetJSON, kvDel, kvLock, kvConfigured } from '../_lib/kv';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const POLYGON_KEY = process.env.NEXT_PUBLIC_POLYGON_KEY;
const FINNHUB_KEY = process.env.NEXT_PUBLIC_FINNHUB_KEY;
const TIME_BUDGET_MS = 240_000;

function authorized(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get('authorization');
  if (auth === `Bearer ${secret}`) return true;
  return new URL(request.url).searchParams.get('secret') === secret;
}

function prevTradingDate() {
  // last weekday before today (UTC) - good enough; grouped endpoint just
  // returns empty on holidays and we keep the prior snapshot
  const d = new Date(Date.now() - 24 * 3600 * 1000);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().split('T')[0];
}

async function stageUniverse(state, deadline) {
  let url = state.cursor_url ||
    `https://api.polygon.io/v3/reference/tickers?market=stocks&active=true&limit=1000&apiKey=${POLYGON_KEY}`;
  const tickers = state.partial_tickers || {};
  while (url && Date.now() < deadline) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Polygon tickers ${res.status}`);
    const data = await res.json();
    for (const t of data.results || []) {
      if (t.type === 'CS' && (t.primary_exchange === 'XNYS' || t.primary_exchange === 'XNAS') &&
          !t.ticker.includes('.') && !t.ticker.includes('-')) {
        tickers[t.ticker] = { name: t.name };
      }
    }
    url = data.next_url ? `${data.next_url}&apiKey=${POLYGON_KEY}` : null;
    await new Promise(r => setTimeout(r, 150));
  }
  if (url) {
    return { ...state, stage: 'universe', cursor_url: url, partial_tickers: tickers };
  }
  await kvSetJSON('vh:universe', { tickers, updated: Date.now() });
  return { stage: 'prices', partial_tickers: null, cursor_url: null };
}

async function stagePrices() {
  const date = prevTradingDate();
  const res = await fetch(`https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${date}?adjusted=true&apiKey=${POLYGON_KEY}`);
  if (!res.ok) throw new Error(`Polygon grouped ${res.status}`);
  const data = await res.json();
  const universe = (await kvGetJSON('vh:universe')) || { tickers: {} };
  let priced = 0;
  for (const bar of data.results || []) {
    const t = universe.tickers[bar.T];
    if (t) { t.price = bar.c; t.volume = bar.v; t.prevOpen = bar.o; priced++; }
  }
  universe.prices_date = date;
  universe.updated = Date.now();
  await kvSetJSON('vh:universe', universe);
  return { stage: 'enrich', enrich_index: 0, priced };
}

async function stageEnrich(state, deadline) {
  const main = await kvGetJSON('vh:main');
  if (!main || !Array.isArray(main.stocks) || main.stocks.length === 0) {
    return { stage: 'done' };
  }
  let i = state.enrich_index || 0;
  const stocks = main.stocks;
  while (i < stocks.length && Date.now() < deadline) {
    const batch = stocks.slice(i, i + 5);
    await Promise.all(batch.map(async (s) => {
      try {
        const [prevRes, detRes, insRes] = await Promise.all([
          fetch(`https://api.polygon.io/v2/aggs/ticker/${s.ticker}/prev?adjusted=true&apiKey=${POLYGON_KEY}`),
          fetch(`https://api.polygon.io/v3/reference/tickers/${s.ticker}?apiKey=${POLYGON_KEY}`),
          FINNHUB_KEY ? fetch(`https://finnhub.io/api/v1/stock/insider-transactions?symbol=${s.ticker}&token=${FINNHUB_KEY}`) : null,
        ]);
        if (prevRes.ok) {
          const bar = (await prevRes.json()).results?.[0];
          if (bar) {
            const prevClose = s.price;
            s.price = bar.c;
            if (prevClose) s.change = ((bar.c - prevClose) / prevClose) * 100;
          }
        }
        if (detRes.ok) {
          const det = (await detRes.json()).results;
          if (det?.market_cap) s.marketCap = Math.round(det.market_cap / 1e6);
        }
        if (insRes && insRes.ok) {
          const data = (await insRes.json()).data || [];
          const buys = data.filter(x => x.change > 0 && x.transactionPrice > 0)
            .sort((a, b) => (b.transactionDate || '').localeCompare(a.transactionDate || ''));
          if (buys.length > 0) {
            s.lastInsiderPurchase = {
              date: buys[0].transactionDate,
              amount: Math.round(buys[0].change * buys[0].transactionPrice),
              name: buys[0].name,
            };
          }
        }
        s.refreshed = Date.now();
      } catch (e) { /* per-stock failures are fine; next run retries */ }
    }));
    i += batch.length;
    await new Promise(r => setTimeout(r, 120));
  }
  main.timestamp = Date.now();
  await kvSetJSON('vh:main', main);
  if (i < stocks.length) return { ...state, stage: 'enrich', enrich_index: i };
  return { stage: 'done', enriched: stocks.length };
}

async function runRefresh() {
  if (!(await kvLock('vh:refresh:lock', 280_000))) {
    return Response.json({ ok: false, running: true, note: 'another refresh is in progress' });
  }

  const deadline = Date.now() + TIME_BUDGET_MS;
  let state = (await kvGetJSON('vh:refresh:state')) || { stage: 'universe' };
  if (state.stage === 'done') state = { stage: 'universe' };
  const started = state.stage;

  try {
    while (Date.now() < deadline && state.stage !== 'done') {
      if (state.stage === 'universe') state = await stageUniverse(state, deadline);
      else if (state.stage === 'prices') state = await stagePrices();
      else if (state.stage === 'enrich') state = await stageEnrich(state, deadline);
      await kvSetJSON('vh:refresh:state', state);
    }
    const uni = await kvGetJSON('vh:universe');
    await kvSetJSON('vh:universe:meta', {
      updated: uni?.updated || null,
      prices_date: uni?.prices_date || null,
      count: uni ? Object.keys(uni.tickers).length : 0,
      last_run: Date.now(),
      stage: state.stage,
    });
    return Response.json({ ok: true, started_at_stage: started, now_at_stage: state.stage, done: state.stage === 'done' });
  } finally {
    await kvDel('vh:refresh:lock');
  }
}

export async function GET(request) {
  if (!kvConfigured()) return Response.json({ error: 'KV not configured' }, { status: 500 });
  if (!authorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  return runRefresh();
}

// Same-origin manual trigger from the app UI (no secret needed in the browser)
export async function POST(request) {
  if (!kvConfigured()) return Response.json({ error: 'KV not configured' }, { status: 500 });
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (!origin || !host || new URL(origin).host !== host) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  return runRefresh();
}
