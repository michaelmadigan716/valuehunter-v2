// Shared scan engines - runs in the browser (via /api/grok) and on the
// server job worker (same code, API_BASE pointed at the deployment).
import { computeTechnicalOpinion } from './technicals';

const POLYGON_KEY = process.env.NEXT_PUBLIC_POLYGON_KEY || '';
const FINNHUB_KEY = process.env.NEXT_PUBLIC_FINNHUB_KEY || '';

let API_BASE = '';
export function setApiBase(base) { API_BASE = base || ''; }


// ============================================
// GROK AI ANALYSIS - Insider Conviction Focus
// ============================================
export async function getAIAnalysis(stock, model = 'grok-4.6') {
  console.log(`Starting Grok Conviction analysis for ${stock.ticker} with ${model}...`);
  
  try {
    const prompt = `Analyze INSIDER CONVICTION for ${stock.ticker} (${stock.name}).

STOCK DATA:
- Current Price: $${stock.price?.toFixed(2)}
- Market Cap: $${stock.marketCap}M
- Net Cash: ${stock.netCash ? '$' + (stock.netCash / 1000000).toFixed(1) + 'M' : 'Unknown'}
- Last Insider Buy: ${stock.lastInsiderPurchase?.date ? stock.lastInsiderPurchase.date + ' ($' + Math.round(stock.lastInsiderPurchase.amount).toLocaleString() + ')' : 'None found'}

FOCUS EXCLUSIVELY ON INSIDER CONVICTION - How much skin in the game do insiders have?

Research and analyze:
1. INSIDER OWNERSHIP %: What percentage of shares do insiders (CEO, CFO, directors, founders) own?
2. RECENT PURCHASES: Have insiders been buying in the open market recently? Size of purchases?
3. NET WORTH COMMITMENT: How significant are their holdings relative to their likely net worth? A CEO with $50M in stock when their salary is $500k = huge conviction.
4. SELLING PATTERNS: Have insiders been selling, or holding/buying? Sales for diversification vs. loss of faith?
5. CLUSTER BUYING: Multiple insiders buying together = stronger signal

CONVICTION SCORING:
- 0-20: No insider ownership, or heavy insider selling
- 21-40: Minimal insider ownership (<2%), no recent buys
- 41-60: Moderate ownership (2-10%), occasional insider activity
- 61-80: Strong ownership (10-25%), recent meaningful purchases
- 81-100: Exceptional ownership (>25%), founders still heavily invested, recent large purchases, insiders buying with significant % of their net worth

Write 2-3 sentences about their insider conviction. Plain text only.

END WITH EXACTLY THIS LINE:
INSIDER_CONVICTION: [number from 0 to 100]`;

    const response = await fetch(`${API_BASE}/api/grok`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, model })
    });

    if (!response.ok) {
      const errorData = await response.json();
      return { analysis: `API Error: ${errorData.error || response.status}`, insiderConviction: null };
    }

    const data = await response.json();
    
    return { 
      analysis: data.analysis, 
      insiderConviction: data.insiderConviction
    };
  } catch (e) {
    console.error('Grok Conviction analysis failed:', e);
    return { analysis: `Error: ${e.message}`, insiderConviction: null };
  }
}

