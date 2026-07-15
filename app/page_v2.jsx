'use client';

import React, { useState, useEffect } from 'react';
import { Search, Brain, Zap, RefreshCw, ChevronDown, ChevronUp, X, Plus, Trash2, Play, Building2, Factory, Sparkles, AlertCircle, Edit3, Save, Calculator, Users } from 'lucide-react';

// ============================================
// API CONFIGURATION
// ============================================
const POLYGON_KEY = process.env.NEXT_PUBLIC_POLYGON_KEY || '';
const FINNHUB_KEY = process.env.NEXT_PUBLIC_FINNHUB_KEY || '';
const SESSIONS_KEY = 'singularity_finder_v2_sessions';

// Bulk JSON extraction rounds: fast non-reasoning model.
// Deep per-stock analysis and research: flagship reasoning model.
const SCAN_MODEL = 'grok-4.20-non-reasoning';
const DEEP_MODEL = 'grok-4.5';

// ============================================
// MEGA STOCKS - Core Singularity Players
// ============================================
const DEFAULT_MEGA_STOCKS = [
  { ticker: 'NVDA', name: 'NVIDIA Corporation', category: 'AI Compute', description: 'GPU leader, AI training infrastructure' },
  { ticker: 'TSLA', name: 'Tesla Inc', category: 'Robotics/Energy', description: 'EVs, Optimus robot, energy storage' },
  { ticker: 'MSFT', name: 'Microsoft Corporation', category: 'AI Platform', description: 'Azure AI, OpenAI partnership, Copilot' },
  { ticker: 'GOOGL', name: 'Alphabet Inc', category: 'AI Platform', description: 'DeepMind, TPUs, Gemini AI' },
  { ticker: 'AMD', name: 'Advanced Micro Devices', category: 'AI Compute', description: 'GPUs, data center chips' },
  { ticker: 'ASML', name: 'ASML Holding', category: 'Chip Equipment', description: 'EUV lithography monopoly' },
  { ticker: 'TSM', name: 'Taiwan Semiconductor', category: 'Chip Manufacturing', description: 'Advanced chip fabrication' },
  { ticker: 'AVGO', name: 'Broadcom Inc', category: 'AI Networking', description: 'Custom AI chips, networking' },
  { ticker: 'META', name: 'Meta Platforms', category: 'AI Platform', description: 'LLaMA AI, Reality Labs' },
  { ticker: 'AMZN', name: 'Amazon.com', category: 'AI Cloud', description: 'AWS AI services, robotics' },
];

const SUPPLIER_CATEGORIES = {
  direct: { name: 'Direct Suppliers', color: '#10B981' },
  potential: { name: 'Potential Suppliers', color: '#F59E0B' },
  pickShovel: { name: 'Pick & Shovel', color: '#8B5CF6' },
  secondOrder: { name: 'Second Order', color: '#3B82F6' },
};

// ============================================
// API HELPER FUNCTIONS
// ============================================

