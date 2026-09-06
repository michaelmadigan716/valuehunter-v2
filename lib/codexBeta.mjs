// Independent beta schema. Never write these assessments into Grok result keys.
export const BETA_METRICS = [
  ['insiderConviction', 'Insider conviction'], ['cupHandleScore', 'Cup & handle'],
  ['valuationScore', 'Valuation'], ['momentumScore', 'Momentum'],
  ['buyoutScore', 'Buyout evidence'], ['leadershipScore', 'Leadership'],
  ['playbookScore', 'Playbook match'], ['singularityScore', 'Singularity'],
];
export const BETA_RUN_KEY = 'vh:codex-beta:run';
export const BETA_RESULTS_KEY = 'vh:codex-beta:results';
export function resultKey(ws, ticker) { return `${ws}:${ticker}`; }
export function betaView(stock, result) {
  const view = { ...stock };
  // A view-only copy: neither original stocks nor saved Grok results change.
  for (const key of Object.keys(view)) {
    if (/^(momentum|buyout|leadership|playbook|passion|team|explosive|singularity|parabolic|oracle|supplyChain|upside|valuation)/.test(key)
      || ['aiAnalysis', 'technicalAnalysis', 'insiderConviction', 'cupHandleScore', 'prediction', 'scannedAt'].includes(key)) delete view[key];
  }
  for (const [key] of BETA_METRICS) view[key] = result?.assessments?.[key]?.score ?? null;
  view.betaResult = result || null;
  view.playbookBest = result?.playbookBest || null;
  return view;
}
export function betaComposite(stock, weights, aiWeights, enabled) {
  let points = 0, total = 0;
  const add = (key, weight, score) => {
    if (enabled[key] !== false && weight > 0 && Number.isFinite(score)) { points += weight * score; total += weight; }
  };
  for (const [key, weight] of Object.entries(weights)) add(key, weight, key === 'optionsHeat' ? stock.swingTradeScore : stock.agentScores?.[key]);
  const fields = { conviction: 'insiderConviction', cupHandle: 'cupHandleScore', valuation: 'valuationScore', momentum: 'momentumScore', buyout: 'buyoutScore', leadership: 'leadershipScore', playbook: 'playbookScore', singularity: 'singularityScore', technicals: 'techScore' };
  for (const [key, field] of Object.entries(fields)) add(key, aiWeights[key], stock[field]);
  return total ? points / total : 0;
}
export function stockContext(s) {
  const fields = ['ticker', 'name', 'sector', 'price', 'marketCap', 'cash', 'debt', 'netCash',
    'hasFinancials', 'financialSource', 'lastInsiderPurchase', 'hasInsiderData', 'high52', 'low52',
    'positionIn52Week', 'avgDollarVolume', 'techScore', 'techOpinion', 'techSignals', 'tier', 'tierReason', 'refreshed', 'sweptAt'];
  return Object.fromEntries(fields.filter(k => s[k] !== undefined).map(k => [k, s[k]]));
}
export function selectTargets(stocks, results, ws, limit, now = Date.now()) {
  return stocks.filter(s => s.tier === 'A' && /^[A-Z0-9.-]{1,12}$/.test(s.ticker))
    .filter(s => !results[resultKey(ws, s.ticker)] || now - results[resultKey(ws, s.ticker)].scannedAt >= 7 * 864e5)
    .slice(0, limit).map(s => s.ticker);
}
export function validateResult(input) {
  if (!input || !/^[A-Z0-9.-]{1,12}$/.test(input.ticker)) throw new Error('Valid ticker required');
  if (typeof input.summary !== 'string' || !input.summary.trim() || input.summary.length > 5000) throw new Error('Summary required (max 5000 characters)');
  if (!Array.isArray(input.sources) || input.sources.length > 20) throw new Error('Sources array required (max 20)');
  const sources = input.sources.map(s => {
    let u; try { u = new URL(s.url); } catch { throw new Error('Invalid source URL'); }
    if (u.protocol !== 'https:' || !s.title || typeof s.title !== 'string' || s.title.length > 500) throw new Error('Source needs HTTPS URL and title');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.accessedAt || '')) throw new Error('Source access date required');
    return { url: u.href, title: s.title, publishedAt: typeof s.publishedAt === 'string' ? s.publishedAt.slice(0, 30) : null, accessedAt: s.accessedAt };
  });
  const assessments = {};
  for (const [key] of BETA_METRICS) {
    const a = input.assessments?.[key];
    if (!a || !(a.score === null || (Number.isInteger(a.score) && a.score >= 0 && a.score <= 100))) throw new Error(`Invalid or missing ${key}`);
    if (!['low', 'medium', 'high', 'insufficient'].includes(a.confidence)) throw new Error(`Invalid confidence: ${key}`);
    if ((a.score === null) !== (a.confidence === 'insufficient')) throw new Error(`Unknown score must have insufficient confidence: ${key}`);
    if (typeof a.reason !== 'string' || !a.reason.trim() || a.reason.length > 3000) throw new Error(`Reason required: ${key}`);
    if (!Array.isArray(a.sources) || a.sources.some(n => !Number.isInteger(n) || n < 0 || n >= sources.length)) throw new Error(`Invalid source references: ${key}`);
    if (a.score !== null && !a.sources.length) throw new Error(`Scored assessment requires sources: ${key}`);
    assessments[key] = { score: a.score, confidence: a.confidence, reason: a.reason, sources: [...new Set(a.sources)] };
  }
  for (const key of ['risks', 'nextQuestions']) if (!Array.isArray(input[key]) || input[key].length > 12 || input[key].some(s => typeof s !== 'string' || s.length > 2000)) throw new Error(`Invalid ${key}`);
  return { schemaVersion: 1, provider: 'codex-subscription', ticker: input.ticker, summary: input.summary,
    assessments, sources, risks: input.risks, nextQuestions: input.nextQuestions,
    playbookBest: typeof input.playbookBest === 'string' ? input.playbookBest.slice(0, 100) : null };
}
