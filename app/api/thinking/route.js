// Always-Thinking board: the cloud runner (Claude routine) reads the data
// window and writes its reasoning here; the /thinking page renders it.
//
// GET  /api/thinking?category=robotics[&data=1]   -> config, state, inbox (+ data window)
// POST /api/thinking  (same-origin UI): {action:'ask'|'config'|'dismiss', ...}
// POST /api/thinking  (runner, Authorization: Bearer THINKING_SECRET): {action:'run_start'|'update'|'run_end', ...}
import { kvGetJSON, kvSetJSON, kvConfigured, kvHGetAllJSON, wsKey } from '../_lib/kv';
import { getSettings, autoScansOn } from '../_lib/settings';
import { DEFAULT_PLAYBOOKS } from '../../../lib/scanAgents';
import { THINKING_CATEGORIES, DEFAULT_THINKING_CONFIG, emptyState } from '../../../lib/thinking';

export const maxDuration = 60;

const CFG_KEY = 'vh:thinking:config';
const stateKey = c => `vh:thinking:${c}`;
const inboxKey = c => `vh:thinking:${c}:inbox`;
const dismissedKey = c => `vh:thinking:${c}:dismissed`;
const validCat = c => THINKING_CATEGORIES.some(x => x.id === c);

async function getConfig() {
  const saved = (await kvGetJSON(CFG_KEY)) || {};
  return { ...DEFAULT_THINKING_CONFIG, ...saved, engine: { ...DEFAULT_THINKING_CONFIG.engine, ...(saved.engine || {}) }, categories: { ...DEFAULT_THINKING_CONFIG.categories, ...(saved.categories || {}) } };
}

const ROBOTICS_RE = /robot|automation|actuator|sensor|lidar|motor|drive|servo|gear|magnet|rare earth|machine vision|drone|autonom|humanoid|cobot|precision|motion control|semicap|photonic/i;
const pick = s => ({
  ticker: s.ticker, name: s.name, sector: s.sector || null, price: s.price ?? null, marketCapM: s.marketCap ?? null,
  netCash: !!s.netCash, positionIn52Week: s.positionIn52Week ?? null,
  lastInsiderPurchase: s.lastInsiderPurchase?.date ? { date: s.lastInsiderPurchase.date, shares: s.lastInsiderPurchase.shares, name: s.lastInsiderPurchase.name } : null,
  techScore: s.techScore ?? null, techOpinion: s.techOpinion || null, singularityScore: s.singularityScore ?? null,
  insiderConviction: s.insiderConviction ?? null, valuationScore: s.valuationScore ?? null, cupHandleScore: s.cupHandleScore ?? null,
  momentumScore: s.momentumScore ?? null, buyoutScore: s.buyoutScore ?? null, leadershipScore: s.leadershipScore ?? null,
  playbookScore: s.playbookScore ?? null, playbookBest: s.playbookBest || null, compositeScore: s.compositeScore != null ? Math.round(s.compositeScore) : null,
  tier: s.tier || null, scannedAt: s.scannedAt || null,
});

// Cheap social lead: newest r/wallstreetbets DD posts (cached 60 min; empty if Reddit refuses)
async function wsbSignals(knownTickers) {
  try {
    const cached = await kvGetJSON('vh:signals:wsb');
    if (cached && Date.now() - cached.at < 60 * 60000) return cached.posts;
    const res = await fetch('https://www.reddit.com/r/wallstreetbets/search.json?q=flair%3ADD&restrict_sr=1&sort=new&limit=25', { headers: { 'User-Agent': 'valuehunter-thinking/1.0 (research aggregator)' } });
    if (!res.ok) return cached?.posts || [];
    const j = await res.json();
    const posts = (j?.data?.children || []).map(c => c.data).filter(Boolean).map(d => {
      const text = `${d.title} ${(d.selftext || '').slice(0, 400)}`;
      const tick = new Set([...text.matchAll(/\$([A-Z]{1,5})\b/g)].map(m => m[1]));
      for (const w of text.match(/\b[A-Z]{2,5}\b/g) || []) if (knownTickers.has(w)) tick.add(w);
      return { title: d.title.slice(0, 160), tickers: [...tick].slice(0, 5), ups: d.ups, at: Math.round((d.created_utc || 0) * 1000), url: `https://www.reddit.com${d.permalink}` };
    });
    await kvSetJSON('vh:signals:wsb', { at: Date.now(), posts });
    return posts;
  } catch { return []; }
}