// ============================================
// TECHNICAL ANALYSIS - Cup and Handle Deep Dive
// ============================================
export async function getTechnicalAnalysis(stock, model = 'grok-4.6') {
  console.log(`Starting Technical Analysis for ${stock.ticker} with ${model}...`);
  
  try {
    // Fetch actual historical price data for multiple timeframes
    const endDate = new Date().toISOString().split('T')[0];
    
    // Get 2 years of weekly data for longer-term patterns
    const startDate2Y = new Date(Date.now() - 730 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const weeklyRes = await fetch(
      `https://api.polygon.io/v2/aggs/ticker/${stock.ticker}/range/1/week/${startDate2Y}/${endDate}?adjusted=true&sort=asc&apiKey=${POLYGON_KEY}`
    );
    const weeklyData = await weeklyRes.json();
    const weeklyPrices = weeklyData.results || [];
    
    // Get 6 months of daily data for recent action
    const startDate6M = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const dailyRes = await fetch(
      `https://api.polygon.io/v2/aggs/ticker/${stock.ticker}/range/1/day/${startDate6M}/${endDate}?adjusted=true&sort=asc&apiKey=${POLYGON_KEY}`
    );
    const dailyData = await dailyRes.json();
    const dailyPrices = dailyData.results || [];
    
    if (weeklyPrices.length < 10) {
      return { technicalAnalysis: 'Insufficient price history for analysis', cupHandleScore: null };
    }
    
    // Format weekly data - show key points for pattern recognition
    const weeklyChartData = weeklyPrices.map((p, i) => {
      const date = new Date(p.t).toISOString().split('T')[0];
      return `${date}: O=${p.o.toFixed(2)} H=${p.h.toFixed(2)} L=${p.l.toFixed(2)} C=${p.c.toFixed(2)} V=${Math.round(p.v/1000)}K`;
    }).join('\n');
    
    // Format recent daily data (last 60 days for handle detection)
    const recentDaily = dailyPrices.slice(-60).map((p, i) => {
      const date = new Date(p.t).toISOString().split('T')[0];
      return `${date}: O=${p.o.toFixed(2)} H=${p.h.toFixed(2)} L=${p.l.toFixed(2)} C=${p.c.toFixed(2)} V=${Math.round(p.v/1000)}K`;
    }).join('\n');
    
    // Calculate key statistics from the data
    const allHighs = weeklyPrices.map(p => p.h);
    const allLows = weeklyPrices.map(p => p.l);
    const allCloses = weeklyPrices.map(p => p.c);
    const allVolumes = weeklyPrices.map(p => p.v);
    
    const highestHigh = Math.max(...allHighs);
    const lowestLow = Math.min(...allLows);
    const avgVolume = allVolumes.reduce((a, b) => a + b, 0) / allVolumes.length;
    const recentVolume = allVolumes.slice(-4).reduce((a, b) => a + b, 0) / 4;
    
    // Find potential cup formation points
    const highestIndex = allHighs.indexOf(highestHigh);
    const lowestIndex = allLows.indexOf(lowestLow);
    
    // Calculate depth of potential cup
    const priorHigh = Math.max(...allHighs.slice(0, Math.max(highestIndex, 10)));
    const cupBottom = Math.min(...allLows.slice(highestIndex > 0 ? highestIndex : 0));
    const cupDepth = priorHigh > 0 ? ((priorHigh - cupBottom) / priorHigh * 100).toFixed(1) : 0;
    
    const currentPrice = stock.price;
    const fromHighestHigh = ((highestHigh - currentPrice) / highestHigh * 100).toFixed(1);
    const fromLowestLow = ((currentPrice - lowestLow) / lowestLow * 100).toFixed(1);
    
    const prompt = `You are a world-class technical analyst with 30+ years specializing in CUP AND HANDLE patterns - the most powerful bullish continuation pattern.

STOCK: ${stock.ticker} - ${stock.name}
CURRENT PRICE: $${currentPrice.toFixed(2)}
52-WEEK HIGH: $${stock.high52?.toFixed(2)} | 52-WEEK LOW: $${stock.low52?.toFixed(2)}
HIGHEST PRICE IN DATA: $${highestHigh.toFixed(2)} | LOWEST: $${lowestLow.toFixed(2)}
FROM HIGHEST HIGH: -${fromHighestHigh}% | FROM LOWEST LOW: +${fromLowestLow}%
POTENTIAL CUP DEPTH: ${cupDepth}%
VOLUME TREND: Recent avg ${Math.round(recentVolume/1000)}K vs Overall avg ${Math.round(avgVolume/1000)}K

═══════════════════════════════════════════
WEEKLY PRICE DATA (${weeklyPrices.length} weeks):
═══════════════════════════════════════════
${weeklyChartData}

═══════════════════════════════════════════
RECENT DAILY DATA (Last 60 days - for handle detection):
═══════════════════════════════════════════
${recentDaily}

═══════════════════════════════════════════
YOUR TASK: ANALYZE THIS CHART FOR CUP & HANDLE PATTERN
═══════════════════════════════════════════

STEP 1 - IDENTIFY THE CUP:
- Look for a prior uptrend, then a rounded "U" shaped decline and recovery
- Cup should take 7-65 weeks to form (longer = more powerful)
- Depth should be 15-35% from the prior high (12-50% acceptable)
- Both sides should be roughly symmetrical
- Bottom should be ROUNDED, not V-shaped
- Right side should show gradually increasing volume

STEP 2 - IDENTIFY THE HANDLE:
- Forms AFTER the cup, in the UPPER HALF of the pattern
- Should be a small pullback of 8-12% (max 15%) from cup's right side high
- Handle drifts DOWN or sideways (never sharply up)
- Duration: 1-4+ weeks
- Volume should CONTRACT during handle formation
- Handle should NOT drop into lower half of cup

STEP 3 - IDENTIFY BREAKOUT POTENTIAL:
- Is price near the handle's resistance level?
- Is there a defined "pivot point" to watch?
- What volume confirmation would you need?

STEP 4 - CHECK MULTIPLE TIMEFRAMES:
- Could this be a cup and handle on the WEEKLY chart?
- Could this be a cup and handle on the DAILY chart?
- Are there nested patterns (smaller C&H within larger C&H)?

CRITICAL SCORING GUIDELINES:
0-15: NOT a cup and handle - completely different pattern (downtrend, channel, etc.)
16-30: Very unlikely - maybe one element present but fundamentally not C&H
31-45: Weak possibility - some cup shape visible but missing key elements
46-60: Developing - clear cup visible, watching for handle formation
61-75: Good setup - cup complete, handle forming or formed, needs breakout
76-85: Strong pattern - textbook shape, proper depth/duration, breakout approaching
86-100: EXCEPTIONAL - perfect pattern with all elements, breakout imminent or underway

BE RIGOROUS. A TRUE cup and handle is RARE. Most stocks score 0-40.
Only score 70+ if you can clearly identify BOTH the cup AND the handle with proper characteristics.

Provide a detailed 3-5 sentence analysis describing:
1. What pattern you see in the chart
2. Specific dates/prices of key formation points if C&H exists
3. What would confirm or invalidate this pattern

END WITH EXACTLY:
CUP_HANDLE_SCORE: [0-100]`;

    const response = await fetch(`${API_BASE}/api/grok`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, isTechnical: true, model })
    });

    if (!response.ok) {
      const errorData = await response.json();
      return { technicalAnalysis: `API Error: ${errorData.error || response.status}`, cupHandleScore: null };
    }

    const data = await response.json();
    console.log(`Technical response for ${stock.ticker}:`, data);
    
    // Use cupHandleScore from API response (already extracted by route)
    let cupHandleScore = data.cupHandleScore;
    
    // Fallback: try to extract from text if not in response
    if (cupHandleScore === null || cupHandleScore === undefined) {
      const match = data.analysis?.match(/CUP_HANDLE_SCORE[:\s]*(\d+)/i);
      if (match) {
        cupHandleScore = Math.min(100, Math.max(0, parseInt(match[1])));
      }
    }
    
    console.log(`${stock.ticker} Cup & Handle Score: ${cupHandleScore}`);
    
    let analysis = data.analysis?.replace(/CUP_HANDLE_SCORE[:\s]*\d+%?/gi, '').trim() || 'No response';
    
    return { technicalAnalysis: analysis, cupHandleScore };
  } catch (e) {
    console.error('Technical analysis failed:', e);
    return { technicalAnalysis: `Error: ${e.message}`, cupHandleScore: null };
  }
}