// Run fn over items with limited concurrency; results come back in input
// order and onProgress fires as each item completes.
async function mapLimit(items, limit, fn, onProgress) {
  const results = new Array(items.length);
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = await fn(items[i], i);
      } catch (e) {
        console.error('mapLimit item failed:', e);
        results[i] = null;
      }
      done++;
      if (onProgress) onProgress(done, items.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function getStockData(ticker) {
  try {
    const from = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const to = new Date().toISOString().split('T')[0];
    const [detailsRes, prevRes, weekRes] = await Promise.all([
      fetch(`https://api.polygon.io/v3/reference/tickers/${ticker}?apiKey=${POLYGON_KEY}`),
      fetch(`https://api.polygon.io/v2/aggs/ticker/${ticker}/prev?adjusted=true&apiKey=${POLYGON_KEY}`),
      fetch(`https://api.polygon.io/v2/aggs/ticker/${ticker}/range/1/day/${from}/${to}?adjusted=true&sort=desc&limit=260&apiKey=${POLYGON_KEY}`)
    ]);

    const details = detailsRes.ok ? (await detailsRes.json()).results : null;
    const prev = prevRes.ok ? (await prevRes.json()).results?.[0] : null;
    const week = weekRes.ok ? (await weekRes.json()).results || [] : [];

    if (!prev) return null;

    const price = prev.c;
    const marketCap = details?.market_cap ? Math.round(details.market_cap / 1000000) : null;
    const high52 = week.length > 0 ? Math.max(...week.map(d => d.h)) : price;
    const low52 = week.length > 0 ? Math.min(...week.map(d => d.l)) : price;

    return {
      ticker,
      name: details?.name || ticker,
      sector: details?.sic_description || 'Unknown',
      price,
      marketCap,
      high52,
      low52,
      fromLow: low52 > 0 ? ((price - low52) / low52) * 100 : 0,
      fromHigh: high52 > 0 ? ((high52 - price) / high52) * 100 : 0,
    };
  } catch (e) {
    console.error(`Failed to get data for ${ticker}:`, e);
    return null;
  }
}

// Fundamentals + insider activity from Finnhub (best-effort, null if unavailable)
async function getFundamentals(ticker) {
  if (!FINNHUB_KEY) return null;
  try {
    const [metricRes, insiderRes] = await Promise.all([
      fetch(`https://finnhub.io/api/v1/stock/metric?symbol=${ticker}&metric=all&token=${FINNHUB_KEY}`),
      fetch(`https://finnhub.io/api/v1/stock/insider-transactions?symbol=${ticker}&token=${FINNHUB_KEY}`)
    ]);
    const metric = metricRes.ok ? (await metricRes.json()).metric || {} : {};
    const insider = insiderRes.ok ? (await insiderRes.json()).data || [] : [];

    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    let insiderBought = 0, insiderSold = 0;
    for (const t of insider) {
      const ts = new Date(t.transactionDate).getTime();
      if (isNaN(ts) || ts < cutoff) continue;
      if (t.change > 0) insiderBought += t.change;
      else insiderSold += -t.change;
    }

    const pick = v => (typeof v === 'number' && isFinite(v) ? v : null);
    return {
      peRatio: pick(metric.peTTM ?? metric.peBasicExclExtraTTM),
      revenueGrowth: pick(metric.revenueGrowthTTMYoy),
      grossMargin: pick(metric.grossMarginTTM),
      netMargin: pick(metric.netProfitMarginTTM),
      roe: pick(metric.roeTTM),
      eps: pick(metric.epsTTM),
      cashFlowPerShare: pick(metric.cashFlowPerShareTTM),
      revenuePerShare: pick(metric.revenuePerShareTTM),
      debtToEquity: pick(metric['totalDebt/totalEquityQuarterly']),
      insiderBought3m: insiderBought,
      insiderSold3m: insiderSold,
    };
  } catch (e) {
    console.error(`Finnhub failed for ${ticker}:`, e);
    return null;
  }
}

function fundamentalsSummary(f) {
  if (!f) return 'No fundamental data available.';
  const parts = [];
  if (f.peRatio != null) parts.push(`P/E (TTM): ${f.peRatio.toFixed(1)}`);
  if (f.revenueGrowth != null) parts.push(`Revenue growth YoY: ${f.revenueGrowth.toFixed(1)}%`);
  if (f.grossMargin != null) parts.push(`Gross margin: ${f.grossMargin.toFixed(1)}%`);
  if (f.netMargin != null) parts.push(`Net margin: ${f.netMargin.toFixed(1)}%`);
  if (f.roe != null) parts.push(`ROE: ${f.roe.toFixed(1)}%`);
  if (f.eps != null) parts.push(`EPS (TTM): $${f.eps.toFixed(2)}`);
  if (f.cashFlowPerShare != null) parts.push(`Cash flow/share (TTM): $${f.cashFlowPerShare.toFixed(2)}`);
  if (f.revenuePerShare != null) parts.push(`Revenue/share (TTM): $${f.revenuePerShare.toFixed(2)}`);
  if (f.debtToEquity != null) parts.push(`Debt/equity: ${f.debtToEquity.toFixed(2)}`);
  parts.push(`Insider shares bought (3mo): ${Math.round(f.insiderBought3m).toLocaleString()}`);
  parts.push(`Insider shares sold (3mo): ${Math.round(f.insiderSold3m).toLocaleString()}`);
  return parts.join(' | ');
}

// ============================================
// GROK AI FUNCTIONS
// ============================================
async function callGrokAI(prompt, { model = SCAN_MODEL, json = false } = {}) {
  const response = await fetch("/api/grok", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, model, jsonMode: json })
  });
  if (!response.ok) throw new Error((await response.json()).error || response.status);
  return (await response.json()).analysis || '';
}

// Parse a JSON-mode response; falls back to bracket extraction if the model
// wrapped the payload in anything.
function parseJson(text, fallbackPattern) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(fallbackPattern);
    if (match) {
      try { return JSON.parse(match[0]); } catch { /* fall through */ }
    }
    return null;
  }
}

async function findSupplierCandidates(megaStock) {
  const prompt = `Find 10-15 small/mid-cap companies (under $10B market cap) that supply to or could supply to ${megaStock.ticker} (${megaStock.name} - ${megaStock.category}).

Focus on: ${megaStock.category === 'AI Compute' ? 'Semiconductor equipment, memory, cooling, power, PCB' :
megaStock.category === 'Robotics/Energy' ? 'Motors, actuators, sensors, batteries, rare earths, magnets' :
megaStock.category === 'AI Platform' ? 'Data center infrastructure, networking, storage, security' :
megaStock.category === 'Chip Equipment' ? 'Optics, precision motion, vacuum systems, chemicals' :
megaStock.category === 'Chip Manufacturing' ? 'Materials, gases, chemicals, test equipment' :
megaStock.category === 'AI Networking' ? 'Optical components, connectors, cables, switch chips' :
'Servers, storage, cooling, power, robotics'}

Respond with JSON: {"candidates":[{"ticker":"XXXX","reason":"why they supply","confidence":"high/medium/low","category":"direct/potential/pickShovel/secondOrder"}]}`;

  try {
    const response = await callGrokAI(prompt, { json: true });
    const parsed = parseJson(response, /\{[\s\S]*\}/);
    return parsed?.candidates || (Array.isArray(parsed) ? parsed : []);
  } catch (e) {
    console.error(`Failed for ${megaStock.ticker}:`, e);
    return [];
  }
}

async function validateSuppliers(candidates, megaStocks) {
  const tickers = [...new Set(candidates.map(c => c.ticker))].slice(0, 40).join(', ');
  const megas = megaStocks.map(m => m.ticker).join(', ');

  const prompt = `Validate these supplier stocks: ${tickers}
For mega stocks: ${megas}

Respond with JSON: {"validated":[{"ticker":"XXXX","name":"Company Name","business":"What they do","singularityScore":85,"category":"direct/potential/pickShovel/secondOrder","suppliesTo":["NVDA"],"confidence":"high/medium/low"}]}

Only include real, relevant, publicly traded stocks. Drop anything that is not a genuine supplier or picks-and-shovels play. NEVER include the mega stocks themselves (${megas}) or any other mega-cap company - we only want small/mid-cap suppliers under $10B market cap.`;

  try {
    const response = await callGrokAI(prompt, { json: true });
    const parsed = parseJson(response, /\{[\s\S]*\}/);
    return parsed?.validated || (Array.isArray(parsed) ? parsed : []);
  } catch (e) {
    console.error('Validation failed:', e);
    return [];
  }
}

