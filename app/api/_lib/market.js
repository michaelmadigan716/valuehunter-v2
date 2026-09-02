// Server-side port of the Base Scan qualifiers (net cash, insider buys,
// 52-week position) so the whole market can be swept on a schedule.
import { computeTechnicalOpinion } from '../../../lib/technicals';
import { classifyTier } from '../../../lib/tiers';

const POLYGON_KEY = process.env.NEXT_PUBLIC_POLYGON_KEY;
const FINNHUB_KEY = process.env.NEXT_PUBLIC_FINNHUB_KEY;

export const rate = { finnhub429: 0 };

async function fh(url) {
  const res = await fetch(url);
  if (res.status === 429) { rate.finnhub429++; return null; }
  if (!res.ok) return null;
  return res.json();
}

export async function fetchFinancials(ticker) {
  try {
    const res = await fetch(`https://api.polygon.io/vX/reference/financials?ticker=${ticker}&limit=4&sort=filing_date&order=desc&apiKey=${POLYGON_KEY}`);
    if (res.ok) {
      const data = await res.json();
      for (const r of data.results || []) {
        const bs = r?.financials?.balance_sheet || {};
        const cash = bs.cash_and_cash_equivalents?.value || bs.cash_and_short_term_investments?.value || bs.cash?.value || (bs.current_assets?.value || 0) * 0.3 || 0;
        const debt = bs.long_term_debt?.value || bs.total_debt?.value || bs.short_long_term_debt_total?.value || bs.noncurrent_liabilities?.value || (bs.total_liabilities?.value || 0) * 0.5 || 0;
        if (cash > 0 || debt > 0) return { cash, debt, netCash: cash - debt, source: 'polygon' };
      }
    }
  } catch (e) {}
  try {
    const data = FINNHUB_KEY ? await fh(`https://finnhub.io/api/v1/stock/metric?symbol=${ticker}&metric=all&token=${FINNHUB_KEY}`) : null;
    const m = data?.metric || {};
    const sharesOut = m.shareOutstanding || 0;
    const cashPerShare = m.cashPerShareAnnual || m.cashPerShareQuarterly || 0;
    const bookValue = m.bookValuePerShareAnnual || m.bookValuePerShareQuarterly || 0;
    const debtEquity = m.totalDebtToEquityAnnual || m.totalDebtToEquityQuarterly || 0;
    if (sharesOut > 0 && (cashPerShare > 0 || debtEquity > 0)) {
      const cash = cashPerShare * sharesOut * 1e6;
      const debt = bookValue * sharesOut * 1e6 * (debtEquity / 100);
      return { cash, debt, netCash: cash - debt, source: 'finnhub' };
    }
  } catch (e) {}
  return null;
}

export async function fetchInsider(ticker) {
  try {
    const data = FINNHUB_KEY ? await fh(`https://finnhub.io/api/v1/stock/insider-transactions?symbol=${ticker}&token=${FINNHUB_KEY}`) : null;
    const purchases = (data?.data || []).filter(t => t.transactionCode === 'P' && t.share > 0 && t.transactionDate);
    if (purchases.length === 0) return null;
    purchases.sort((a, b) => new Date(b.transactionDate) - new Date(a.transactionDate));
    const l = purchases[0];
    return { date: l.transactionDate, amount: (l.share || 0) * (l.transactionPrice || 0), shares: l.share || 0, price: l.transactionPrice || 0, name: l.name || 'Insider' };
  } catch (e) { return null; }
}

export async function fetchDetails(ticker) {
  try {
    const res = await fetch(`https://api.polygon.io/v3/reference/tickers/${ticker}?apiKey=${POLYGON_KEY}`);
    if (!res.ok) return null;
    return (await res.json()).results || null;
  } catch (e) { return null; }
}