// ============================================
// ============================================
// EXPLOSIVE GROWTH SCAN - Singularity Contract/Demand Potential
// ============================================
// ============================================



// ============================================
// VALUATION ANALYSIS - Depressed Stock + Catalyst Potential
// ============================================
export async function getValuationAnalysis(stock, model = 'grok-4.6') {
  console.log(`Running Valuation Analysis for ${stock.ticker} with ${model}...`);
  
  try {
    const prompt = `You are a deep value analyst specializing in finding stocks that are DEPRESSED and FORGOTTEN by the market — sitting quietly with no news — that could EXPLODE when a catalyst finally hits. You hunt for coiled springs.

STOCK DATA:
- Ticker: ${stock.ticker} (${stock.name})
- Current Price: $${stock.price?.toFixed(2)}
- Market Cap: $${stock.marketCap}M
- 52-Week Range: $${stock.low52?.toFixed(2)} - $${stock.high52?.toFixed(2)}
- Position from 52W Low: +${stock.fromLow?.toFixed(1)}%
- Net Cash: ${stock.netCash ? '$' + (stock.netCash / 1000000).toFixed(1) + 'M' : 'Unknown'}
- Daily Change: ${stock.change?.toFixed(2)}%

ANALYZE WHETHER THIS STOCK IS A DEPRESSED COILED SPRING:

1. NEWS DROUGHT CHECK (MOST IMPORTANT):
   - When was the LAST significant news, PR, or announcement from this company?
   - Has it been weeks or months since any meaningful coverage?
   - Is the stock being IGNORED by analysts and media?
   - Low news = the stock price is NOT reflecting any upcoming catalysts = potential coiled spring
   - If there's been recent hype or news coverage, that's ALREADY priced in = lower score

2. PRICE DEPRESSION SIGNALS:
   - Is the stock near its 52-week low? Significantly below its highs?
   - Has volume dried up (nobody is paying attention)?
   - Has the stock been slowly bleeding or flat-lining for weeks/months?
   - Are institutions quietly accumulating while retail has given up?
   - A stock that's been beaten down and forgotten has MORE upside potential than one that's been running

3. UPCOMING CATALYST POTENTIAL:
   - Is earnings coming up that could surprise?
   - Could they announce a new contract, partnership, or deal?
   - Are they in a sector where a macro catalyst could hit (AI spending, energy policy, defense budget)?
   - Could they be an acquisition target?
   - Any product launch, FDA approval, or regulatory decision pending?
   - The KEY question: What could make people suddenly pay attention to this stock again?

4. FUNDAMENTAL FLOOR:
   - Does the company have real revenue and a real business?
   - Is the balance sheet strong enough to survive until the catalyst?
   - Net cash position (cash rich companies can weather the drought)
   - Are they still growing revenue even though nobody cares?
   - Is the current market cap absurdly low relative to their actual business?

5. SECTOR TAILWINDS (BONUS):
   - Is this company in a sector with massive secular tailwinds that the market is ignoring for THIS specific stock?
   - HIGH VALUE sectors: Solar/renewables, robotics supply chain, AI data center infrastructure, semiconductor supply chain, energy grid, battery materials
   - A forgotten company in a HOT sector is the ideal setup

VALUATION SCORE (0-100):
- 50 = FAIR - priced correctly, news flow is normal, no special setup
- 51-65 = MILDLY UNDERVALUED - somewhat quiet, decent catalyst potential
- 66-80 = UNDERVALUED COILED SPRING - depressed price, no recent news, clear upcoming catalysts
- 81-100 = EXTREME COILED SPRING - totally forgotten, near lows, strong business, imminent catalyst potential, could 2-5X on news
- 35-49 = SLIGHTLY OVERVALUED - recent news already priced in, limited near-term catalysts
- 15-34 = OVERVALUED - stock has already run, hype is priced in
- 0-14 = VERY OVERVALUED - pumped up, all good news priced in, high risk of pullback

KEY SCORING RULES:
- NO recent news + near 52w low + strong fundamentals + upcoming catalyst = SCORE 75+
- Recent news/hype already driving price up = SCORE LOWER (already priced in)
- Stock near 52w high with lots of coverage = SCORE UNDER 40 (no coiled spring left)
- The LONGER the news drought + the STRONGER the business = the HIGHER the score
- Net cash companies get bonus points (they can survive the wait)
- Companies in AI/solar/robotics supply chains that are being IGNORED get bonus points

Write 2-3 sentences: How long has this stock been quiet? What catalyst could wake it up? How much could it move?

END WITH EXACTLY:
VALUATION_SCORE: [0-100]`;

    const response = await fetch(`${API_BASE}/api/grok`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, agentPrompt: true, model }) // agentPrompt enforces the VALUATION_SCORE marker (isMatty demanded a conflicting 8MO_PREDICTION ending)
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Valuation Analysis API error:', errorData);
      return { valuationAnalysis: `API Error: ${errorData.error || response.status}`, valuationScore: null };
    }

    const data = await response.json();
    console.log('Valuation Analysis response:', data);
    
    // Extract score
    let valuationScore = null;
    
    if (data.analysis) {
      // Tolerant: VALUATION_SCORE: 62 | VALUATION SCORE (0-100): 62 | Valuation score = 62/100
      const match = data.analysis.match(/VALUATION[_\s-]*SCORE[^0-9\n]{0,20}(\d{1,3})/i)
        || data.analysis.match(/(?:^|\n)\s*SCORE[^0-9\n]{0,12}(\d{1,3})\s*(?:\/\s*100)?\s*$/im);
      if (match) {
        valuationScore = Math.min(100, Math.max(0, parseInt(match[1])));
      }
    }
    
    // Clean up the analysis text
    let analysis = data.analysis?.replace(/VALUATION_SCORE[:\s]*\d+%?/gi, '').trim() || 'No response';
    
    return { valuationAnalysis: analysis, valuationScore };
  } catch (e) {
    console.error('Valuation Analysis failed:', e);
    return { valuationAnalysis: `Error: ${e.message}`, valuationScore: null };
  }
}