async function deepAnalyzeCandidate(stock) {
  const prompt = `Deep analysis of ${stock.ticker} (${stock.name}) as a singularity supply-chain play.
Business: ${stock.business || 'Unknown'}
Category: ${stock.category || 'Unknown'}
Price: $${stock.price?.toFixed(2) ?? '?'} | Market cap: $${stock.marketCap ?? '?'}M
52-week range: $${stock.low52?.toFixed(2) ?? '?'} - $${stock.high52?.toFixed(2) ?? '?'}
Fundamentals: ${fundamentalsSummary(stock.fundamentals)}

Weigh the fundamentals and insider activity in your conviction.
Also rate the quality of the management team (teamScore 0-100): CEO and leadership track record, execution history, capital allocation discipline, insider ownership alignment, and R&D/strategic focus.
Respond with JSON: {"ticker":"${stock.ticker}","convictionScore":85,"teamScore":75,"teamNotes":"1-2 sentences on management quality","targetUpside":"+150%","timeframe":"6-12 months","thesis":"2-3 sentence thesis"}`;

  try {
    const response = await callGrokAI(prompt, { model: DEEP_MODEL, json: true });
    return parseJson(response, /\{[\s\S]*\}/);
  } catch (e) {
    return null;
  }
}

// Iterative DCF forecast: each run sees the previous runs' assumptions and
// open data gaps, so the estimate refines as you re-run it over time.
async function runDcfAnalysis(stock, priorRuns) {
  const history = (priorRuns || []).slice(-3).map((r, i) =>
    `Run ${i + 1} (${new Date(r.timestamp).toLocaleDateString()}): fair value $${r.fairValue}, assumptions ${JSON.stringify(r.assumptions)}, open data gaps: ${(r.dataGaps || []).join('; ') || 'none noted'}`
  ).join('\n');

  const prompt = `Build a discounted cash flow (DCF) estimate for ${stock.ticker} (${stock.name}).
Current price: $${stock.price?.toFixed(2) ?? '?'} | Market cap: $${stock.marketCap ?? '?'}M
Fundamentals: ${fundamentalsSummary(stock.fundamentals)}
${history ? `\nPrevious DCF runs on this stock (refine them - address the data gaps, adjust assumptions you now believe were wrong):\n${history}` : '\nThis is the first DCF run on this stock.'}

Project free cash flow 5 years out, pick a defensible WACC and terminal growth rate, and derive fair value per share. Be explicit about what data you are missing that would most improve the next run.
Respond with JSON: {"fairValue":42.50,"upsidePct":35,"assumptions":{"fcfGrowth5y":"18%/yr","wacc":"10.5%","terminalGrowth":"3%"},"confidence":"low/medium/high","summary":"3-4 sentence walkthrough of the valuation","dataGaps":["missing datapoint 1","missing datapoint 2"],"nextSteps":"what to investigate before the next run"}`;

  const response = await callGrokAI(prompt, { model: DEEP_MODEL, json: true });
  const parsed = parseJson(response, /\{[\s\S]*\}/);
  if (!parsed || typeof parsed.fairValue !== 'number') throw new Error('DCF analysis returned no usable estimate');
  return { ...parsed, price: stock.price ?? null, timestamp: Date.now() };
}

async function getConvictionAnalysis(stock) {
  const prompt = `Analyze ${stock.ticker} (${stock.name}).
Price: $${stock.price?.toFixed(2)} | MCap: $${stock.marketCap}M
52W: $${stock.low52?.toFixed(2)} - $${stock.high52?.toFixed(2)}
+${stock.fromLow?.toFixed(1)}% from low | -${stock.fromHigh?.toFixed(1)}% from high
Fundamentals: ${fundamentalsSummary(stock.fundamentals)}

What's the investment case? Weigh fundamentals and insider activity. Rate conviction 0-100.
End with: CONVICTION_SCORE: [0-100]`;

  try {
    const response = await fetch("/api/grok", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, model: DEEP_MODEL })
    });
    if (!response.ok) throw new Error((await response.json()).error || response.status);
    const data = await response.json();
    return { analysis: data.analysis || '', convictionScore: data.convictionScore ?? null };
  } catch (e) {
    return { analysis: `Error: ${e.message}`, convictionScore: null };
  }
}