export async function fetch52w(ticker) {
  try {
    const to = new Date().toISOString().split('T')[0];
    const from = new Date(Date.now() - 365 * 864e5).toISOString().split('T')[0];
    const res = await fetch(`https://api.polygon.io/v2/aggs/ticker/${ticker}/range/1/day/${from}/${to}?adjusted=true&sort=asc&limit=300&apiKey=${POLYGON_KEY}`);
    if (!res.ok) return null;
    const bars = (await res.json()).results || [];
    if (bars.length < 5) return null;
    const high52 = Math.max(...bars.map(b => b.h));
    const low52 = Math.min(...bars.map(b => b.l));
    const price = bars[bars.length - 1].c;
    const prev = bars.length > 1 ? bars[bars.length - 2].c : price;
    const last20 = bars.slice(-20);
    const avgDollarVolume = last20.reduce((a, b) => a + (b.v || 0) * b.c, 0) / last20.length;
    return { high52, low52, price, change: prev ? ((price - prev) / prev) * 100 : 0,
      positionIn52Week: high52 > low52 ? ((price - low52) / (high52 - low52)) * 100 : 50,
      fromLow: low52 > 0 ? ((price - low52) / low52) * 100 : 0,
      avgDollarVolume,
      tech: computeTechnicalOpinion(bars) };
  } catch (e) { return null; }
}

// Same scoring as the client's processStock
export function scoreStock({ positionIn52Week, insider, financials, marketCapM }) {
  const pricePosition = Math.max(0, Math.min(100, 100 - (positionIn52Week ?? 50)));
  let insiderActivity = 20;
  if (insider?.date) {
    const d = Math.floor((Date.now() - new Date(insider.date)) / 864e5);
    insiderActivity = d < 30 ? 95 : d < 60 ? 85 : d < 90 ? 70 : d < 180 ? 55 : d < 365 ? 40 : 20;
  }
  let netCash = 50;
  if (financials && marketCapM > 0) {
    if (financials.netCash > 0) netCash = Math.min(100, 50 + ((financials.netCash / 1e6) / marketCapM) * 100);
    else if (financials.netCash < 0) netCash = Math.max(0, 50 - (Math.abs(financials.netCash / 1e6) / marketCapM) * 50);
  }
  return { pricePosition, insiderActivity, netCash };
}

// Full server-side qualification of one ticker -> a stock record the
// client table can render directly
export async function qualifyTicker(ticker, hint = {}) {
  const [details, w, financials, insider] = await Promise.all([fetchDetails(ticker), fetch52w(ticker), fetchFinancials(ticker), fetchInsider(ticker)]);
  const price = w?.price ?? hint.price ?? null;
  if (price === null) return null;
  const marketCapM = details?.market_cap ? Math.round(details.market_cap / 1e6) : (hint.marketCap || 0);
  const agentScores = scoreStock({ positionIn52Week: w?.positionIn52Week, insider, financials, marketCapM });
  const rec = {
    ticker,
    name: details?.name || hint.name || ticker,
    sector: details?.sic_description || 'Unknown',
    price,
    marketCap: marketCapM,
    change: w?.change ?? 0,
    high52: w?.high52 ?? null, low52: w?.low52 ?? null,
    positionIn52Week: w?.positionIn52Week ?? null, fromLow: w?.fromLow ?? null,
    cash: financials?.cash || 0, debt: financials?.debt || 0, netCash: financials?.netCash || 0,
    hasFinancials: financials !== null, financialSource: financials?.source || null,
    lastInsiderPurchase: insider, hasInsiderData: insider !== null,
    agentScores, compositeScore: 0, aiAnalysis: null,
    ...(w?.tech ? { techScore: w.tech.techScore, techOpinion: w.tech.techOpinion, techBuys: w.tech.techBuys, techSells: w.tech.techSells } : {}),
    sicCode: details?.sic_code || null,
    avgDollarVolume: w?.avgDollarVolume ?? null,
    sweptAt: Date.now(),
  };
  const t = classifyTier(rec);
  rec.tier = t.tier; rec.tierReason = t.reason;
  return rec;
}