// ============================================
// SHARED HELPERS FOR AGENT SCANS
// ============================================
export async function callAgentGrok(prompt, model, { liveSearch = false } = {}) {
  // Retry transient failures (rate limits, hiccups) with backoff
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 4000 * attempt));
    try {
      const response = await fetch(`${API_BASE}/api/grok`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, model, agentPrompt: true, liveSearch })
      });
      if (response.ok) return (await response.json()).analysis || '';
      const err = await response.json().catch(() => ({}));
      lastErr = new Error(err.error || `API error ${response.status}`);
      // Only retry statuses that can succeed on a second try
      if (![403, 429, 500, 502, 503, 504].includes(response.status)) throw lastErr;
    } catch (e) {
      lastErr = e;
      if (!String(e.message).match(/403|429|50\d|fetch|network/i)) throw e;
    }
  }
  throw lastErr;
}

export function extractScore(text, marker) {
  const m = text.match(new RegExp(marker + '[:\\s=]*([0-9]+)', 'i'));
  const score = m ? Math.min(100, Math.max(0, parseInt(m[1]))) : null;
  const cleaned = text.replace(new RegExp(marker + '[:\\s=]*[0-9]+%?', 'gi'), '').trim();
  return { score, cleaned };
}

export async function fetchDailyBars(ticker, days) {
  const end = new Date().toISOString().split('T')[0];
  const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const res = await fetch(`https://api.polygon.io/v2/aggs/ticker/${ticker}/range/1/day/${start}/${end}?adjusted=true&sort=asc&limit=500&apiKey=${POLYGON_KEY}`);
  if (!res.ok) return [];
  return (await res.json()).results || [];
}