// ============================================
// MAIN COMPONENT
// ============================================
export default function SingularityFinderV2() {
  const [activeSection, setActiveSection] = useState('finder');
  const [megaStocks, setMegaStocks] = useState(DEFAULT_MEGA_STOCKS);
  const [editingMega, setEditingMega] = useState(false);
  const [newMegaTicker, setNewMegaTicker] = useState('');
  const [foundStocks, setFoundStocks] = useState([]);
  const [scanStatus, setScanStatus] = useState({ phase: 'idle', message: '', progress: 0 });
  const [isScanning, setIsScanning] = useState(false);
  const [scanIteration, setScanIteration] = useState(0);
  const [scanDepth, setScanDepth] = useState(10);
  const [researchTicker, setResearchTicker] = useState('');
  const [researchResults, setResearchResults] = useState([]);
  const [isResearching, setIsResearching] = useState(false);
  const [expandedStock, setExpandedStock] = useState(null);
  const [error, setError] = useState(null);
  const [dcfHistory, setDcfHistory] = useState({});
  const [dcfRunning, setDcfRunning] = useState(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(SESSIONS_KEY);
      if (saved) {
        const data = JSON.parse(saved);
        if (data.megaStocks) setMegaStocks(data.megaStocks);
        if (data.foundStocks) setFoundStocks(data.foundStocks);
        if (data.researchResults) setResearchResults(data.researchResults);
        if (data.scanDepth) setScanDepth(data.scanDepth);
        if (data.dcfHistory) setDcfHistory(data.dcfHistory);
      }
    } catch (e) {}
  }, []);

  useEffect(() => {
    if (foundStocks.length > 0 || researchResults.length > 0 || Object.keys(dcfHistory).length > 0) {
      localStorage.setItem(SESSIONS_KEY, JSON.stringify({ megaStocks, foundStocks, researchResults, scanDepth, dcfHistory, timestamp: Date.now() }));
    }
  }, [megaStocks, foundStocks, researchResults, scanDepth, dcfHistory]);

  const runDcf = async (stock) => {
    const ticker = stock.ticker;
    if (dcfRunning) return;
    setDcfRunning(ticker);
    setError(null);
    try {
      let full = stock;
      if (!full.price) {
        const stockData = await getStockData(ticker);
        if (!stockData) throw new Error(`Could not fetch market data for ${ticker}`);
        full = { ...stockData, ...full, price: stockData.price, marketCap: stockData.marketCap };
      }
      if (!full.fundamentals) {
        full = { ...full, fundamentals: await getFundamentals(ticker) };
      }
      const run = await runDcfAnalysis(full, dcfHistory[ticker]);
      setDcfHistory(prev => ({ ...prev, [ticker]: [...(prev[ticker] || []), run].slice(-10) }));
    } catch (e) {
      setError(`DCF failed for ${ticker}: ${e.message}`);
    } finally {
      setDcfRunning(null);
    }
  };

  const renderDcf = (stock) => {
    const runs = dcfHistory[stock.ticker] || [];
    const latest = runs[runs.length - 1];
    const running = dcfRunning === stock.ticker;
    return (
      <div className="p-3 rounded-lg bg-slate-800/50">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <p className="text-xs text-slate-500 flex items-center gap-1.5"><Calculator className="w-3.5 h-3.5" />DCF Forecast{runs.length > 0 && <span className="text-slate-600">· {runs.length} run{runs.length > 1 ? 's' : ''}</span>}</p>
          <button onClick={(e) => { e.stopPropagation(); runDcf(stock); }} disabled={!!dcfRunning} className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap" style={{ background: running ? 'rgba(16,185,129,0.15)' : 'linear-gradient(90deg, #10b981, #059669)', color: running ? '#6ee7b7' : 'white', opacity: dcfRunning && !running ? 0.5 : 1 }}>
            {running ? <><RefreshCw className="w-3 h-3 animate-spin" />Running DCF...</> : <><Calculator className="w-3 h-3" />{latest ? 'Refine DCF' : 'Run DCF'}</>}
          </button>
        </div>
        {latest ? (
          <>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-2">
              <span className="text-xl font-bold text-white">${latest.fairValue?.toFixed(2)}</span>
              <span className={`text-sm font-semibold ${latest.upsidePct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{latest.upsidePct >= 0 ? '+' : ''}{latest.upsidePct?.toFixed(0)}% vs price</span>
              {latest.confidence && <span className="text-xs text-slate-500 capitalize">{latest.confidence} confidence</span>}
            </div>
            {latest.assumptions && (
              <div className="flex flex-wrap gap-2 mb-2 text-xs">
                {Object.entries(latest.assumptions).map(([k, v]) => <span key={k} className="px-2 py-1 rounded bg-slate-700/50 text-slate-300">{k}: {String(v)}</span>)}
              </div>
            )}
            {latest.summary && <p className="text-sm text-slate-300 break-words">{latest.summary}</p>}
            {latest.dataGaps?.length > 0 && <p className="mt-2 text-xs text-amber-400/80 break-words">To improve next run: {latest.dataGaps.join('; ')}</p>}
            {latest.nextSteps && <p className="mt-1 text-xs text-slate-500 break-words">Next: {latest.nextSteps}</p>}
          </>
        ) : (
          <p className="text-sm text-slate-500">No DCF yet. Each run refines the last one's assumptions and chases down its open data gaps.</p>
        )}
      </div>
    );
  };

  const runSupplierScan = async () => {
    if (isScanning) return;
    setIsScanning(true);
    setError(null);
    setFoundStocks([]);
    setScanIteration(0);

    try {
      // Round 1: Find candidates per mega stock. Limited concurrency for
      // speed, but results are assembled in mega-stock order.
      setScanStatus({ phase: 'round1', message: `Round 1: finding supplier candidates (0/${megaStocks.length})...`, progress: 0 });
      const perMega = await mapLimit(
        megaStocks, 3,
        (mega) => findSupplierCandidates(mega),
        (done, total) => setScanStatus({ phase: 'round1', message: `Round 1: finding supplier candidates (${done}/${total})...`, progress: (done / total) * 25 })
      );
      const megaTickers = new Set(megaStocks.map(m => m.ticker.toUpperCase()));
      const allCandidates = perMega.flatMap((candidates, i) =>
        (candidates || []).map(c => ({ ...c, sourceMega: megaStocks[i].ticker }))
      ).filter(c => c.ticker && !megaTickers.has(c.ticker.toUpperCase()));
      setScanIteration(1);
      if (allCandidates.length === 0) throw new Error('No supplier candidates found - try again');

      // Round 2: Validate the full candidate set in one pass
      setScanStatus({ phase: 'round2', message: `Round 2: validating ${allCandidates.length} candidates...`, progress: 25 });
      const validated = await validateSuppliers(allCandidates, megaStocks);
      setScanIteration(2);
      if (validated.length === 0) throw new Error('No candidates survived validation - try again');

      // Round 3a: Market data for the top candidates, then enforce the
      // small/mid-cap rule with real numbers - the AI sometimes sneaks
      // mega caps through validation.
      const MAX_SUPPLIER_MCAP_M = 15000; // $15B ceiling
      const ranked = validated
        .filter(v => v.ticker && !megaTickers.has(v.ticker.toUpperCase()))
        .sort((a, b) => (b.singularityScore || 0) - (a.singularityScore || 0))
        .slice(0, scanDepth * 3);
      setScanStatus({ phase: 'round3', message: `Round 3: fetching market data (0/${ranked.length})...`, progress: 50 });
      const withData = await mapLimit(
        ranked, 5,
        async (cand) => {
          const stockData = await getStockData(cand.ticker);
          if (!stockData) return null;
          if (stockData.marketCap && stockData.marketCap > MAX_SUPPLIER_MCAP_M) return null;
          return { ...stockData, ...cand };
        },
        (done, total) => setScanStatus({ phase: 'round3', message: `Round 3: fetching market data (${done}/${total})...`, progress: 50 + (done / total) * 10 })
      );
      const top = withData.filter(Boolean).slice(0, scanDepth);
      if (top.length === 0) throw new Error('No small/mid-cap suppliers survived the market-cap filter - try again');

      // Round 3b: Fundamentals + deep AI analysis on the survivors
      setScanStatus({ phase: 'round3', message: `Round 3: deep analysis (0/${top.length})...`, progress: 60 });
      const analyzed = await mapLimit(
        top, 3,
        async (cand) => {
          const fundamentals = await getFundamentals(cand.ticker);
          const deep = await deepAnalyzeCandidate({ ...cand, fundamentals });
          return {
            ...cand,
            fundamentals,
            deepAnalysis: deep,
            convictionScore: deep?.convictionScore || cand.singularityScore || 50,
          };
        },
        (done, total) => setScanStatus({ phase: 'round3', message: `Round 3: deep analysis (${done}/${total})...`, progress: 60 + (done / total) * 30 })
      );
      const stocksWithData = analyzed.filter(Boolean);
      setScanIteration(3);

      // Round 4: Final scoring
      setScanStatus({ phase: 'round4', message: 'Round 4: final scoring...', progress: 90 });
      const final = stocksWithData
        .map(s => ({ ...s, finalScore: Math.round((s.convictionScore || 50) * 0.35 + (s.singularityScore || 50) * 0.25 + (s.deepAnalysis?.teamScore || 50) * 0.2 + (s.confidence === 'high' ? 100 : s.confidence === 'medium' ? 70 : 40) * 0.2) }))
        .sort((a, b) => b.finalScore - a.finalScore);

      setScanIteration(4);
      setFoundStocks(final);
      setScanStatus({ phase: 'complete', message: `Found ${final.length} suppliers!`, progress: 100 });
    } catch (e) {
      setError(`Scan failed: ${e.message}`);
      setScanStatus({ phase: 'error', message: e.message, progress: 0 });
    } finally {
      setIsScanning(false);
    }
  };

  const runDeepResearch = async () => {
    if (!researchTicker.trim() || isResearching) return;
    setIsResearching(true);
    setError(null);
    try {
      const ticker = researchTicker.toUpperCase().trim();
      const stockData = await getStockData(ticker);
      if (!stockData) throw new Error(`Could not find ${ticker}`);
      const fundamentals = await getFundamentals(ticker);
      const conviction = await getConvictionAnalysis({ ...stockData, fundamentals });
      setResearchResults(prev => [{ ...stockData, fundamentals, ...conviction, timestamp: Date.now() }, ...prev.filter(r => r.ticker !== ticker)].slice(0, 20));
      setResearchTicker('');
    } catch (e) {
      setError(`Research failed: ${e.message}`);
    } finally {
      setIsResearching(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      <header className="border-b border-slate-800/50 bg-slate-900/80 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 shrink-0 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
              <Zap className="w-6 h-6 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent truncate">Singularity Finder</h1>
              <p className="text-xs text-slate-500 truncate">Find the picks & shovels of the AI revolution</p>
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <button onClick={() => setActiveSection('finder')} className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap ${activeSection === 'finder' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}>
              <Search className="w-4 h-4 inline mr-2" />Stock Finder
            </button>
            <button onClick={() => setActiveSection('research')} className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap ${activeSection === 'research' ? 'bg-violet-500/20 text-violet-400 border border-violet-500/30' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}>
              <Brain className="w-4 h-4 inline mr-2" />Deep Research
            </button>
          </div>
        </div>
      </header>

      {error && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 mt-4">
          <div className="p-4 rounded-xl border bg-red-500/10 border-red-500/30 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 shrink-0 text-red-400" />
            <p className="text-sm text-red-300 flex-1 min-w-0 break-words">{error}</p>
            <button onClick={() => setError(null)} className="shrink-0 text-red-400"><X className="w-4 h-4" /></button>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {activeSection === 'finder' && (
          <div className="space-y-6">
            {/* Mega Stocks */}
            <div className="rounded-2xl border border-slate-800/50 bg-slate-900/30 overflow-hidden">
              <div className="p-4 border-b border-slate-800/50 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 shrink-0 rounded-lg bg-amber-500/20 flex items-center justify-center"><Building2 className="w-4 h-4 text-amber-400" /></div>
                  <div className="min-w-0"><h2 className="font-semibold text-white">Mega Stocks</h2><p className="text-xs text-slate-500">Core singularity companies</p></div>
                </div>
                <button onClick={() => setEditingMega(!editingMega)} className="shrink-0 px-3 py-1.5 rounded-lg text-sm border border-slate-700/50 text-slate-400 hover:bg-slate-800 whitespace-nowrap">
                  {editingMega ? <><Save className="w-4 h-4 inline mr-1" />Done</> : <><Edit3 className="w-4 h-4 inline mr-1" />Edit</>}
                </button>
              </div>
              <div className="p-4 flex flex-wrap gap-2">
                {megaStocks.map((stock, i) => (
                  <div key={stock.ticker} className="px-3 py-2 rounded-lg border bg-slate-800/50 border-slate-700/50 flex items-center gap-2">
                    <span className="font-mono font-semibold text-amber-400">{stock.ticker}</span>
                    <span className="text-xs text-slate-500">{stock.category}</span>
                    {editingMega && <button onClick={() => setMegaStocks(prev => prev.filter((_, idx) => idx !== i))} className="text-red-400 ml-1"><X className="w-3 h-3" /></button>}
                  </div>
                ))}
                {editingMega && (
                  <div className="flex items-center gap-2">
                    <input type="text" value={newMegaTicker} onChange={e => setNewMegaTicker(e.target.value.toUpperCase())} placeholder="TICKER" className="w-24 px-3 py-2 rounded-lg text-sm border bg-slate-800/50 border-slate-700/50 outline-none" />
                    <button onClick={() => { if (newMegaTicker.trim()) { setMegaStocks(prev => [...prev, { ticker: newMegaTicker.trim(), name: newMegaTicker.trim(), category: 'Custom', description: 'User added' }]); setNewMegaTicker(''); }}} className="p-2 rounded-lg bg-amber-500/20 text-amber-400"><Plus className="w-4 h-4" /></button>
                  </div>
                )}
              </div>
            </div>

            {/* Scan Controls */}
            <div className="rounded-2xl border border-slate-800/50 bg-slate-900/30 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0"><h3 className="font-semibold text-white">Multi-Iteration Supplier Scan</h3><p className="text-xs text-slate-500">4-round AI analysis, results ranked in order</p></div>
                <div className="flex items-center gap-3 shrink-0">
                  <label className="flex items-center gap-2 text-sm text-slate-400 whitespace-nowrap">
                    Analyze top
                    <select value={scanDepth} onChange={e => setScanDepth(Number(e.target.value))} disabled={isScanning} className="px-2 py-1.5 rounded-lg text-sm border bg-slate-800/50 border-slate-700/50 text-white outline-none">
                      <option value={10}>10 stocks</option>
                      <option value={20}>20 stocks</option>
                    </select>
                  </label>
                  <button onClick={runSupplierScan} disabled={isScanning} className="px-6 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2 whitespace-nowrap" style={{ background: isScanning ? 'rgba(245,158,11,0.2)' : 'linear-gradient(90deg, #f59e0b, #f97316)', color: isScanning ? '#fcd34d' : 'white' }}>
                    {isScanning ? <><RefreshCw className="w-4 h-4 animate-spin" />Scanning...</> : <><Play className="w-4 h-4" />Run Scan</>}
                  </button>
                </div>
              </div>
              {isScanning && (
                <div className="mt-4">
                  <div className="flex justify-between gap-3 text-sm mb-2"><span className="text-slate-400 min-w-0 truncate">{scanStatus.message}</span><span className="text-amber-400 font-mono shrink-0">Round {scanIteration}/4</span></div>
                  <div className="h-2 rounded-full bg-slate-800 overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all" style={{ width: `${scanStatus.progress}%` }} /></div>
                </div>
              )}
            </div>

            {/* Results */}
            {foundStocks.length > 0 && (
              <div className="rounded-2xl border border-slate-800/50 bg-slate-900/30 overflow-hidden">
                <div className="p-4 border-b border-slate-800/50 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0"><div className="w-8 h-8 shrink-0 rounded-lg bg-emerald-500/20 flex items-center justify-center"><Factory className="w-4 h-4 text-emerald-400" /></div><div className="min-w-0"><h2 className="font-semibold text-white">Found Suppliers</h2><p className="text-xs text-slate-500">{foundStocks.length} stocks, ranked by score</p></div></div>
                  <button onClick={() => setFoundStocks([])} className="shrink-0 p-2 rounded-lg text-slate-500 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
                </div>
                <div className="divide-y divide-slate-800/50">
                  {foundStocks.map((stock, i) => (
                    <div key={stock.ticker} className="p-4 hover:bg-slate-800/20">
                      <div className="flex items-center justify-between gap-3 cursor-pointer" onClick={() => setExpandedStock(expandedStock === stock.ticker ? null : stock.ticker)}>
                        <div className="flex items-center gap-4 min-w-0 flex-1">
                          <div className="w-8 h-8 shrink-0 rounded-lg bg-slate-800 flex items-center justify-center text-sm font-bold text-slate-400">{i + 1}</div>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono font-bold text-white">{stock.ticker}</span>
                              <span className="px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap" style={{ background: SUPPLIER_CATEGORIES[stock.category]?.color + '20', color: SUPPLIER_CATEGORIES[stock.category]?.color }}>{stock.category}</span>
                            </div>
                            <p className="text-sm text-slate-400 truncate">{stock.name}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 shrink-0">
                          {stock.price && <div className="text-right"><p className="font-mono text-white">${stock.price.toFixed(2)}</p><p className="text-xs text-slate-500">${stock.marketCap}M</p></div>}
                          <div className="text-right"><p className="text-2xl font-bold text-emerald-400">{stock.finalScore}</p><p className="text-xs text-slate-500">Score</p></div>
                          {expandedStock === stock.ticker ? <ChevronUp className="w-5 h-5 text-slate-500" /> : <ChevronDown className="w-5 h-5 text-slate-500" />}
                        </div>
                      </div>
                      {expandedStock === stock.ticker && (
                        <div className="mt-4 pt-4 border-t border-slate-800/50 space-y-3">
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                            <div className="p-3 rounded-lg bg-slate-800/50"><p className="text-xs text-slate-500 mb-1">Singularity</p><p className="text-lg font-bold text-amber-400">{stock.singularityScore || 'N/A'}</p></div>
                            <div className="p-3 rounded-lg bg-slate-800/50"><p className="text-xs text-slate-500 mb-1">Conviction</p><p className="text-lg font-bold text-violet-400">{stock.convictionScore || 'N/A'}</p></div>
                            <div className="p-3 rounded-lg bg-slate-800/50"><p className="text-xs text-slate-500 mb-1 flex items-center gap-1"><Users className="w-3 h-3" />Team</p><p className="text-lg font-bold text-sky-400">{stock.deepAnalysis?.teamScore || 'N/A'}</p></div>
                            <div className="p-3 rounded-lg bg-slate-800/50"><p className="text-xs text-slate-500 mb-1">Confidence</p><p className="text-lg font-bold capitalize" style={{ color: stock.confidence === 'high' ? '#10B981' : stock.confidence === 'medium' ? '#F59E0B' : '#94a3b8' }}>{stock.confidence || 'N/A'}</p></div>
                          </div>
                          {stock.business && <div className="p-3 rounded-lg bg-slate-800/50"><p className="text-xs text-slate-500 mb-1">Business</p><p className="text-sm text-slate-300 break-words">{stock.business}</p></div>}
                          {stock.deepAnalysis?.teamNotes && <div className="p-3 rounded-lg bg-slate-800/50"><p className="text-xs text-slate-500 mb-1 flex items-center gap-1"><Users className="w-3 h-3" />Management</p><p className="text-sm text-slate-300 break-words">{stock.deepAnalysis.teamNotes}</p></div>}
                          {stock.fundamentals && (
                            <div className="p-3 rounded-lg bg-slate-800/50">
                              <p className="text-xs text-slate-500 mb-2">Fundamentals</p>
                              <div className="flex flex-wrap gap-2 text-xs">
                                {stock.fundamentals.peRatio != null && <span className="px-2 py-1 rounded bg-slate-700/50 text-slate-300">P/E {stock.fundamentals.peRatio.toFixed(1)}</span>}
                                {stock.fundamentals.revenueGrowth != null && <span className="px-2 py-1 rounded bg-slate-700/50 text-slate-300">Rev {stock.fundamentals.revenueGrowth >= 0 ? '+' : ''}{stock.fundamentals.revenueGrowth.toFixed(1)}% YoY</span>}
                                {stock.fundamentals.grossMargin != null && <span className="px-2 py-1 rounded bg-slate-700/50 text-slate-300">GM {stock.fundamentals.grossMargin.toFixed(1)}%</span>}
                                <span className={`px-2 py-1 rounded ${stock.fundamentals.insiderBought3m > stock.fundamentals.insiderSold3m ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700/50 text-slate-300'}`}>Insiders 3mo: +{Math.round(stock.fundamentals.insiderBought3m).toLocaleString()} / -{Math.round(stock.fundamentals.insiderSold3m).toLocaleString()}</span>
                              </div>
                            </div>
                          )}
                          {stock.suppliesTo?.length > 0 && <div className="p-3 rounded-lg bg-slate-800/50"><p className="text-xs text-slate-500 mb-2">Supplies To</p><div className="flex flex-wrap gap-2">{stock.suppliesTo.map(t => <span key={t} className="px-2 py-1 rounded bg-amber-500/20 text-amber-400 text-xs font-mono">{t}</span>)}</div></div>}
                          {stock.deepAnalysis && <div className="p-3 rounded-lg bg-slate-800/50"><p className="text-xs text-slate-500 mb-2">Thesis</p><p className="text-sm text-slate-300 break-words">{stock.deepAnalysis.thesis}</p>{stock.deepAnalysis.targetUpside && <p className="mt-2 text-emerald-400 font-semibold">Target: {stock.deepAnalysis.targetUpside} in {stock.deepAnalysis.timeframe}</p>}</div>}
                          {renderDcf(stock)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {!isScanning && foundStocks.length === 0 && <div className="rounded-2xl border border-slate-800/50 bg-slate-900/30 p-12 text-center"><Factory className="w-12 h-12 text-slate-700 mx-auto mb-4" /><h3 className="text-lg font-semibold text-slate-400 mb-2">No suppliers found yet</h3><p className="text-sm text-slate-500">Run the scan to find singularity suppliers</p></div>}
          </div>
        )}

        {activeSection === 'research' && (
          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-800/50 bg-slate-900/30 p-6">
              <div className="flex items-center gap-3 mb-4"><div className="w-8 h-8 shrink-0 rounded-lg bg-violet-500/20 flex items-center justify-center"><Brain className="w-4 h-4 text-violet-400" /></div><div><h2 className="font-semibold text-white">Conviction Analysis</h2><p className="text-xs text-slate-500">Deep AI analysis with live fundamentals</p></div></div>
              <div className="flex flex-col sm:flex-row gap-3">
                <input type="text" value={researchTicker} onChange={e => setResearchTicker(e.target.value.toUpperCase())} placeholder="Enter ticker (e.g., NVDA)" className="flex-1 min-w-0 px-4 py-3 rounded-xl text-sm border bg-slate-800/50 border-slate-700/50 outline-none" onKeyDown={e => e.key === 'Enter' && runDeepResearch()} />
                <button onClick={runDeepResearch} disabled={isResearching || !researchTicker.trim()} className="px-6 py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 whitespace-nowrap" style={{ background: isResearching ? 'rgba(139,92,246,0.2)' : 'linear-gradient(90deg, #8b5cf6, #7c3aed)', color: isResearching ? '#a78bfa' : 'white', opacity: !researchTicker.trim() ? 0.5 : 1 }}>
                  {isResearching ? <><RefreshCw className="w-4 h-4 animate-spin" />Analyzing...</> : <><Brain className="w-4 h-4" />Analyze</>}
                </button>
              </div>
            </div>
            {researchResults.length > 0 && (
              <div className="rounded-2xl border border-slate-800/50 bg-slate-900/30 overflow-hidden">
                <div className="p-4 border-b border-slate-800/50 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0"><div className="w-8 h-8 shrink-0 rounded-lg bg-violet-500/20 flex items-center justify-center"><Sparkles className="w-4 h-4 text-violet-400" /></div><div className="min-w-0"><h2 className="font-semibold text-white">Research Results</h2><p className="text-xs text-slate-500">{researchResults.length} analyzed</p></div></div>
                  <button onClick={() => setResearchResults([])} className="shrink-0 p-2 rounded-lg text-slate-500 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
                </div>
                <div className="divide-y divide-slate-800/50">
                  {researchResults.map(r => (
                    <div key={r.ticker} className="p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                        <div className="flex items-center gap-3 min-w-0"><span className="font-mono font-bold text-xl text-white">{r.ticker}</span><span className="text-sm text-slate-400 truncate">{r.name}</span></div>
                        <div className="flex items-center gap-4 shrink-0">
                          {r.price && <div className="text-right"><p className="font-mono text-white">${r.price.toFixed(2)}</p><p className="text-xs text-slate-500">${r.marketCap}M</p></div>}
                          {r.convictionScore != null && <div className="text-right"><p className={`text-2xl font-bold ${r.convictionScore >= 70 ? 'text-emerald-400' : r.convictionScore >= 50 ? 'text-amber-400' : 'text-red-400'}`}>{r.convictionScore}</p><p className="text-xs text-slate-500">Conviction</p></div>}
                        </div>
                      </div>
                      {r.fundamentals && (
                        <div className="mb-3 flex flex-wrap gap-2 text-xs">
                          {r.fundamentals.peRatio != null && <span className="px-2 py-1 rounded bg-slate-800/50 border border-slate-700/50 text-slate-300">P/E {r.fundamentals.peRatio.toFixed(1)}</span>}
                          {r.fundamentals.revenueGrowth != null && <span className="px-2 py-1 rounded bg-slate-800/50 border border-slate-700/50 text-slate-300">Rev {r.fundamentals.revenueGrowth >= 0 ? '+' : ''}{r.fundamentals.revenueGrowth.toFixed(1)}% YoY</span>}
                          {r.fundamentals.grossMargin != null && <span className="px-2 py-1 rounded bg-slate-800/50 border border-slate-700/50 text-slate-300">GM {r.fundamentals.grossMargin.toFixed(1)}%</span>}
                          <span className={`px-2 py-1 rounded border ${r.fundamentals.insiderBought3m > r.fundamentals.insiderSold3m ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-slate-800/50 border-slate-700/50 text-slate-300'}`}>Insiders 3mo: +{Math.round(r.fundamentals.insiderBought3m).toLocaleString()} / -{Math.round(r.fundamentals.insiderSold3m).toLocaleString()}</span>
                        </div>
                      )}
                      {r.analysis && <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/50"><p className="text-sm text-slate-300 whitespace-pre-wrap break-words">{r.analysis}</p></div>}
                      <div className="mt-3">{renderDcf(r)}</div>
                      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                        <span>52W: ${r.low52?.toFixed(2)} - ${r.high52?.toFixed(2)}</span>
                        <span className="text-emerald-400">+{r.fromLow?.toFixed(1)}% from low</span>
                        <span className="text-red-400">-{r.fromHigh?.toFixed(1)}% from high</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {researchResults.length === 0 && <div className="rounded-2xl border border-slate-800/50 bg-slate-900/30 p-12 text-center"><Brain className="w-12 h-12 text-slate-700 mx-auto mb-4" /><h3 className="text-lg font-semibold text-slate-400 mb-2">No research yet</h3><p className="text-sm text-slate-500">Enter a ticker to analyze</p></div>}
          </div>
        )}
      </main>
    </div>
  );
}