async function dataWindow(category) {
  const [main, scanres, singularity, watchlist, scouts, feed, settings] = await Promise.all([
    kvGetJSON(wsKey('main', 'main')), kvHGetAllJSON(wsKey('main', 'scanres')), kvHGetAllJSON(wsKey('main', 'singularity')),
    kvGetJSON('vh:watchlist'), kvGetJSON('vh:scouts:latest'), kvGetJSON('vh:research:feed'), getSettings(),
  ]);
  const stocks = (main?.stocks || []).map(s => ({ ...s, ...(singularity?.[s.ticker] || {}), ...(scanres?.[s.ticker] || {}) }));
  const eligible = stocks.filter(s => !s.tier || s.tier === 'A');
  const byComposite = (a, b) => (b.compositeScore || 0) - (a.compositeScore || 0);
  let pool;
  if (category === 'robotics') {
    pool = eligible.filter(s => (s.singularityScore ?? 0) >= 40 || ROBOTICS_RE.test(`${s.name || ''} ${s.sector || ''}`))
      .sort((a, b) => (b.singularityScore || 0) - (a.singularityScore || 0) || byComposite(a, b));
  } else if (category === 'playbook') {
    const wl = new Set(Object.keys(watchlist || {}));
    pool = eligible.filter(s => (s.playbookScore ?? 0) >= 60 || wl.has(s.ticker) || (s.insiderConviction ?? 0) >= 60 || (s.buyoutScore ?? 0) >= 60)
      .sort((a, b) => (b.playbookScore || 0) - (a.playbookScore || 0) || byComposite(a, b));
    if (pool.length < 80) pool = pool.concat(eligible.filter(s => !pool.includes(s)).sort(byComposite).slice(0, 80 - pool.length));
  } else {
    pool = [...eligible].sort(byComposite);
  }
  const wsb = await wsbSignals(new Set(stocks.map(s => s.ticker)));
  return {
    asOf: new Date().toISOString(),
    autoScansEnabled: autoScansOn(settings),
    signals: { wsb },
    universe: { total: stocks.length, eligible: eligible.length, inWindow: Math.min(pool.length, 200) },
    stocks: pool.slice(0, 200).map(pick),
    watchlist: Object.entries(watchlist || {}).map(([t, v]) => ({ ticker: t, ...(typeof v === 'object' ? { note: v.note || v.reason || null, addedAt: v.addedAt || null } : {}) })),
    scouts: scouts ? { at: scouts.at || scouts.ranAt || null, summary: JSON.stringify(scouts).slice(0, 6000) } : null,
    research: Array.isArray(feed) ? feed.slice(0, 15).map(f => ({ ticker: f.ticker, at: f.at || f.ts || null, headline: (f.headline || f.title || f.summary || '').slice(0, 300) })) : [],
    playbooks: category === 'playbook' || !category ? DEFAULT_PLAYBOOKS : DEFAULT_PLAYBOOKS.map(p => ({ id: p.id, name: p.name })),
  };
}

export async function GET(request) {
  if (!kvConfigured()) return Response.json({ error: 'KV not configured' }, { status: 500 });
  const url = new URL(request.url);
  const category = url.searchParams.get('category') || 'robotics';
  if (!validCat(category)) return Response.json({ error: 'unknown category' }, { status: 400 });
  const [config, state, inbox, dismissed] = await Promise.all([getConfig(), kvGetJSON(stateKey(category)), kvGetJSON(inboxKey(category)), kvGetJSON(dismissedKey(category))]);
  const st = state || emptyState(category);
  const dis = new Set(dismissed || []);
  st.questions = (st.questions || []).filter(q => !dis.has(q.id));
  if (st.plays?.length) {
    const main = await kvGetJSON(wsKey('main', 'main'));
    const priceOf = new Map((main?.stocks || []).map(s => [s.ticker, s.price]));
    st.plays = st.plays.map(p => { const cur = priceOf.get(p.ticker) ?? null; const pct = cur != null && p.entryPrice ? Math.round(((cur / p.entryPrice) - 1) * 1000) / 10 : null; return { ...p, currentPrice: cur, sinceEntryPct: pct }; });
  }
  const out = { config, categories: THINKING_CATEGORIES, category, state: st, inbox: inbox || [] };
  if (url.searchParams.get('data') === '1') out.data = await dataWindow(category);
  return Response.json(out);
}

function authed(request) {
  const secret = process.env.THINKING_SECRET;
  const h = request.headers.get('authorization') || '';
  const q = new URL(request.url).searchParams.get('secret');
  return Boolean(secret) && (h === `Bearer ${secret}` || q === secret);
}
function sameOrigin(request) {
  const origin = request.headers.get('origin'); const host = request.headers.get('host');
  return Boolean(origin && host && new URL(origin).host === host);
}
const id = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const clampText = (s, n) => (typeof s === 'string' ? s.slice(0, n) : '');