// ============================================
// COMPUTED SCANS - momentum + volatility metrics from raw price data
// (no AI calls, one Polygon request per stock)
// ============================================
export function computeBarMetrics(bars) {
  if (!bars || bars.length < 25) return null;
  const closes = bars.map(b => b.c);
  const vols = bars.map(b => b.v);
  const last = closes[closes.length - 1];
  const pctFrom = n => closes.length > n ? ((last - closes[closes.length - 1 - n]) / closes[closes.length - 1 - n]) * 100 : null;

  // Volume surge: last 5 days vs prior 20-day average
  const recent5 = vols.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const prior20 = vols.slice(-25, -5).reduce((a, b) => a + b, 0) / 20;
  const volumeSurge = prior20 > 0 ? recent5 / prior20 : null;

  // Realized volatility (30d, annualized %) from log returns
  const rets = [];
  for (let i = Math.max(1, closes.length - 30); i < closes.length; i++) {
    if (closes[i - 1] > 0) rets.push(Math.log(closes[i] / closes[i - 1]));
  }
  let realizedVol = null;
  if (rets.length > 5) {
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length;
    realizedVol = Math.sqrt(variance) * Math.sqrt(252) * 100;
  }

  // ATR% (14d) and volatility contraction (ATR last 10d vs prior 30d)
  const trs = [];
  for (let i = 1; i < bars.length; i++) {
    trs.push(Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - bars[i - 1].c), Math.abs(bars[i].l - bars[i - 1].c)));
  }
  const atr14 = trs.slice(-14).reduce((a, b) => a + b, 0) / Math.min(14, trs.length);
  const atrPct = last > 0 ? (atr14 / last) * 100 : null;
  const atr10 = trs.slice(-10).reduce((a, b) => a + b, 0) / Math.min(10, trs.length);
  const atr30 = trs.slice(-40, -10).reduce((a, b) => a + b, 0) / Math.min(30, trs.slice(-40, -10).length || 1);
  const volContraction = atr30 > 0 ? atr10 / atr30 : null;

  return {
    pct5d: pctFrom(5), pct21d: pctFrom(21), pct63d: pctFrom(63),
    volumeSurge, realizedVol, atrPct, volContraction,
  };
}

export async function computeMarketMetrics(stockList, onProgress) {
  const results = {};
  let done = 0, next = 0;
  const items = stockList;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      const s = items[i];
      try {
        const bars = await fetchDailyBars(s.ticker, 300);
        const m = computeBarMetrics(bars);
        const tech = computeTechnicalOpinion(bars);
        results[s.ticker] = m || tech ? { ...(m || {}), ...(tech || {}) } : null;
      } catch (e) {
        results[s.ticker] = null;
      }
      done++;
      if (onProgress) onProgress(done, items.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(5, items.length) }, worker));

  // Relative-strength percentile ranks across the scanned pool
  const blend = t => {
    const m = results[t];
    if (!m) return null;
    return (m.pct5d ?? 0) * 0.3 + (m.pct21d ?? 0) * 0.4 + (m.pct63d ?? 0) * 0.3;
  };
  const ranked = stockList.map(s => ({ t: s.ticker, b: blend(s.ticker) })).filter(x => x.b !== null).sort((a, b) => a.b - b.b);
  ranked.forEach((x, i) => {
    results[x.t].rsScore = Math.round((i / Math.max(1, ranked.length - 1)) * 100);
  });
  // Volume-surge score: 1x avg -> 33, 3x avg -> 100
  Object.values(results).forEach(m => {
    if (m && m.volumeSurge !== null) m.volumeSurgeScore = Math.round(Math.min(100, m.volumeSurge * 33.3));
  });
  return results;
}







