import test from 'node:test';
import assert from 'node:assert/strict';
import { BETA_METRICS, betaView, betaComposite, selectTargets, validateResult } from '../../lib/codexBeta.mjs';

function sample(ticker = 'CRDF') {
  return { ticker, summary: 'Evidence-based test fixture', playbookBest: null, risks: ['Uncertain'], nextQuestions: ['Verify filings'],
    sources: [{ url: 'https://www.sec.gov/example', title: 'Filing', accessedAt: '2026-09-06', publishedAt: null }],
    assessments: Object.fromEntries(BETA_METRICS.map(([k]) => [k, { score: 60, confidence: 'medium', reason: 'Test evidence', sources: [0] }])) };
}
test('beta view cannot leak Grok assessments or mutate stock records', () => {
  const stock = { ticker: 'CRDF', insiderConviction: 90, aiAnalysis: 'Grok', singularityScores: { compute: 10 }, buyoutPeopleScore: 90, upsideAnalysis: 'old', technicalAnalysis: 'old', valuationAnalysis: 'old', lastInsiderPurchase: { date: '2026-01-01' }, netCash: 20, techScore: 80 };
  const view = betaView(stock, sample());
  assert.equal(view.insiderConviction, 60); assert.equal(stock.insiderConviction, 90);
  for (const key of ['aiAnalysis', 'singularityScores', 'buyoutPeopleScore', 'upsideAnalysis', 'technicalAnalysis', 'valuationAnalysis']) assert.equal(view[key], undefined);
  assert.deepEqual(view.lastInsiderPurchase, stock.lastInsiderPurchase); assert.equal(view.netCash, 20); assert.equal(view.techScore, 80);
  assert.equal(betaView(stock, null).insiderConviction, null);
});
test('unknown scores excluded from beta composite; weight switches respected', () => {
  assert.equal(betaComposite({ insiderConviction: 80, valuationScore: null }, {}, { conviction: 20, valuation: 20 }, {}), 80);
  assert.equal(betaComposite({ insiderConviction: 80, valuationScore: 40 }, {}, { conviction: 20, valuation: 20 }, { conviction: false }), 40);
});
test('eligible-only queue keeps price irrelevant, skips recent beta only, scopes workspaces', () => {
  const stocks = [{ ticker: 'AAA', tier: 'A', price: 500 }, { ticker: 'BBB', tier: 'B' }, { ticker: 'CCC', tier: 'A' }];
  assert.deepEqual(selectTargets(stocks, { 'main:CCC': { scannedAt: Date.now() } }, 'main', 10), ['AAA']);
  assert.deepEqual(selectTargets(stocks, { 'main:CCC': { scannedAt: Date.now() } }, 'test', 10), ['AAA', 'CCC']);
});
test('rejects invented completeness, invalid ranges, unsupported scores and unsafe URLs', () => {
  assert.doesNotThrow(() => validateResult(sample()));
  for (const mutate of [r => delete r.assessments.singularityScore, r => r.assessments.valuationScore.score = 101, r => r.assessments.valuationScore.score = null, r => r.assessments.buyoutScore.sources = [], r => r.sources[0].url = 'javascript:alert(1)']) {
    const r = sample(); mutate(r); assert.throws(() => validateResult(r));
  }
  const r = sample(); r.assessments.cupHandleScore = { score: null, confidence: 'insufficient', reason: 'No bars', sources: [] };
  assert.equal(validateResult(r).assessments.cupHandleScore.score, null);
});
test('queue claims are exclusive; pause persists, cancel rejects late writes, save is atomic', async () => {
  const store = new Map([['vh:main', JSON.stringify({ stocks: [{ ticker: 'CRDF', tier: 'A' }, { ticker: 'BYRN', tier: 'A' }] })]]);
  const originalFetch = globalThis.fetch;
  process.env.KV_REST_API_URL = 'https://test.invalid'; process.env.KV_REST_API_TOKEN = 'fixture';
  globalThis.fetch = async (_url, opts) => {
    const [op, ...a] = JSON.parse(opts.body); let result;
    if (op === 'GET') result = store.get(a[0]) || null;
    else if (op === 'HGETALL') result = [...(store.get(a[0]) || new Map()).entries()].flat();
    else if (op === 'EVAL') {
      const count = a[1], keys = a.slice(2, 2 + count), args = a.slice(2 + count);
      if ((store.get(keys[0]) || '') !== args[0]) result = 0;
      else { store.set(keys[0], args[1]); if (count === 2) { const h = store.get(keys[1]) || new Map(); h.set(args[2], args[3]); store.set(keys[1], h); } result = 1; }
    } else throw new Error(`Unexpected command ${op}`);
    return { ok: true, json: async () => ({ result }) };
  };
  try {
    const { control, claim, complete, betaState } = await import('../../lib/codexBetaStore.mjs');
    await control('start', { limit: 3 });
    const claims = await Promise.all([claim(), claim()]); assert.equal(claims.filter(c => !c.idle).length, 1);
    const c = claims.find(c => !c.idle);
    await control('pause'); assert.equal((await claim()).idle, true);
    await complete({ ...c, result: sample(c.stock.ticker) });
    assert.equal((await betaState()).run.status, 'paused');
    await control('resume'); const second = await claim();
    await control('cancel');
    await assert.rejects(complete({ ...second, result: sample(second.stock.ticker) }), /cancelled/);
    assert.equal(Object.keys((await betaState()).results).length, 1);
    assert.equal(store.has('vh:scanres'), false); assert.equal(store.has('vh:singularity'), false); assert.equal(store.has('vh:settings'), false);
  } finally { globalThis.fetch = originalFetch; }
});

test('beta controls fail closed and signed cookies cannot be forged', async () => {
  const { authorized, login } = await import('../../lib/codexBetaAuth.mjs');
  process.env.SITE_PASSWORD = 'test-only-password';
  const req = new Request('https://example.test/api/codex-beta');
  assert.equal(authorized(req), false);
  assert.equal(login(req, 'incorrect'), null);
  const cookie = login(req, 'test-only-password');
  assert.ok(cookie.includes('HttpOnly')); assert.ok(cookie.includes('Secure'));
  assert.equal(authorized(new Request(req.url, { headers: { cookie } })), true);
  assert.equal(authorized(new Request(req.url, { headers: { cookie: cookie.replace(/vh_beta_control=./, 'vh_beta_control=0') } })), false);
  delete process.env.SITE_PASSWORD;
  assert.equal(authorized(new Request(req.url, { headers: { cookie } })), false);
});