export async function POST(request) {
  if (!kvConfigured()) return Response.json({ error: 'KV not configured' }, { status: 500 });
  const body = await request.json().catch(() => ({}));
  const action = body.action;
  const category = body.category || 'robotics';
  const runner = authed(request);
  const ui = sameOrigin(request);
  if (!runner && !ui) return Response.json({ error: 'Forbidden' }, { status: 403 });

  // ---- UI actions (same-origin) ----
  if (action === 'config') {
    const cur = await getConfig();
    const next = { ...cur, ...(body.config || {}), engine: { ...cur.engine, ...((body.config || {}).engine || {}) }, categories: { ...cur.categories, ...((body.config || {}).categories || {}) } };
    await kvSetJSON(CFG_KEY, next);
    return Response.json({ ok: true, config: next });
  }
  if (!validCat(category)) return Response.json({ error: 'unknown category' }, { status: 400 });
  if (action === 'ask') {
    const q = clampText(body.question, 600).trim();
    if (!q) return Response.json({ error: 'empty question' }, { status: 400 });
    const inbox = (await kvGetJSON(inboxKey(category))) || [];
    inbox.push({ id: id(), question: q, askedAt: Date.now(), askedBy: 'you' });
    await kvSetJSON(inboxKey(category), inbox.slice(-50));
    return Response.json({ ok: true, inbox });
  }
  if (action === 'dismiss') {
    const inbox = ((await kvGetJSON(inboxKey(category))) || []).filter(x => x.id !== body.id);
    await kvSetJSON(inboxKey(category), inbox);
    const dis = (await kvGetJSON(dismissedKey(category))) || [];
    if (!dis.includes(body.id)) dis.push(body.id);
    await kvSetJSON(dismissedKey(category), dis.slice(-200));
    return Response.json({ ok: true });
  }

  // ---- Runner actions (secret) ----
  if (!runner) return Response.json({ error: 'runner secret required' }, { status: 403 });
  const state = (await kvGetJSON(stateKey(category))) || emptyState(category);
  if (action === 'run_start') {
    // Overlap guard: one run at a time per category (a stale run older than 95 min is ignored)
    if (state.currentRun && Date.now() - state.currentRun.startedAt < 95 * 60000 && !body.force) {
      return Response.json({ ok: false, busy: true, currentRun: state.currentRun, note: 'another run is active for this category - exit without writing' });
    }
    const run = { id: body.runId || id(), startedAt: Date.now(), model: clampText(body.model, 40) || null, mode: body.mode === 'deep' ? 'deep' : 'test' };
    state.currentRun = run;
    await kvSetJSON(stateKey(category), state);
    return Response.json({ ok: true, runId: run.id, mode: run.mode });
  }
  if (action === 'update' || action === 'run_end') {
    const runId = body.runId || state.currentRun?.id || id();
    const now = Date.now();
    if (Array.isArray(body.plays) && body.plays.length) {
      // Stamp entry price/date the first time a ticker enters the ranking so the board can score itself later
      const prev = new Map((state.plays || []).map(p => [p.ticker, p]));
      const main = await kvGetJSON(wsKey('main', 'main'));
      const priceOf = new Map((main?.stocks || []).map(s => [s.ticker, s.price]));
      state.plays = body.plays.slice(0, 15).map((p, i) => ({
        rank: i + 1, ticker: String(p.ticker || '').toUpperCase().slice(0, 8), name: clampText(p.name, 80),
        horizon: ['short', 'medium', 'long'].includes(p.horizon) ? p.horizon : null,
        entryPrice: prev.get(String(p.ticker || '').toUpperCase())?.entryPrice ?? (Number.isFinite(Number(p.price)) ? Number(p.price) : (priceOf.get(String(p.ticker || '').toUpperCase()) ?? null)),
        entryAt: prev.get(String(p.ticker || '').toUpperCase())?.entryAt ?? now,
        firstRank: prev.get(String(p.ticker || '').toUpperCase())?.firstRank ?? (i + 1),
        thesis: clampText(p.thesis, 1800), confidence: Math.max(0, Math.min(100, Number(p.confidence) || 0)),
        expectedMultiple: Number.isFinite(Number(p.expectedMultiple)) ? Math.max(0, Math.min(50, Number(p.expectedMultiple))) : null,
        probability: Number.isFinite(Number(p.probability)) ? Math.max(0, Math.min(1, Number(p.probability))) : null,
        timeframe: clampText(p.timeframe, 60), setup: clampText(p.setup, 400), invalidation: clampText(p.invalidation, 400),
        marketCapM: Number.isFinite(Number(p.marketCapM)) ? Number(p.marketCapM) : null, liquidity: clampText(p.liquidity, 60),
        downsidePct: Number.isFinite(Number(p.downsidePct)) ? Math.max(-100, Math.min(0, -Math.abs(Number(p.downsidePct)))) : null, downsideCase: clampText(p.downsideCase, 300),
        catalystDates: (Array.isArray(p.catalystDates) ? p.catalystDates : []).slice(0, 6).map(c => ({ date: clampText(c.date, 20), what: clampText(c.what, 160) })).filter(c => c.date),
        upsideCase: clampText(p.upsideCase, 700), risks: clampText(p.risks, 700), changeMind: clampText(p.changeMind, 400),
        catalysts: clampText(p.catalysts, 600), sources: (Array.isArray(p.sources) ? p.sources : []).slice(0, 10).map(s => clampText(s, 300)),
        inValueHunter: !!p.inValueHunter, updatedAt: now, runId,
      }));
    }
    if (Array.isArray(body.questions)) {
      const byId = new Map((state.questions || []).map(q => [q.id, q]));
      for (const q of body.questions.slice(0, 40)) {
        const qid = q.id || id();
        const prev = byId.get(qid) || {};
        const rec = { id: qid, question: clampText(q.question || prev.question, 500), angle: clampText(q.angle || prev.angle, 60), priority: Math.max(1, Math.min(5, Number(q.priority) || prev.priority || 3)), status: q.status === 'resolved' ? 'resolved' : 'open', answer: clampText(q.answer, 2000) || prev.answer || '', askedBy: q.askedBy || prev.askedBy || 'engine', askedAt: prev.askedAt || now, updatedAt: now, runId };
        byId.set(qid, rec);
      }
      const all = [...byId.values()];
      state.questions = all.filter(q => q.status === 'open').slice(-40);
      state.archive = [...(state.archive || []), ...all.filter(q => q.status === 'resolved' && !(state.archive || []).some(a => a.id === q.id))].slice(-150);
    }
    if (Array.isArray(body.evidence)) {
      const ev = body.evidence.slice(0, 80).map(e => ({ id: id(), at: now, runId, ticker: e.ticker ? String(e.ticker).toUpperCase().slice(0, 8) : null, finding: clampText(e.finding, 800), source: clampText(e.source, 300), impact: ['bullish', 'bearish', 'neutral'].includes(e.impact) ? e.impact : 'neutral' }));
      state.evidence = [...(state.evidence || []), ...ev].slice(-500);
    }
    if (typeof body.nextPlan === 'string') state.nextPlan = clampText(body.nextPlan, 3000);
    // The engine's own persistent notes (coverage map, hypotheses, what is verified) and its reject list
    if (typeof body.memo === 'string') state.memo = clampText(body.memo, 6000);
    if (Array.isArray(body.rejected)) {
      const cur = new Map((state.rejected || []).map(x => [x.ticker, x]));
      for (const x of body.rejected.slice(0, 40)) { const t = String(x.ticker || '').toUpperCase().slice(0, 8); if (t) cur.set(t, { ticker: t, why: clampText(x.why, 240), at: now }); }
      state.rejected = [...cur.values()].slice(-120);
    }
    if (Array.isArray(body.recommendedScans)) state.recommendedScans = body.recommendedScans.slice(0, 20).map(r => ({ ticker: String(r.ticker || r).toUpperCase().slice(0, 8), why: clampText(r.why, 200) }));
    if (Array.isArray(body.answeredInbox) && body.answeredInbox.length) {
      const inbox = ((await kvGetJSON(inboxKey(category))) || []).filter(x => !body.answeredInbox.includes(x.id));
      await kvSetJSON(inboxKey(category), inbox);
    }
    if (action === 'run_end') {
      const started = state.currentRun?.startedAt || now;
      state.runs = [...(state.runs || []), { id: runId, startedAt: started, endedAt: now, minutes: Math.round((now - started) / 60000), mode: state.currentRun?.mode || null, summary: clampText(body.summary, 1500), feedback: clampText(body.feedback, 2500), searches: Number(body.searches) || null, plays: state.plays.length, openQuestions: state.questions.length, evidence: Array.isArray(body.evidence) ? body.evidence.length : 0, model: state.currentRun?.model || null }].slice(-60);
      state.currentRun = null;
    }
    state.updatedAt = now;
    await kvSetJSON(stateKey(category), state);
    return Response.json({ ok: true, runId, plays: state.plays.length, openQuestions: state.questions.length, evidence: state.evidence.length });
  }
  return Response.json({ error: 'unknown action' }, { status: 400 });
}