// ============================================
// MOMENTUM - one stat from 3 sub-scans:
// chart quality, continuation odds, market room + moat
// ============================================
export async function getMomentumAnalysis(stock, model = 'grok-4.6') {
  try {
    let chartBlock = 'No price history available.';
    let metricsLine = '';
    try {
      const bars = await fetchDailyBars(stock.ticker, 130);
      if (bars.length >= 20) {
        chartBlock = bars.slice(-60).map(p => `${new Date(p.t).toISOString().split('T')[0]}: O=${p.o.toFixed(2)} H=${p.h.toFixed(2)} L=${p.l.toFixed(2)} C=${p.c.toFixed(2)} V=${Math.round(p.v / 1000)}K`).join('\n');
        const m = computeBarMetrics(bars);
        if (m) metricsLine = `1mo ${m.pct21d != null ? (m.pct21d >= 0 ? '+' : '') + m.pct21d.toFixed(1) + '%' : 'n/a'} | 3mo ${m.pct63d != null ? (m.pct63d >= 0 ? '+' : '') + m.pct63d.toFixed(1) + '%' : 'n/a'} | volume ${m.volumeSurge != null ? m.volumeSurge.toFixed(1) + 'x avg' : 'n/a'} | realized vol ${m.realizedVol != null ? m.realizedVol.toFixed(0) + '%' : 'n/a'}`;
      }
    } catch (e) {}
    const prompt = `MOMENTUM ANALYSIS for ${stock.ticker} (${stock.name}), sector ${stock.sector || 'Unknown'}, price $${stock.price?.toFixed(2)}, market cap $${stock.marketCap ? Math.round(stock.marketCap) + 'M' : 'unknown'}.
${metricsLine ? `Computed stats: ${metricsLine}` : ''}
DAILY BARS (last 60 days):
${chartBlock}

Cover three angles, searching for current news where it helps:
1. CHART: trend structure over the last couple of months - higher lows/highs, volume confirmation, pullback behavior, early/mid/late stage.
2. CONTINUATION: what has been driving the stock and what is coming (catalysts, earnings, sector flows, narrative strength vs exhaustion) - odds momentum continues 1-3 months.
3. PARABOLIC POTENTIAL: could this go parabolic - explosive demand/contract inflection (AI, robotics, energy), float and volume character, narrative fuel left.
Then give one overall momentum verdict.
End with EXACTLY these lines:
CHART_SCORE: [0-100]
CONTINUATION_SCORE: [0-100]
PARABOLIC_SCORE: [0-100]
MOMENTUM_SCORE: [0-100]`;

    const text = await callAgentGrok(prompt, model, { liveSearch: true });
    const chart = extractScore(text, 'CHART_SCORE');
    const cont = extractScore(chart.cleaned, 'CONTINUATION_SCORE');
    const para = extractScore(cont.cleaned, 'PARABOLIC_SCORE');
    const overall = extractScore(para.cleaned, 'MOMENTUM_SCORE');
    const momentumScore = overall.score ?? ([chart.score, cont.score, para.score].some(v => v !== null)
      ? Math.round((chart.score ?? 50) * 0.35 + (cont.score ?? 50) * 0.35 + (para.score ?? 50) * 0.30) : null);
    return { momentumAnalysis: overall.cleaned, momentumScore, momentumChartScore: chart.score, momentumContinuationScore: cont.score, momentumParabolicScore: para.score };
  } catch (e) {
    return { momentumAnalysis: `Error: ${e.message}`, momentumScore: null };
  }
}

// ============================================
// BUYOUT - acquisition-likelihood score from multiple angles,
// with a conditional deep-dive on key people
// ============================================
export async function getBuyoutAnalysis(stock, model = 'grok-4.6') {
  try {
    const base = `${stock.ticker} (${stock.name}), sector ${stock.sector || 'Unknown'}, price $${stock.price?.toFixed(2)}, market cap $${stock.marketCap ? Math.round(stock.marketCap) + 'M' : 'unknown'}`;
    const prompt = `BUYOUT LIKELIHOOD analysis for ${base}. Search the web and X for current evidence on all four angles:
1. PEOPLE & HIRES: recent executive/board appointments, retained bankers or advisors; flag people whose backgrounds suggest positioning for a sale (M&A, investment banking, prior exits, "strategic alternatives" specialists) and briefly note their track records.
2. STATED INTENT: "exploring strategic alternatives" language, activist pressure, going-private chatter, management commentary on consolidation, prior rejected offers.
3. SOCIAL BUZZ: StockTwits/X/Reddit and financial media buyout speculation - substantive (credible reporting, named acquirers, deal-tied options activity) vs meme noise.
4. STRATEGIC FIT: is the sector consolidating; name the most likely strategic or PE acquirers and why; valuation attractiveness to a buyer; float/insider ownership that eases or blocks a deal.
Then give one overall buyout-likelihood verdict.
End with EXACTLY these lines:
PEOPLE_SCORE: [0-100]
INTENT_SCORE: [0-100]
BUZZ_SCORE: [0-100]
FIT_SCORE: [0-100]
BUYOUT_SCORE: [0-100]`;

    const text = await callAgentGrok(prompt, model, { liveSearch: true });
    const people = extractScore(text, 'PEOPLE_SCORE');
    const intent = extractScore(people.cleaned, 'INTENT_SCORE');
    const buzz = extractScore(intent.cleaned, 'BUZZ_SCORE');
    const fit = extractScore(buzz.cleaned, 'FIT_SCORE');
    const overall = extractScore(fit.cleaned, 'BUYOUT_SCORE');
    const buyoutScore = overall.score ?? ([people.score, intent.score, buzz.score, fit.score].some(v => v !== null)
      ? Math.round((people.score ?? 50) * 0.25 + (intent.score ?? 50) * 0.30 + (buzz.score ?? 50) * 0.15 + (fit.score ?? 50) * 0.30) : null);
    return { buyoutAnalysis: overall.cleaned, buyoutScore, buyoutPeopleScore: people.score, buyoutIntentScore: intent.score, buyoutBuzzScore: buzz.score, buyoutFitScore: fit.score };
  } catch (e) {
    return { buyoutAnalysis: `Error: ${e.message}`, buyoutScore: null };
  }
}

// ============================================
// LEADERSHIP - CEO quality, team depth, public presence, interview vibes
// (single call; absorbs the former Team and Passion scans)
// ============================================
export async function getLeadershipAnalysis(stock, model = 'grok-4.6') {
  try {
    const base = `${stock.ticker} (${stock.name}), sector ${stock.sector || 'Unknown'}, market cap $${stock.marketCap ? Math.round(stock.marketCap) + 'M' : 'unknown'}`;
    const prompt = `LEADERSHIP analysis for ${base}. Search for real evidence (filings, interviews, podcasts, X posts, press) and cover:
1. CEO: founder-led or hired; skin in the game (ownership, insider buys); execution track record; focused on THIS business; technical depth.
2. TEAM: depth and quality of the executive team and board; relevant experience; capital allocation discipline; recent notable hires or departures.
3. PUBLIC PRESENCE: how transparent and communicative leadership is - shareholder letters, interviews, conference appearances, X activity, investor access.
4. VIBES: from actual recent interviews/appearances - genuine passion and command of detail vs scripted promotion; conviction about the mission; candor about problems; do employees/customers echo it.
Then give one overall leadership verdict.
End with EXACTLY these lines:
CEO_SCORE: [0-100]
TEAM_SCORE: [0-100]
PUBLIC_SCORE: [0-100]
VIBES_SCORE: [0-100]
LEADERSHIP_SCORE: [0-100]`;

    const text = await callAgentGrok(prompt, model, { liveSearch: true });
    const ceo = extractScore(text, 'CEO_SCORE');
    const team = extractScore(ceo.cleaned, 'TEAM_SCORE');
    const pub = extractScore(team.cleaned, 'PUBLIC_SCORE');
    const vibes = extractScore(pub.cleaned, 'VIBES_SCORE');
    const overall = extractScore(vibes.cleaned, 'LEADERSHIP_SCORE');
    const leadershipScore = overall.score ?? ([ceo.score, team.score, pub.score, vibes.score].some(v => v !== null)
      ? Math.round((ceo.score ?? 50) * 0.35 + (team.score ?? 50) * 0.25 + (pub.score ?? 50) * 0.15 + (vibes.score ?? 50) * 0.25) : null);
    return { leadershipAnalysis: overall.cleaned, leadershipScore, leadershipCeoScore: ceo.score, leadershipTeamScore: team.score, leadershipPublicScore: pub.score, leadershipVibesScore: vibes.score };
  } catch (e) {
    return { leadershipAnalysis: `Error: ${e.message}`, leadershipScore: null };
  }
}


// ============================================
// PLAYBOOKS - the user's proven winning circumstances, scored per stock
// ============================================
export const DEFAULT_PLAYBOOKS = [
  {
    id: 'buyoutSeeker',
    name: 'Buyout Seeker',
    description: 'The company is positioning itself to be acquired: recent executive/board hires with M&A, investment banking, or prior-exit backgrounds; management hinting at strategic alternatives or openness to a sale in interviews or filings; sector actively consolidating with a clean, named strategic acquirer who would want their tech, contracts, or market position.',
  },
  {
    id: 'nicheMonopoly',
    name: 'Niche Monopoly',
    description: 'The company is the only credible player in a small but real market - a de facto monopoly niche with pricing power, sticky customers, or exclusive technology/regulatory position - and that niche is about to matter much more (new demand wave, regulation, or technology shift).',
  },
  {
    id: 'netCashRecovery',
    name: 'Net-Cash Recovery',
    description: 'The stock is stupidly undervalued relative to its net cash position (trading near or below cash minus debt). The business has problems, but management is publicly AWARE of the dire situation and actively executing a recovery plan (cost cuts, pivots, buybacks, new leadership). Any stabilization re-rates the stock multiples higher.',
  },
];

export async function getPlaybookAnalysis(stock, model = 'grok-4.6', playbooks = DEFAULT_PLAYBOOKS) {
  try {
    const pbList = playbooks.map((p, i) => `PLAYBOOK ${i + 1} - ${p.name} [id: ${p.id}]:\n${p.description}`).join('\n\n');
    const prompt = `Evaluate ${stock.ticker} (${stock.name}), sector ${stock.sector || 'Unknown'}, price $${stock.price?.toFixed(2)}, market cap $${stock.marketCap ? Math.round(stock.marketCap) + 'M' : 'unknown'}${stock.netCash != null ? `, net cash $${(stock.netCash / 1e6).toFixed(1)}M` : ''} against these proven winning setups. Search for current evidence (news, filings, interviews, hires, sector moves) for each.

${pbList}

Historical guardrails from the owner's actual wins: the best entries were under ~$12/share in small caps, and winners took 16+ days to play out - weigh cheap, early-stage setups higher than extended ones.

For EACH playbook give a score 0-100 for how well this stock matches TODAY, with the strongest evidence. Then name the single best-matching playbook.
End with EXACTLY these lines:
${playbooks.map(p => `SCORE_${p.id}: [0-100]`).join('\n')}
BEST_PLAYBOOK: [id]`;

    const text = await callAgentGrok(prompt, model, { liveSearch: true });
    const scores = {};
    let best = null, bestScore = null;
    for (const p of playbooks) {
      const { score } = extractScore(text, `SCORE_${p.id}`);
      scores[p.name] = score;
      if (score !== null && (bestScore === null || score > bestScore)) { bestScore = score; best = p.name; }
    }
    const bestMatch = text.match(/BEST_PLAYBOOK[:\s]*([A-Za-z]+)/i)?.[1];
    const bestPb = playbooks.find(p => p.id.toLowerCase() === (bestMatch || '').toLowerCase());
    let cleaned = text;
    for (const p of playbooks) cleaned = cleaned.replace(new RegExp(`SCORE_${p.id}[:\\s]*\\d+`, 'gi'), '');
    cleaned = cleaned.replace(/BEST_PLAYBOOK[:\s]*[A-Za-z]+/gi, '').trim();
    return {
      playbookAnalysis: cleaned,
      playbookScore: bestScore,
      playbookBest: bestPb ? bestPb.name : best,
      playbookScores: scores,
    };
  } catch (e) {
    return { playbookAnalysis: `Error: ${e.message}`, playbookScore: null };
  }
}

// Agent definitions shared by the client registry and the server worker.
// `apply` merges a scan result into a stock record.
export const AGENT_DEFS = [
  { id: 'conviction', label: 'Conviction', color: '#34d399', fn: getAIAnalysis, apply: (s, r) => ({ ...s, aiAnalysis: r.analysis, insiderConviction: r.insiderConviction }) },
  { id: 'technical', label: 'Technical (C&H)', color: '#a5b4fc', fn: getTechnicalAnalysis, apply: (s, r) => ({ ...s, technicalAnalysis: r.technicalAnalysis, cupHandleScore: r.cupHandleScore }) },
  { id: 'valuation', label: 'Valuation', color: '#38bdf8', fn: getValuationAnalysis, apply: (s, r) => ({ ...s, valuationAnalysis: r.valuationAnalysis, valuationScore: r.valuationScore }) },
  { id: 'momentum', label: 'Momentum', color: '#fb923c', fn: getMomentumAnalysis, apply: (s, r) => ({ ...s, momentumAnalysis: r.momentumAnalysis, momentumScore: r.momentumScore, momentumChartScore: r.momentumChartScore, momentumContinuationScore: r.momentumContinuationScore, momentumParabolicScore: r.momentumParabolicScore }) },
  { id: 'buyout', label: 'Buyout Likelihood', color: '#fbbf24', fn: getBuyoutAnalysis, apply: (s, r) => ({ ...s, buyoutAnalysis: r.buyoutAnalysis, buyoutScore: r.buyoutScore, buyoutPeopleScore: r.buyoutPeopleScore, buyoutIntentScore: r.buyoutIntentScore, buyoutBuzzScore: r.buyoutBuzzScore, buyoutFitScore: r.buyoutFitScore }) },
  { id: 'leadership', label: 'Leadership', color: '#f472b6', fn: getLeadershipAnalysis, apply: (s, r) => ({ ...s, leadershipAnalysis: r.leadershipAnalysis, leadershipScore: r.leadershipScore, leadershipCeoScore: r.leadershipCeoScore, leadershipTeamScore: r.leadershipTeamScore, leadershipPublicScore: r.leadershipPublicScore, leadershipVibesScore: r.leadershipVibesScore }) },
  { id: 'playbook', label: 'Playbook Match', color: '#a78bfa', fn: (s, m, ctx) => getPlaybookAnalysis(s, m, ctx?.playbooks || DEFAULT_PLAYBOOKS), apply: (s, r) => ({ ...s, playbookAnalysis: r.playbookAnalysis, playbookScore: r.playbookScore, playbookBest: r.playbookBest, playbookScores: r.playbookScores }) },
];
