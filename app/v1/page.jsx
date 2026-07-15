'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { TrendingUp, Users, BarChart3, Target, ChevronDown, ChevronUp, Zap, RefreshCw, Clock, CheckCircle, Sliders, Play, Brain, Network, LineChart, Globe, Database, FileText, Radio, Radar, AlertCircle, X, RotateCcw, DollarSign, Activity, TrendingDown, Beaker, Sparkles, Banknote, Calendar, Cpu, Atom, Bot, Eye, Filter, Flame, Plus, Trash2 } from 'lucide-react';

// ============================================
// API CONFIGURATION
// ============================================
const POLYGON_KEY = process.env.NEXT_PUBLIC_POLYGON_KEY || '';
const FINNHUB_KEY = process.env.NEXT_PUBLIC_FINNHUB_KEY || '';

const SESSIONS_KEY = 'singularityhunter_sessions';
const CACHE_DURATION = 24 * 60 * 60 * 1000;

const MIN_MARKET_CAP = 40_000_000;
const MAX_MARKET_CAP = 400_000_000;

// Stock limit options
const STOCK_LIMITS = {
  100: '100 stocks',
  500: '500 stocks',
  1000: '1000 stocks',
  0: 'All stocks'
};

// Category filters
const STOCK_CATEGORIES = {
  all: { name: 'All Stocks', keywords: [] },
  singularity: { name: 'Singularity (70+)', keywords: [], singularityFilter: true },
  tech: { name: 'Tech', keywords: ['software', 'computer', 'semiconductor', 'electronic', 'technology', 'data processing', 'internet', 'cloud', 'cyber', 'digital'] },
  biotech: { name: 'Biotech/Health', keywords: ['biotech', 'pharmaceutical', 'medical', 'drug', 'health', 'therapeutic', 'diagnostic', 'surgical'] },
  energy: { name: 'Energy', keywords: ['oil', 'gas', 'energy', 'solar', 'wind', 'petroleum', 'mining', 'utilities'] },
  finance: { name: 'Finance', keywords: ['bank', 'financial', 'insurance', 'investment', 'loan', 'credit', 'capital'] },
};

const discoveryAgents = [
  { id: 'polygonScreener', name: 'Polygon Screener', icon: Database, color: '#8B5CF6', coverage: 'All US stocks' },
  { id: 'marketCapFilter', name: 'Market Cap Filter', icon: DollarSign, color: '#3B82F6', coverage: '$40M - $400M' },
  { id: 'technicalScanner', name: 'Technical Scanner', icon: Activity, color: '#F59E0B', coverage: '52-week analysis' },
  { id: 'insiderScanner', name: 'Insider Scanner', icon: Users, color: '#10B981', coverage: 'SEC Form 4' },
  { id: 'financialScanner', name: 'Financial Scanner', icon: Banknote, color: '#EC4899', coverage: 'Cash & Debt' },
];

const analysisAgents = [
  { id: 'pricePosition', name: 'Price Position', desc: '52-week range position', icon: Target, color: '#3B82F6' },
  { id: 'insiderActivity', name: 'Insider Activity', desc: 'Recent insider purchases', icon: Users, color: '#10B981' },
  { id: 'netCash', name: 'Net Cash', desc: 'Cash minus debt', icon: Banknote, color: '#8B5CF6' },
];

// ============================================
// API FUNCTIONS
// ============================================

async function getFilteredTickers(stockLimit = 0) {
  const tickers = [];
  let nextUrl = `https://api.polygon.io/v3/reference/tickers?market=stocks&active=true&limit=1000&apiKey=${POLYGON_KEY}`;
  let pageCount = 0;
  const maxPages = stockLimit > 0 && stockLimit <= 500 ? 5 : stockLimit <= 1000 ? 10 : 100;
  
  while (nextUrl && pageCount < maxPages) {
    const res = await fetch(nextUrl);
    if (!res.ok) throw new Error(`Polygon API error: ${res.status}`);
    const data = await res.json();
    
    if (data.results) {
      const filtered = data.results.filter(t => 
        t.market === 'stocks' &&
        t.type === 'CS' &&
        (t.primary_exchange === 'XNYS' || t.primary_exchange === 'XNAS') &&
        !t.ticker.includes('.') &&
        !t.ticker.includes('-')
      );
      tickers.push(...filtered);
      
      if (stockLimit > 0 && tickers.length >= stockLimit) {
        return tickers.slice(0, stockLimit);
      }
    }
    
    nextUrl = data.next_url ? `${data.next_url}&apiKey=${POLYGON_KEY}` : null;
    pageCount++;
    await new Promise(r => setTimeout(r, 250));
  }
  
  return stockLimit > 0 ? tickers.slice(0, stockLimit) : tickers;
}

async function getTickerDetails(ticker) {
  try {
    const res = await fetch(`https://api.polygon.io/v3/reference/tickers/${ticker}?apiKey=${POLYGON_KEY}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.results || null;
  } catch (e) { return null; }
}

async function getPrevDay(ticker) {
  try {
    const res = await fetch(`https://api.polygon.io/v2/aggs/ticker/${ticker}/prev?adjusted=true&apiKey=${POLYGON_KEY}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.results?.[0] || null;
  } catch (e) { return null; }
}

// Get pre-market and after-hours data from Polygon
async function getExtendedHours(ticker) {
  try {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    
    // Get previous day close
    const prevRes = await fetch(
      `https://api.polygon.io/v2/aggs/ticker/${ticker}/prev?adjusted=true&apiKey=${POLYGON_KEY}`
    );
    
    if (!prevRes.ok) {
      console.warn(`Polygon prev error for ${ticker}: ${prevRes.status}`);
      return null;
    }
    
    const prevData = await prevRes.json();
    const prevDay = prevData.results?.[0];
    const previousClose = prevDay?.c || null;
    const regularMarketPrice = prevDay?.c || null;
    
    if (!previousClose) {
      return null;
    }
    
    // Try to get today's aggregates including extended hours
    const aggRes = await fetch(
      `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/5/minute/${today}/${today}?adjusted=true&sort=desc&limit=50&apiKey=${POLYGON_KEY}`
    );
    
    let preMarketPrice = null;
    let afterHoursPrice = null;
    let latestPrice = previousClose;
    
    if (aggRes.ok) {
      const aggData = await aggRes.json();
      const bars = aggData.results || [];
      
      // Get the most recent bar as latest price
      if (bars.length > 0) {
        latestPrice = bars[0].c;
        
        // Check each bar to categorize by time
        for (const bar of bars) {
          const barTime = new Date(bar.t);
          const utcHour = barTime.getUTCHours();
          const utcMin = barTime.getUTCMinutes();
          
          // Pre-market: before 9:30 AM ET = before 14:30 UTC
          if (utcHour < 14 || (utcHour === 14 && utcMin < 30)) {
            if (!preMarketPrice) preMarketPrice = bar.c;
          }
          // After-hours: after 4:00 PM ET = after 21:00 UTC  
          else if (utcHour >= 21) {
            if (!afterHoursPrice) afterHoursPrice = bar.c;
          }
        }
      }
    }
    
    // Calculate changes
    let preMarketChange = null;
    let afterHoursChange = null;
    
    if (preMarketPrice && previousClose) {
      preMarketChange = ((preMarketPrice - previousClose) / previousClose) * 100;
    }
    
    if (afterHoursPrice && regularMarketPrice) {
      afterHoursChange = ((afterHoursPrice - regularMarketPrice) / regularMarketPrice) * 100;
    }
    
    // If we have any price movement today vs previous close, show it
    let extendedChange = null;
    if (latestPrice && previousClose && latestPrice !== previousClose) {
      extendedChange = ((latestPrice - previousClose) / previousClose) * 100;
    }
    
    // Use extended change as either pre or post depending on time
    const utcHour = now.getUTCHours();
    let marketState = 'CLOSED';
    
    if (now.getDay() >= 1 && now.getDay() <= 5) {
      if (utcHour >= 9 && utcHour < 14) { // ~4-9:30 AM ET
        marketState = 'PRE';
        if (!preMarketChange && extendedChange) preMarketChange = extendedChange;
        if (!preMarketPrice) preMarketPrice = latestPrice;
      } else if (utcHour >= 14 && utcHour < 21) { // 9:30 AM - 4 PM ET
        marketState = 'REGULAR';
      } else if (utcHour >= 21 || utcHour < 1) { // 4-8 PM ET
        marketState = 'POST';
        if (!afterHoursChange && extendedChange) afterHoursChange = extendedChange;
        if (!afterHoursPrice) afterHoursPrice = latestPrice;
      }
    }
    
    console.log(`${ticker} Extended: pre=${preMarketChange?.toFixed(2)}% post=${afterHoursChange?.toFixed(2)}% state=${marketState}`);
    
    return {
      preMarketPrice,
      preMarketChange,
      afterHoursPrice,
      afterHoursChange,
      regularMarketPrice,
      previousClose,
      marketState,
      lastUpdate: new Date().toISOString()
    };
  } catch (e) { 
    console.error(`Extended hours failed for ${ticker}:`, e);
    return null; 
  }
}

async function get52WeekData(ticker) {
  try {
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const res = await fetch(
      `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/1/day/${startDate}/${endDate}?adjusted=true&sort=desc&limit=260&apiKey=${POLYGON_KEY}`
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.results || [];
  } catch (e) { return []; }
}

// Enhanced financials - try multiple sources
async function getFinancials(ticker) {
  // Try Polygon financials first
  try {
    const res = await fetch(
      `https://api.polygon.io/vX/reference/financials?ticker=${ticker}&limit=4&sort=filing_date&order=desc&apiKey=${POLYGON_KEY}`
    );
    if (res.ok) {
      const data = await res.json();
      
      // Try each quarterly report
      for (const results of (data.results || [])) {
        if (results?.financials) {
          const bs = results.financials.balance_sheet || {};
          
          // Try many different field names
          const cash = 
            bs.cash_and_cash_equivalents?.value ||
            bs.cash_and_short_term_investments?.value ||
            bs.cash?.value ||
            bs.current_assets?.value * 0.3 || // Estimate 30% of current assets
            0;
          
          const debt = 
            bs.long_term_debt?.value ||
            bs.total_debt?.value ||
            bs.short_long_term_debt_total?.value ||
            bs.noncurrent_liabilities?.value ||
            bs.total_liabilities?.value * 0.5 || // Estimate 50% of liabilities
            0;
          
          if (cash > 0 || debt > 0) {
            return { cash, debt, netCash: cash - debt, source: 'polygon' };
          }
        }
      }
    }
  } catch (e) { 
    console.warn(`Polygon financials failed for ${ticker}:`, e);
  }
  
  // Try Finnhub basic financials
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/metric?symbol=${ticker}&metric=all&token=${FINNHUB_KEY}`
    );
    if (res.ok) {
      const data = await res.json();
      const m = data.metric || {};
      
      // Calculate from available metrics
      const sharesOut = m.shareOutstanding || 0; // in millions
      const cashPerShare = m.cashPerShareAnnual || m.cashPerShareQuarterly || 0;
      const bookValue = m.bookValuePerShareAnnual || m.bookValuePerShareQuarterly || 0;
      const debtEquity = m.totalDebtToEquityAnnual || m.totalDebtToEquityQuarterly || 0;
      
      if (sharesOut > 0 && (cashPerShare > 0 || debtEquity > 0)) {
        const cash = cashPerShare * sharesOut * 1000000;
        const equity = bookValue * sharesOut * 1000000;
        const debt = equity * (debtEquity / 100);
        
        return { cash, debt, netCash: cash - debt, source: 'finnhub' };
      }
      
      // Alternative: use current ratio
      const currentRatio = m.currentRatioAnnual || m.currentRatioQuarterly;
      const quickRatio = m.quickRatioAnnual || m.quickRatioQuarterly;
      
      if (currentRatio && sharesOut > 0) {
        // Rough estimate based on ratios
        const marketCap = m.marketCapitalization || 0; // in millions
        const estCash = marketCap * 0.1 * 1000000; // Assume 10% of market cap
        const estDebt = marketCap * (1 / currentRatio) * 0.3 * 1000000;
        
        if (estCash > 0) {
          return { cash: estCash, debt: estDebt, netCash: estCash - estDebt, source: 'finnhub-est' };
        }
      }
    }
  } catch (e) {
    console.warn(`Finnhub metrics failed for ${ticker}:`, e);
  }
  
  return null;
}

// Insider transactions
async function getInsiderTransactions(ticker) {
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/insider-transactions?symbol=${ticker}&token=${FINNHUB_KEY}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    
    if (!data.data || data.data.length === 0) return null;
    
    // Filter for open market purchases only
    const purchases = data.data.filter(t => {
      const isPurchase = t.transactionCode === 'P';
      return isPurchase && t.share > 0 && t.transactionDate;
    });
    
    if (purchases.length === 0) return null;
    
    purchases.sort((a, b) => new Date(b.transactionDate) - new Date(a.transactionDate));
    
    const latest = purchases[0];
    const pricePerShare = latest.transactionPrice || 0;
    const shares = latest.share || 0;
    const totalValue = shares * pricePerShare;
    
    return {
      date: latest.transactionDate,
      amount: totalValue,
      shares: shares,
      price: pricePerShare,
      name: latest.name || 'Insider',
    };
  } catch (e) { 
    return null; 
  }
}

// ============================================
// OPTIONS HEAT - Detect unusual options activity
// ============================================
async function getOptionsSentiment(ticker) {
  try {
    // Get options contracts from Polygon
    const today = new Date();
    const futureDate = new Date(today.getTime() + 60 * 24 * 60 * 60 * 1000); // 60 days out
    const dateStr = futureDate.toISOString().split('T')[0];
    
    const res = await fetch(
      `https://api.polygon.io/v3/reference/options/contracts?underlying_ticker=${ticker}&expired=false&limit=100&apiKey=${POLYGON_KEY}`
    );
    
    if (!res.ok) return { swingTradeScore: 0, putCallRatio: null, optionsVolume: 0, ivRank: null };
    
    const data = await res.json();
    
    if (!data.results || data.results.length === 0) {
      return { swingTradeScore: 0, putCallRatio: null, optionsVolume: 0, ivRank: null, noOptions: true };
    }
    
    // Count puts vs calls
    let calls = 0, puts = 0;
    let totalOI = 0;
    
    data.results.forEach(contract => {
      if (contract.contract_type === 'call') {
        calls++;
        totalOI += contract.open_interest || 0;
      } else if (contract.contract_type === 'put') {
        puts++;
        totalOI += contract.open_interest || 0;
      }
    });
    
    // Calculate put/call ratio (lower = more bullish)
    const putCallRatio = calls > 0 ? (puts / calls) : null;
    
    // Try to get recent options volume/activity
    let recentVolume = 0;
    let avgVolume = 0;
    let ivEstimate = null;
    
    // Get a sample of options snapshots for volume
    try {
      const snapshotRes = await fetch(
        `https://api.polygon.io/v3/snapshot/options/${ticker}?limit=50&apiKey=${POLYGON_KEY}`
      );
      
      if (snapshotRes.ok) {
        const snapshotData = await snapshotRes.json();
        if (snapshotData.results) {
          snapshotData.results.forEach(opt => {
            if (opt.day) {
              recentVolume += opt.day.volume || 0;
            }
            if (opt.implied_volatility) {
              ivEstimate = ivEstimate ? (ivEstimate + opt.implied_volatility) / 2 : opt.implied_volatility;
            }
          });
        }
      }
    } catch (e) {
      // Snapshot not available, continue
    }
    
    // Calculate Swing Trade Score (0-100)
    // Higher score = more bullish signals
    let swingTradeScore = 50; // Start neutral
    
    // Put/Call ratio scoring (lower is bullish)
    if (putCallRatio !== null) {
      if (putCallRatio < 0.5) swingTradeScore += 25; // Very bullish
      else if (putCallRatio < 0.7) swingTradeScore += 15;
      else if (putCallRatio < 1.0) swingTradeScore += 5;
      else if (putCallRatio > 1.5) swingTradeScore -= 15; // Bearish
      else if (putCallRatio > 1.2) swingTradeScore -= 5;
    }
    
    // Open interest scoring (more activity = more interest)
    if (totalOI > 10000) swingTradeScore += 15;
    else if (totalOI > 5000) swingTradeScore += 10;
    else if (totalOI > 1000) swingTradeScore += 5;
    else if (totalOI < 100) swingTradeScore -= 10; // Low liquidity
    
    // Recent volume scoring
    if (recentVolume > 5000) swingTradeScore += 10;
    else if (recentVolume > 1000) swingTradeScore += 5;
    
    // Clamp score
    swingTradeScore = Math.max(0, Math.min(100, swingTradeScore));
    
    return {
      swingTradeScore,
      putCallRatio: putCallRatio ? putCallRatio.toFixed(2) : null,
      optionsVolume: recentVolume,
      openInterest: totalOI,
      ivRank: ivEstimate ? Math.round(ivEstimate * 100) : null,
      callCount: calls,
      putCount: puts
    };
    
  } catch (e) {
    console.warn(`Options data failed for ${ticker}:`, e);
    return { swingTradeScore: 0, putCallRatio: null, optionsVolume: 0, ivRank: null };
  }
}

// ============================================
// GROK AI ANALYSIS - Insider Conviction Focus
// ============================================
async function getAIAnalysis(stock, model = 'grok-4') {
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

    const response = await fetch("/api/grok", {
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
async function getTechnicalAnalysis(stock, model = 'grok-4') {
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

    const response = await fetch("/api/grok", {
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
// UPSIDE SCAN - 8-Month Price Target Analysis
// ============================================
async function getUpsideAnalysis(stock, model = 'grok-4') {
  console.log(`Running Upside Scan for ${stock.ticker} with ${model}...`);
  
  try {
    const prompt = `You are an aggressive small-cap analyst looking for 2X-10X opportunities over 8 months.

STOCK TO ANALYZE: ${stock.ticker}

DO YOUR OWN INDEPENDENT RESEARCH. Look up:
1. Current stock price and market cap
2. Recent price action and momentum
3. 52-week high and low
4. Company fundamentals and recent earnings
5. Analyst price targets
6. Upcoming catalysts (earnings, FDA, contracts, product launches)
7. Insider buying/selling activity
8. Short interest and float
9. Sector trends and tailwinds
10. M&A or acquisition potential

SMALL-CAP UPSIDE FRAMEWORK:
For small caps, massive moves are COMMON. Consider:

- REVERSION TO MEAN: If stock is down big from highs, what would bring it back?
- SECTOR TAILWINDS: Is this sector heating up? AI, robotics, energy, defense can 3-5X on momentum.
- EARNINGS SURPRISE: Small caps can gap 30-50% on a single earnings beat.
- ACQUISITION PREMIUM: Would a larger player pay 50-100% premium?
- SHORT SQUEEZE: Low float + high short interest = potential 2-5X moves.
- INSTITUTIONAL DISCOVERY: If hedge funds start accumulating, price can double.
- INDEX INCLUSION: Getting added to indices forces buying, often +30-50%.

SCORING GUIDE FOR SMALL CAPS:
- -50 to -20%: Broken company, avoid
- -20 to 0%: Downside risks outweigh upside
- 0 to +50%: Modest opportunity
- +50 to +100%: Good setup
- +100 to +200%: Strong opportunity, multiple catalysts
- +200 to +400%: High conviction, major re-rating potential
- +400 to +800%: Exceptional setup, potential multi-bagger

BE BOLD. Small caps regularly make 200-500% moves. If you see a clear path to massive upside, say so.
If the stock is a dud with no catalysts, be honest about that too.

Write 2-3 sentences explaining your thesis and key catalysts based on your research.

END WITH EXACTLY:
8MO_PREDICTION: [number from -80 to +800]`;

    const response = await fetch("/api/grok", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, isMatty: true, model })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Upside scan API error:', errorData);
      return { upsideAnalysis: `API Error: ${errorData.error || response.status}`, upsidePrediction: null };
    }

    const data = await response.json();
    console.log('Upside scan response:', data);
    
    // Extract prediction - allow higher range for small caps
    let upsidePrediction = data.mattyPrediction;
    
    if (upsidePrediction === null && data.analysis) {
      const match = data.analysis.match(/8MO_PREDICTION[:\s]*([+-]?\d+)/i);
      if (match) {
        upsidePrediction = Math.min(800, Math.max(-80, parseInt(match[1])));
      }
    }
    
    // Clean up the analysis text
    let analysis = data.analysis?.replace(/8MO_PREDICTION[:\s]*[+-]?\d+%?/gi, '').trim() || 'No response';
    
    return { upsideAnalysis: analysis, upsidePrediction };
  } catch (e) {
    console.error('Upside scan failed:', e);
    return { upsideAnalysis: `Error: ${e.message}`, upsidePrediction: null };
  }
}

// ============================================
// ORACLE ANALYSIS - The Singularity Capitalist
// ============================================
async function getOracleAnalysis(stock) {
  console.log(`Running Oracle analysis for ${stock.ticker}...`);
  
  try {
    const singularityScores = stock.singularityScores || {};
    const maxSingularityScore = Math.max(
      singularityScores.compute || 0,
      singularityScores.energy || 0,
      singularityScores.robotics || 0,
      singularityScores.agi_interface || 0
    );
    
    const topBucket = Object.entries(singularityScores)
      .sort((a, b) => b[1] - a[1])[0];
    
    const prompt = `You are "The Singularity Capitalist" - a hyper-aggressive investor who combines Warren Buffett's value discipline with Sam Altman's exponential growth thesis. You are NOT risk-averse. You accept 100% loss risk for 1000% gain potential. You hunt for hidden suppliers to the Singularity.

ANALYZE THIS POTENTIAL SINGULARITY SUPPLIER:

COMPANY: ${stock.ticker} - ${stock.name}
SECTOR: ${stock.sector || 'Unknown'}

FINANCIALS:
- Price: $${stock.price?.toFixed(2)} | Market Cap: $${stock.marketCap}M
- Net Cash: ${stock.netCash ? '$' + (stock.netCash / 1000000).toFixed(1) + 'M' : 'Unknown'} ${stock.netCash > 0 ? '(CASH RICH)' : stock.netCash < 0 ? '(IN DEBT)' : ''}
- 52-Week Position: ${stock.fromLow?.toFixed(1)}% above low

SINGULARITY SUPPLY CHAIN RELEVANCE:
- COMPUTE Score: ${singularityScores.compute || 0}/10 (Semiconductors, photonics, cooling, data centers)
- ENERGY Score: ${singularityScores.energy || 0}/10 (Nuclear, fusion, transformers, batteries)
- ROBOTICS Score: ${singularityScores.robotics || 0}/10 (Actuators, sensors, rare earth, humanoids)
- AGI_INTERFACE Score: ${singularityScores.agi_interface || 0}/10 (BCI, AR/VR, haptics)
- TOP BUCKET: ${topBucket ? topBucket[0].toUpperCase() : 'None'} (${topBucket ? topBucket[1] : 0}/10)

OPTIONS HEAT:
- Swing Trade Score: ${stock.swingTradeScore || 0}/100
- Put/Call Ratio: ${stock.putCallRatio || 'N/A'} ${stock.putCallRatio && stock.putCallRatio < 0.7 ? '(BULLISH FLOW)' : ''}
- Open Interest: ${stock.openInterest?.toLocaleString() || 'N/A'}

INSIDER ACTIVITY:
- Insider Activity Score: ${stock.agentScores?.insiderActivity || 0}/100
- Last Purchase: ${stock.lastInsiderPurchase?.date || 'None'} ${stock.lastInsiderPurchase?.amount ? '($' + Math.round(stock.lastInsiderPurchase.amount).toLocaleString() + ')' : ''}

TECHNICAL:
- Cup & Handle Score: ${stock.cupHandleScore || 'Not analyzed'}/100

AS THE SINGULARITY CAPITALIST, ANALYZE:
1. Why could this stock 10x as AGI/Robotics/Infinite Energy arrives?
2. What's the hidden supply chain angle others are missing?
3. Is the options flow confirming smart money accumulation?
4. What's the risk of total loss vs potential for massive gain?

Be aggressive. Be bold. Find the 10x thesis or reject this stock entirely.

END YOUR RESPONSE WITH EXACTLY THESE FOUR LINES:
PREDICTION: [BULLISH / BEARISH / NEUTRAL]
CONVICTION_SCORE: [0-100]
TARGET_TIMEFRAME: [Short-term Swing / Long-term Hold]
THE_10X_THESIS: [One sentence on why this specific stock could 10x]`;

    const response = await fetch("/api/grok", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt })
    });

    if (!response.ok) {
      const errorData = await response.json();
      return { 
        oracleAnalysis: `API Error: ${errorData.error || response.status}`,
        prediction: null,
        oracleConviction: null,
        targetTimeframe: null,
        tenXThesis: null
      };
    }

    const data = await response.json();
    let text = data.analysis || '';
    
    // Extract Oracle outputs
    let prediction = null;
    const predictionMatch = text.match(/PREDICTION[:\s]*(BULLISH|BEARISH|NEUTRAL)/i);
    if (predictionMatch) prediction = predictionMatch[1].toUpperCase();
    
    let oracleConviction = null;
    const convictionMatch = text.match(/CONVICTION_SCORE[:\s]*(\d+)/i);
    if (convictionMatch) oracleConviction = parseInt(convictionMatch[1]);
    
    let targetTimeframe = null;
    const timeframeMatch = text.match(/TARGET_TIMEFRAME[:\s]*(Short-term Swing|Long-term Hold)/i);
    if (timeframeMatch) targetTimeframe = timeframeMatch[1];
    
    let tenXThesis = null;
    const thesisMatch = text.match(/THE_10X_THESIS[:\s]*(.+?)(?:\n|$)/i);
    if (thesisMatch) tenXThesis = thesisMatch[1].trim();
    
    // Clean the analysis text
    text = text.replace(/PREDICTION[:\s]*(BULLISH|BEARISH|NEUTRAL)/gi, '').trim();
    text = text.replace(/CONVICTION_SCORE[:\s]*\d+/gi, '').trim();
    text = text.replace(/TARGET_TIMEFRAME[:\s]*(Short-term Swing|Long-term Hold)/gi, '').trim();
    text = text.replace(/THE_10X_THESIS[:\s]*.+/gi, '').trim();
    
    return {
      oracleAnalysis: text,
      prediction,
      oracleConviction,
      targetTimeframe,
      tenXThesis
    };
    
  } catch (e) {
    console.error('Oracle analysis failed:', e);
    return { 
      oracleAnalysis: `Error: ${e.message}`,
      prediction: null,
      oracleConviction: null,
      targetTimeframe: null,
      tenXThesis: null
    };
  }
}

function calculateRSI(prices, period = 14) {
  if (prices.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const change = prices[i - 1] - prices[i];
    if (change > 0) gains += change;
    else losses -= change;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

function processStock(ticker, details, prevDay, historicalData, financials, insiderData, idx) {
  const currentPrice = prevDay?.c || 0;
  const prices = historicalData.map(d => d.c);
  
  const high52 = prices.length > 0 ? Math.max(...prices) : currentPrice;
  const low52 = prices.length > 0 ? Math.min(...prices) : currentPrice;
  const range52 = high52 - low52;
  const positionIn52Week = range52 > 0 ? ((currentPrice - low52) / range52) * 100 : 50;
  const fromLow = low52 > 0 ? ((currentPrice - low52) / low52) * 100 : 0;
  
  const rsi = calculateRSI(prices);
  const change = prevDay?.o ? ((currentPrice - prevDay.o) / prevDay.o) * 100 : 0;
  const marketCapM = Math.round((details?.market_cap || 0) / 1_000_000);
  
  const cash = financials?.cash || 0;
  const debt = financials?.debt || 0;
  const netCash = financials?.netCash || 0;
  
  const pricePositionScore = Math.max(0, Math.min(100, 100 - positionIn52Week));
  
  let insiderScore = 20;
  if (insiderData?.date) {
    const daysSincePurchase = Math.floor((Date.now() - new Date(insiderData.date)) / (1000 * 60 * 60 * 24));
    if (daysSincePurchase < 30) insiderScore = 95;
    else if (daysSincePurchase < 60) insiderScore = 85;
    else if (daysSincePurchase < 90) insiderScore = 70;
    else if (daysSincePurchase < 180) insiderScore = 55;
    else if (daysSincePurchase < 365) insiderScore = 40;
  }
  
  let netCashScore = 50;
  if (financials) {
    if (netCash > 0) {
      const cashToMarketCap = (netCash / 1000000) / marketCapM;
      netCashScore = Math.min(100, 50 + cashToMarketCap * 100);
    } else if (netCash < 0) {
      const debtToMarketCap = Math.abs(netCash / 1000000) / marketCapM;
      netCashScore = Math.max(0, 50 - debtToMarketCap * 50);
    }
  }
  
  return {
    id: idx + 1,
    ticker,
    name: details?.name || ticker,
    sector: details?.sic_description || 'Unknown',
    price: currentPrice,
    marketCap: marketCapM,
    change,
    high52, low52, positionIn52Week, fromLow, rsi,
    cash, debt, netCash,
    hasFinancials: financials !== null,
    financialSource: financials?.source || null,
    lastInsiderPurchase: insiderData,
    hasInsiderData: insiderData !== null,
    priceTarget: null, // Will be filled in separately
    agentScores: {
      pricePosition: pricePositionScore,
      insiderActivity: insiderScore,
      netCash: netCashScore,
    },
    compositeScore: 0,
    aiAnalysis: null,
  };
}

// Session management functions
function generateSessionId() {
  return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function saveSession(sessionId, stocks, scanStats, name = null) {
  try {
    const sessions = JSON.parse(localStorage.getItem(SESSIONS_KEY) || '{}');
    sessions[sessionId] = {
      id: sessionId,
      name: name || new Date().toLocaleString(),
      timestamp: Date.now(),
      stocks,
      scanStats,
      stockCount: stocks.length
    };
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
    localStorage.setItem('singularityhunter_current_session', sessionId);
  } catch (e) { console.warn('Session save failed:', e); }
}

function loadSession(sessionId) {
  try {
    const sessions = JSON.parse(localStorage.getItem(SESSIONS_KEY) || '{}');
    return sessions[sessionId] || null;
  } catch (e) { return null; }
}

function loadCurrentSession() {
  try {
    const currentId = localStorage.getItem('singularityhunter_current_session');
    if (!currentId) return null;
    return loadSession(currentId);
  } catch (e) { return null; }
}

function getAllSessions() {
  try {
    const sessions = JSON.parse(localStorage.getItem(SESSIONS_KEY) || '{}');
    return Object.values(sessions).sort((a, b) => b.timestamp - a.timestamp);
  } catch (e) { return []; }
}

function deleteSession(sessionId) {
  try {
    const sessions = JSON.parse(localStorage.getItem(SESSIONS_KEY) || '{}');
    delete sessions[sessionId];
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  } catch (e) { console.warn('Session delete failed:', e); }
}

function formatCacheAge(ms) {
  if (!ms) return '';
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const mins = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  return hours > 0 ? `${hours}h ${mins}m ago` : `${mins}m ago`;
}

function formatDate(dateStr) {
  if (!dateStr) return 'N/A';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatMoney(amount) {
  if (amount === null || amount === undefined) return 'N/A';
  if (amount === 0) return '$0';
  const absAmount = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';
  if (absAmount >= 1000000000) return `${sign}$${(absAmount / 1000000000).toFixed(1)}B`;
  if (absAmount >= 1000000) return `${sign}$${(absAmount / 1000000).toFixed(1)}M`;
  if (absAmount >= 1000) return `${sign}$${(absAmount / 1000).toFixed(0)}K`;
  return `${sign}$${absAmount.toFixed(0)}`;
}

// ============================================
// MAIN COMPONENT
// ============================================

export default function StockResearchApp() {
  const [stocks, setStocks] = useState([]);
  const [weights, setWeights] = useState({
    pricePosition: 30,
    insiderActivity: 30,
    netCash: 20,
    optionsHeat: 20,
  });
  const [selected, setSelected] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isAnalyzingAI, setIsAnalyzingAI] = useState(false);
  const [isAnalyzingUpside, setIsAnalyzingUpside] = useState(false);
  const [isAnalyzingTechnical, setIsAnalyzingTechnical] = useState(false);
  const [isScanningSupplyChain, setIsScanningSupplyChain] = useState(false);
  const [isRunningFullSpectrum, setIsRunningFullSpectrum] = useState(false);
  const [isRunningOracle, setIsRunningOracle] = useState(false);
  const [showWeights, setShowWeights] = useState(false);
  const [showDiscovery, setShowDiscovery] = useState(false);
  const [showSessions, setShowSessions] = useState(false);
  const [showFullSpectrumModal, setShowFullSpectrumModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showBaseScanMenu, setShowBaseScanMenu] = useState(false);
  const [upsideProgress, setUpsideProgress] = useState({ current: 0, total: 0 });
  const [technicalProgress, setTechnicalProgress] = useState({ current: 0, total: 0 });
  const [analysisStatus, setAnalysisStatus] = useState(Object.fromEntries(analysisAgents.map(a => [a.id, 'idle'])));
  const [discoveryStatus, setDiscoveryStatus] = useState(Object.fromEntries(discoveryAgents.map(a => [a.id, 'idle'])));
  const [sortBy, setSortBy] = useState('compositeScore');
  const [sectorFilter, setSectorFilter] = useState('all');
  const [supplyChainProgress, setSupplyChainProgress] = useState({ current: 0, total: 0 });
  
  const [isRefreshingPremarket, setIsRefreshingPremarket] = useState(false);
  
  // Manual stock add
  const [showAddStocks, setShowAddStocks] = useState(false);
  const [addStocksInput, setAddStocksInput] = useState('');
  const [isAddingStocks, setIsAddingStocks] = useState(false);
  
  // Clear column data
  const [showClearData, setShowClearData] = useState(false);
  
  // Global settings
  const [globalSettings, setGlobalSettings] = useState({
    minMarketCap: 40,      // in millions
    maxMarketCap: 400,     // in millions
    useCustomMarketCap: false
  });
  
  // Session management
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [sessions, setSessions] = useState([]);
  
  // Scan settings
  const [stockLimit, setStockLimit] = useState(100);
  
  // Full spectrum scan settings
  const [spectrumSettings, setSpectrumSettings] = useState({
    baseStockLimit: 500,
    singularityEnabled: true,
    grokEnabled: true,
    grokCount: 25,
    grokOnlySingularity70: false  // Only analyze stocks with singularity >= 70
  });

  // Filter by category keywords or Singularity buckets
  const matchesCategory = (stock, categoryKey) => {
    if (categoryKey === 'all') return true;
    const category = STOCK_CATEGORIES[categoryKey];
    if (!category) return true;
    
    // Singularity category - only show stocks with score >= 70
    if (category.singularityFilter) {
      return (stock.singularityScore || 0) >= 70;
    }
    
    // Keyword-based categories
    const sectorLower = (stock.sector || '').toLowerCase();
    const nameLower = (stock.name || '').toLowerCase();
    return category.keywords.some(kw => sectorLower.includes(kw) || nameLower.includes(kw));
  };
  
  const [lastUpdate, setLastUpdate] = useState(null);
  const [status, setStatus] = useState({ type: 'ready', msg: 'Loading...' });
  const [error, setError] = useState(null);
  const [scanProgress, setScanProgress] = useState({ phase: '', current: 0, total: 0, found: 0 });
  const [cacheAge, setCacheAge] = useState(null);
  const [aiProgress, setAiProgress] = useState({ current: 0, total: 0 });
  const [convictionCount, setConvictionCount] = useState(10);
  const [technicalCount, setTechnicalCount] = useState(10);
  const [upsideCount, setUpsideCount] = useState(10);
  const [grokModel, setGrokModel] = useState('grok-4');
  const [singularityBatchSize, setSingularityBatchSize] = useState(15);
  
  // Filter settings
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({
    hideNetCashNegative: false,
    minSingularityScore: 0,
    excludeBanks: false,
    excludeFood: false,
    excludeHealthcare: false,
    excludeInsurance: false,
    excludeREIT: false
  });
  
  const [aiWeights, setAiWeights] = useState({
    conviction: 15,
    upside: 15,
    cupHandle: 10,
    singularity: 30,
    oracle: 30
  });
  const [fullSpectrumPhase, setFullSpectrumPhase] = useState('');

  const calcScores = useCallback((list, w, aiW) => {
    const aw = aiW || { conviction: 20, upside: 20, cupHandle: 20 };
    
    // Calculate total weight (base + AI)
    const baseTotal = Object.values(w).reduce((a, b) => a + b, 0);
    const aiTotal = (aw.conviction || 0) + (aw.upside || 0) + (aw.cupHandle || 0) + (aw.singularity || 0) + (aw.oracle || 0);
    const grandTotal = baseTotal + aiTotal;
    
    // If all weights are 0, just return unsorted
    if (grandTotal === 0) {
      return list.map(s => ({ ...s, compositeScore: 50 }));
    }
    
    return list.map(s => {
      let score = 0;
      
      // Base scores (pricePosition, insiderActivity, netCash, optionsHeat)
      if (baseTotal > 0) {
        Object.keys(w).forEach(id => { 
          if (w[id] > 0) {
            let value = 0;
            if (id === 'optionsHeat') {
              value = s.swingTradeScore || 0;
            } else if (s.agentScores?.[id] !== undefined) {
              value = s.agentScores[id];
            }
            score += (value / 100) * (w[id] / grandTotal) * 100;
          }
        });
      }
      
      // AI scores - Conviction (0-100 scale)
      if (aw.conviction > 0 && s.insiderConviction !== null && s.insiderConviction !== undefined) {
        score += (s.insiderConviction / 100) * (aw.conviction / grandTotal) * 100;
      }
      
      // AI scores - Upside (normalize: 100%+ upside = max score)
      if (aw.upside > 0 && s.upsidePct !== null && s.upsidePct !== undefined) {
        const upsideNormalized = Math.max(0, Math.min(s.upsidePct / 100, 1));
        score += upsideNormalized * (aw.upside / grandTotal) * 100;
      }
      
      // AI scores - Cup & Handle (0-100 scale)
      if (aw.cupHandle > 0 && s.cupHandleScore !== null && s.cupHandleScore !== undefined) {
        score += (s.cupHandleScore / 100) * (aw.cupHandle / grandTotal) * 100;
      }
      
      // AI scores - Singularity (max of the 4 buckets, 0-10 scaled to 0-100)
      if (aw.singularity > 0 && s.singularityScores) {
        const maxSingularity = Math.max(
          s.singularityScores.compute || 0,
          s.singularityScores.energy || 0,
          s.singularityScores.robotics || 0,
          s.singularityScores.agi_interface || 0
        );
        score += (maxSingularity / 10) * (aw.singularity / grandTotal) * 100;
      }
      
      // AI scores - Oracle Conviction (0-100 scale)
      if (aw.oracle > 0 && s.oracleConviction !== null && s.oracleConviction !== undefined) {
        // Boost for BULLISH prediction
        let oracleMultiplier = 1;
        if (s.prediction === 'BULLISH') oracleMultiplier = 1.2;
        else if (s.prediction === 'BEARISH') oracleMultiplier = 0.5;
        
        score += (s.oracleConviction / 100) * oracleMultiplier * (aw.oracle / grandTotal) * 100;
      }
      
      return { ...s, compositeScore: Math.min(100, Math.max(0, score)) };
    }).sort((a, b) => b.compositeScore - a.compositeScore);
  }, []);

  useEffect(() => {
    // Load sessions list
    setSessions(getAllSessions());
    
    // Try to load current session
    const currentSession = loadCurrentSession();
    if (currentSession && currentSession.stocks?.length > 0) {
      const scored = calcScores(currentSession.stocks, weights, aiWeights);
      setStocks(scored);
      setCurrentSessionId(currentSession.id);
      setLastUpdate(new Date(currentSession.timestamp));
      setCacheAge(Date.now() - currentSession.timestamp);
      setStatus({ type: 'cached', msg: `${currentSession.stocks.length} stocks (${currentSession.name})` });
      setScanProgress(currentSession.scanStats || { phase: 'complete', current: 0, total: 0, found: currentSession.stocks.length });
    } else {
      setStatus({ type: 'ready', msg: 'Click Run Base Scan' });
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      if (currentSessionId) {
        const session = loadSession(currentSessionId);
        if (session) setCacheAge(Date.now() - session.timestamp);
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [currentSessionId]);

  // Separate Grok AI Analysis function - Insider Conviction focus
  const runGrokAnalysis = async (stocksInOrder) => {
    if (stocks.length === 0) return;
    
    setIsAnalyzingAI(true);
    setError(null);
    
    const orderedStocks = stocksInOrder || stocks;
    const countToAnalyze = convictionCount === 0 ? orderedStocks.length : Math.min(convictionCount, orderedStocks.length);
    const stocksToAnalyze = orderedStocks.slice(0, countToAnalyze);
    setAiProgress({ current: 0, total: stocksToAnalyze.length });
    
    for (let i = 0; i < stocksToAnalyze.length; i++) {
      setAiProgress({ current: i + 1, total: stocksToAnalyze.length });
      setStatus({ type: 'loading', msg: `Conviction scan: ${stocksToAnalyze[i].ticker} (${i + 1}/${stocksToAnalyze.length})...` });
      
      const result = await getAIAnalysis(stocksToAnalyze[i], grokModel);
      
      // Update stocks in state directly to allow parallel scans
      setStocks(prev => prev.map(s => 
        s.ticker === stocksToAnalyze[i].ticker ? { 
          ...s, 
          aiAnalysis: result.analysis,
          insiderConviction: result.insiderConviction
        } : s
      ));
      
      if (i < stocksToAnalyze.length - 1) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }
    
    setIsAnalyzingAI(false);
    setAiProgress({ current: 0, total: 0 });
    setStatus({ type: 'live', msg: `${stocks.length} stocks • Conviction scan complete` });
  };

  // Technical Analysis - Cup and Handle deep dive
  const runTechnicalAnalysis = async (stocksInOrder) => {
    if (stocks.length === 0) return;
    
    setIsAnalyzingTechnical(true);
    setError(null);
    
    const orderedStocks = stocksInOrder || stocks;
    const countToAnalyze = technicalCount === 0 ? orderedStocks.length : Math.min(technicalCount, orderedStocks.length);
    const stocksToAnalyze = orderedStocks.slice(0, countToAnalyze);
    setTechnicalProgress({ current: 0, total: stocksToAnalyze.length });
    
    for (let i = 0; i < stocksToAnalyze.length; i++) {
      setTechnicalProgress({ current: i + 1, total: stocksToAnalyze.length });
      setStatus({ type: 'loading', msg: `Technical scan: ${stocksToAnalyze[i].ticker} (${i + 1}/${stocksToAnalyze.length})...` });
      
      const result = await getTechnicalAnalysis(stocksToAnalyze[i], grokModel);
      
      // Update stocks in state directly to allow parallel scans
      setStocks(prev => prev.map(s => 
        s.ticker === stocksToAnalyze[i].ticker ? { 
          ...s, 
          technicalAnalysis: result.technicalAnalysis,
          cupHandleScore: result.cupHandleScore
        } : s
      ));
      
      if (i < stocksToAnalyze.length - 1) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }
    
    setIsAnalyzingTechnical(false);
    setTechnicalProgress({ current: 0, total: 0 });
    setStatus({ type: 'live', msg: `${stocks.length} stocks • Technical scan complete` });
  };

  // Upside Scan - Independent 8 Month Price Target Research
  const runUpsideAnalysis = async (stocksInOrder) => {
    if (stocks.length === 0) return;
    
    setIsAnalyzingUpside(true);
    setError(null);
    
    const orderedStocks = stocksInOrder || stocks;
    const countToAnalyze = upsideCount === 0 ? orderedStocks.length : Math.min(upsideCount, orderedStocks.length);
    const stocksToAnalyze = orderedStocks.slice(0, countToAnalyze);
    setUpsideProgress({ current: 0, total: stocksToAnalyze.length });
    
    for (let i = 0; i < stocksToAnalyze.length; i++) {
      setUpsideProgress({ current: i + 1, total: stocksToAnalyze.length });
      setStatus({ type: 'loading', msg: `Upside: ${stocksToAnalyze[i].ticker} (${i + 1}/${stocksToAnalyze.length})...` });
      
      const result = await getUpsideAnalysis(stocksToAnalyze[i], grokModel);
      
      // Update stocks in state directly to allow parallel scans
      setStocks(prev => prev.map(s => 
        s.ticker === stocksToAnalyze[i].ticker ? { 
          ...s, 
          upsideAnalysis: result.upsideAnalysis,
          upsidePrediction: result.upsidePrediction
        } : s
      ));
      
      if (i < stocksToAnalyze.length - 1) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }
    
    setIsAnalyzingUpside(false);
    setUpsideProgress({ current: 0, total: 0 });
    setStatus({ type: 'live', msg: `${stocks.length} stocks • Upside scan complete` });
  };

  // Refresh pre/post market data for all stocks
  const refreshPremarketData = async () => {
    if (isRefreshingPremarket || stocks.length === 0) return;
    
    setIsRefreshingPremarket(true);
    setStatus({ type: 'loading', msg: 'Refreshing pre/post market data...' });
    
    let updatedStocks = [...stocks];
    const batchSize = 10;
    
    for (let i = 0; i < stocks.length; i += batchSize) {
      const batch = stocks.slice(i, i + batchSize);
      
      const results = await Promise.all(
        batch.map(s => getExtendedHours(s.ticker))
      );
      
      results.forEach((extData, idx) => {
        if (extData) {
          const stockIdx = i + idx;
          updatedStocks = updatedStocks.map((s, sIdx) => 
            sIdx === stockIdx ? {
              ...s,
              preMarketChange: extData.preMarketChange,
              afterHoursChange: extData.afterHoursChange,
              preMarketPrice: extData.preMarketPrice,
              afterHoursPrice: extData.afterHoursPrice
            } : s
          );
        }
      });
      
      setStocks([...updatedStocks]);
      setStatus({ type: 'loading', msg: `Refreshing pre/post market... ${Math.min(i + batchSize, stocks.length)}/${stocks.length}` });
      
      if (i + batchSize < stocks.length) {
        await new Promise(r => setTimeout(r, 300));
      }
    }
    
    // Save to session
    if (currentSessionId) {
      const scanStats = { phase: 'complete', current: stocks.length, total: stocks.length, found: stocks.length };
      saveSession(currentSessionId, updatedStocks, scanStats);
      setSessions(getAllSessions());
    }
    
    setIsRefreshingPremarket(false);
    setStatus({ type: 'live', msg: `${stocks.length} stocks • Pre/post market updated` });
  };

  // Refresh current stocks (re-fetch prices without adding new stocks)
  const refreshCurrentStocks = async () => {
    if (isScanning || stocks.length === 0) return;
    
    setIsScanning(true);
    setError(null);
    setStatus({ type: 'loading', msg: 'Refreshing current stocks...' });
    setScanProgress({ phase: 'Refreshing prices...', current: 0, total: stocks.length, found: stocks.length });
    
    let updatedStocks = [...stocks];
    
    for (let i = 0; i < stocks.length; i++) {
      const stock = stocks[i];
      setScanProgress({ phase: 'Refreshing prices...', current: i + 1, total: stocks.length, found: stocks.length });
      setStatus({ type: 'loading', msg: `Refreshing ${stock.ticker}... (${i + 1}/${stocks.length})` });
      
      try {
        // Get latest price data
        const priceRes = await fetch(
          `https://api.polygon.io/v2/aggs/ticker/${stock.ticker}/prev?adjusted=true&apiKey=${POLYGON_KEY}`
        );
        const priceData = await priceRes.json();
        const prevDay = priceData.results?.[0];
        
        if (prevDay) {
          const currentPrice = prevDay.c;
          const change = prevDay.o > 0 ? ((prevDay.c - prevDay.o) / prevDay.o) * 100 : 0;
          
          // Get fresh 52-week data
          const weekData = await get52WeekData(stock.ticker);
          let high52 = stock.high52, low52 = stock.low52;
          if (weekData.length > 0) {
            high52 = Math.max(...weekData.map(d => d.h));
            low52 = Math.min(...weekData.map(d => d.l));
          }
          
          const fromLow = low52 > 0 ? ((currentPrice - low52) / low52) * 100 : 0;
          const positionIn52Week = high52 !== low52 ? ((currentPrice - low52) / (high52 - low52)) * 100 : 50;
          
          updatedStocks = updatedStocks.map(s => 
            s.ticker === stock.ticker ? {
              ...s,
              price: currentPrice,
              change,
              high52,
              low52,
              fromLow,
              positionIn52Week,
              agentScores: {
                ...s.agentScores,
                pricePosition: Math.max(0, 100 - positionIn52Week)
              }
            } : s
          );
        }
      } catch (e) {
        console.error(`Failed to refresh ${stock.ticker}:`, e);
      }
      
      // Small delay to avoid rate limiting
      if (i < stocks.length - 1 && i % 5 === 4) {
        await new Promise(r => setTimeout(r, 200));
      }
    }
    
    // Recalculate scores
    const scoredStocks = calcScores(updatedStocks, weights, aiWeights);
    setStocks(scoredStocks);
    
    // Save to session
    if (currentSessionId) {
      const scanStats = { phase: 'complete', current: stocks.length, total: stocks.length, found: stocks.length };
      saveSession(currentSessionId, scoredStocks, scanStats);
      setSessions(getAllSessions());
    }
    
    setIsScanning(false);
    setScanProgress({ phase: 'complete', current: stocks.length, total: stocks.length, found: stocks.length });
    setStatus({ type: 'live', msg: `${stocks.length} stocks • Prices refreshed` });
    setLastUpdate(new Date());
  };

  // Manually add stocks by ticker
  const addManualStocks = async () => {
    if (!addStocksInput.trim() || isAddingStocks) return;
    
    setIsAddingStocks(true);
    setError(null);
    
    // Parse input - split by comma, space, newline, etc.
    const tickers = addStocksInput
      .toUpperCase()
      .split(/[,\s\n]+/)
      .map(t => t.trim())
      .filter(t => t.length > 0 && t.length <= 5)
      .filter(t => /^[A-Z]+$/.test(t));
    
    // Remove duplicates and already existing tickers
    const existingTickers = new Set(stocks.map(s => s.ticker));
    const newTickers = [...new Set(tickers)].filter(t => !existingTickers.has(t));
    
    if (newTickers.length === 0) {
      setError('No new valid tickers to add');
      setIsAddingStocks(false);
      return;
    }
    
    setStatus({ type: 'loading', msg: `Adding ${newTickers.length} stocks...` });
    
    const newStocks = [];
    
    for (let i = 0; i < newTickers.length; i++) {
      const ticker = newTickers[i];
      setStatus({ type: 'loading', msg: `Fetching ${ticker}... (${i + 1}/${newTickers.length})` });
      
      try {
        // Get basic stock data from Polygon
        const detailsRes = await fetch(
          `https://api.polygon.io/v3/reference/tickers/${ticker}?apiKey=${POLYGON_KEY}`
        );
        const detailsData = await detailsRes.json();
        const details = detailsData.results;
        
        if (!details) {
          console.warn(`No data found for ${ticker}`);
          continue;
        }
        
        // Get price data
        const priceRes = await fetch(
          `https://api.polygon.io/v2/aggs/ticker/${ticker}/prev?adjusted=true&apiKey=${POLYGON_KEY}`
        );
        const priceData = await priceRes.json();
        const prevDay = priceData.results?.[0];
        
        if (!prevDay) {
          console.warn(`No price data for ${ticker}`);
          continue;
        }
        
        // Get 52-week data
        const weekData = await get52WeekData(ticker);
        let high52 = prevDay.c, low52 = prevDay.c;
        if (weekData.length > 0) {
          high52 = Math.max(...weekData.map(d => d.h));
          low52 = Math.min(...weekData.map(d => d.l));
        }
        
        const currentPrice = prevDay.c;
        const change = prevDay.o > 0 ? ((prevDay.c - prevDay.o) / prevDay.o) * 100 : 0;
        const marketCapM = details.market_cap ? Math.round(details.market_cap / 1000000) : 0;
        const fromLow = low52 > 0 ? ((currentPrice - low52) / low52) * 100 : 0;
        const positionIn52Week = high52 !== low52 ? ((currentPrice - low52) / (high52 - low52)) * 100 : 50;
        
        const stock = {
          id: stocks.length + newStocks.length + 1,
          ticker,
          name: details.name || ticker,
          sector: details.sic_description || 'Unknown',
          price: currentPrice,
          marketCap: marketCapM,
          change,
          high52,
          low52,
          positionIn52Week,
          fromLow,
          rsi: null,
          cash: null,
          debt: null,
          netCash: null,
          hasFinancials: false,
          financialSource: null,
          lastInsiderPurchase: null,
          hasInsiderData: false,
          priceTarget: null,
          agentScores: {
            pricePosition: Math.max(0, 100 - positionIn52Week),
            insiderActivity: 0,
            netCash: 50,
          },
          compositeScore: 0,
          aiAnalysis: null,
          manuallyAdded: true
        };
        
        newStocks.push(stock);
        
        // Small delay to avoid rate limiting
        if (i < newTickers.length - 1) {
          await new Promise(r => setTimeout(r, 200));
        }
      } catch (e) {
        console.error(`Failed to fetch ${ticker}:`, e);
      }
    }
    
    if (newStocks.length > 0) {
      // Recalculate scores for all stocks including new ones
      const allStocks = [...stocks, ...newStocks];
      const scoredStocks = calcScores(allStocks, weights, aiWeights);
      setStocks(scoredStocks);
      setStatus({ type: 'live', msg: `Added ${newStocks.length} stocks • ${scoredStocks.length} total` });
    } else {
      setStatus({ type: 'ready', msg: 'No stocks could be added' });
    }
    
    setAddStocksInput('');
    setShowAddStocks(false);
    setIsAddingStocks(false);
  };

  // Clear specific column data
  const clearColumnData = (columnType) => {
    setStocks(prev => prev.map(s => {
      switch (columnType) {
        case 'conviction':
          return { ...s, aiAnalysis: null, insiderConviction: null };
        case 'upside':
          return { ...s, upsideAnalysis: null, upsidePrediction: null };
        case 'technical':
          return { ...s, technicalAnalysis: null, cupHandleScore: null };
        case 'singularity':
          return { ...s, singularityScore: null, isBank: false, isFood: false, isHealthcare: false, isInsurance: false, isREIT: false };
        case 'all':
          return { 
            ...s, 
            aiAnalysis: null, 
            insiderConviction: null,
            upsideAnalysis: null, 
            upsidePrediction: null,
            technicalAnalysis: null, 
            cupHandleScore: null,
            singularityScore: null,
            isBank: false, 
            isFood: false, 
            isHealthcare: false, 
            isInsurance: false, 
            isREIT: false
          };
        default:
          return s;
      }
    }));
    setShowClearData(false);
    setStatus({ type: 'live', msg: `Cleared ${columnType} data for all stocks` });
  };

  // Batch scan for SINGULARITY SCORE (0-100) and category detection
  const runSingularityScan = async (stocksInOrder) => {
    if (isScanningSupplyChain || stocks.length === 0) return;
    
    setIsScanningSupplyChain(true);
    setError(null);
    
    // Use filtered list if provided, otherwise use all stocks
    const stocksToScan = stocksInOrder || stocks;
    
    const batchSize = singularityBatchSize;
    const totalBatches = Math.ceil(stocksToScan.length / batchSize);
    setSupplyChainProgress({ current: 0, total: stocksToScan.length });
    
    for (let batch = 0; batch < totalBatches; batch++) {
      const startIdx = batch * batchSize;
      const batchStocks = stocksToScan.slice(startIdx, startIdx + batchSize);
      
      setSupplyChainProgress({ current: startIdx, total: stocksToScan.length });
      setStatus({ type: 'loading', msg: `Scanning Singularity relevance... ${startIdx}/${stocksToScan.length}` });
      
      const stockList = batchStocks.map(s => `${s.ticker}: ${s.name} (${s.sector || 'Unknown'})`).join('\n');
      
      const prompt = `Analyze these stocks for SINGULARITY relevance and categorize them.

SINGULARITY SCORE (0-100): How critical is this company to AI, robotics, energy transition?
- COMPUTE: Chips, GPUs, AI accelerators, lithography, chip packaging, photonics, quantum
- POWER: Data centers, cooling, nuclear, transformers, batteries, grid equipment
- ROBOTICS: Actuators, motors, sensors, lidar, rare earth magnets, humanoid components

CATEGORY DETECTION - Mark TRUE if the company is primarily in these sectors:
- isBank: Banks, financial services, credit cards, payment processing, lending
- isFood: Food production, restaurants, grocery, beverages, consumer packaged goods
- isHealthcare: Pharmaceuticals, biotech, hospitals, medical devices, health insurance
- isInsurance: Insurance companies (life, property, auto, reinsurance)
- isREIT: Real estate investment trusts, property management

STOCKS:
${stockList}

Respond with ONLY a JSON array:
[{"ticker":"ABC","singularity":85,"isBank":false,"isFood":false,"isHealthcare":false,"isInsurance":false,"isREIT":false}]`;

      try {
        const response = await fetch("/api/grok", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, model: grokModel })
        });
        
        if (response.ok) {
          const data = await response.json();
          let scores = [];
          try {
            const jsonMatch = data.analysis.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
              scores = JSON.parse(jsonMatch[0]);
            }
          } catch (e) {
            console.warn('Failed to parse Singularity response:', e);
          }
          
          // Update stocks with Singularity score and categories using functional update
          if (scores.length > 0) {
            setStocks(prev => prev.map(s => {
              const scoreData = scores.find(item => item.ticker === s.ticker);
              if (scoreData) {
                return {
                  ...s,
                  singularityScore: Math.min(100, Math.max(0, scoreData.singularity || 0)),
                  isBank: scoreData.isBank || false,
                  isFood: scoreData.isFood || false,
                  isHealthcare: scoreData.isHealthcare || false,
                  isInsurance: scoreData.isInsurance || false,
                  isREIT: scoreData.isREIT || false
                };
              }
              return s;
            }));
          }
        }
      } catch (e) {
        console.error('Singularity scan batch failed:', e);
      }
      
      if (batch < totalBatches - 1) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }
    
    // Recalculate scores using functional update
    setStocks(prev => calcScores(prev, weights, aiWeights));
    
    // Save to session
    setStocks(prev => {
      const scanStats = { phase: 'complete', current: scanProgress.total, total: scanProgress.total, found: prev.length };
      if (currentSessionId) {
        saveSession(currentSessionId, prev, scanStats);
        setSessions(getAllSessions());
      }
      return prev;
    });
    
    setIsScanningSupplyChain(false);
    setSupplyChainProgress({ current: 0, total: 0 });
    setStatus({ type: 'live', msg: `${stocks.length} stocks • Singularity scan complete` });
  };

  // Run Oracle Analysis on filtered stocks
  const runOracleAnalysis = async (stockList) => {
    if (isRunningOracle || !stockList || stockList.length === 0) return;
    
    setIsRunningOracle(true);
    setError(null);
    
    setOracleProgress({ current: 0, total: stockList.length });
    
    let updatedStocks = [...stocks];
    
    for (let i = 0; i < stockList.length; i++) {
      setOracleProgress({ current: i + 1, total: stockList.length });
      setStatus({ type: 'loading', msg: `Oracle analyzing ${stockList[i].ticker} (${i + 1}/${stockList.length})...` });
      
      const result = await getOracleAnalysis(stockList[i]);
      
      updatedStocks = updatedStocks.map(s => 
        s.ticker === stockList[i].ticker ? { 
          ...s, 
          oracleAnalysis: result.oracleAnalysis,
          prediction: result.prediction,
          oracleConviction: result.oracleConviction,
          targetTimeframe: result.targetTimeframe,
          tenXThesis: result.tenXThesis
        } : s
      );
      setStocks(updatedStocks);
      
      if (i < stockList.length - 1) {
        await new Promise(r => setTimeout(r, 2500));
      }
    }
    
    // Recalculate scores
    const reScored = calcScores(updatedStocks, weights, aiWeights);
    setStocks(reScored);
    
    // Save to session
    const scanStats = { phase: 'complete', current: scanProgress.total, total: scanProgress.total, found: reScored.length };
    if (currentSessionId) {
      saveSession(currentSessionId, reScored, scanStats);
      setSessions(getAllSessions());
    }
    
    setIsRunningOracle(false);
    setOracleProgress({ current: 0, total: 0 });
    setStatus({ type: 'live', msg: `${stockList.length} stocks • Oracle analysis complete` });
  };

  const runBaseScan = async () => {
    if (isScanning) return;
    
    if (!POLYGON_KEY) {
      setError('Polygon API key not configured. Add NEXT_PUBLIC_POLYGON_KEY to Vercel environment variables.');
      return;
    }

    // Start new session
    const newSessionId = generateSessionId();
    setCurrentSessionId(newSessionId);
    
    setIsScanning(true);
    setError(null);
    setStocks([]);
    const startTime = Date.now();

    try {
      const limitText = stockLimit === 0 ? 'all' : stockLimit;
      setStatus({ type: 'loading', msg: `Fetching ${limitText} stocks...` });
      setScanProgress({ phase: 'Loading tickers...', current: 0, total: 0, found: 0 });
      setDiscoveryStatus(p => ({ ...p, polygonScreener: 'running' }));
      
      const allTickers = await getFilteredTickers(stockLimit);
      setDiscoveryStatus(p => ({ ...p, polygonScreener: 'complete', marketCapFilter: 'running' }));
      
      setScanProgress({ phase: 'Filtering by market cap...', current: 0, total: allTickers.length, found: 0 });

      const qualifiedTickers = [];
      
      // Use global settings for market cap or defaults
      const minMC = globalSettings.useCustomMarketCap ? globalSettings.minMarketCap * 1_000_000 : MIN_MARKET_CAP;
      const maxMC = globalSettings.useCustomMarketCap ? globalSettings.maxMarketCap * 1_000_000 : MAX_MARKET_CAP;
      
      for (let i = 0; i < allTickers.length; i++) {
        const t = allTickers[i];
        const details = await getTickerDetails(t.ticker);
        
        if (details?.market_cap && details.market_cap >= minMC && details.market_cap <= maxMC) {
          qualifiedTickers.push({ ticker: t.ticker, details });
          setScanProgress(p => ({ ...p, found: qualifiedTickers.length }));
        }
        
        setScanProgress(p => ({ ...p, current: i + 1 }));
        
        if (i % 20 === 0) {
          setStatus({ type: 'loading', msg: `Market cap filter: ${i}/${allTickers.length} (${qualifiedTickers.length} qualify)` });
        }
        
        await new Promise(r => setTimeout(r, 220));
      }

      setDiscoveryStatus(p => ({ ...p, marketCapFilter: 'complete', technicalScanner: 'running', insiderScanner: 'running', financialScanner: 'running', optionsScanner: 'running' }));
      
      setScanProgress({ phase: 'Fetching detailed data...', current: 0, total: qualifiedTickers.length, found: qualifiedTickers.length });
      
      const processedStocks = [];
      
      for (let i = 0; i < qualifiedTickers.length; i++) {
        const { ticker, details } = qualifiedTickers[i];
        
        const [prevDay, historicalData, financials, insiderData, optionsData] = await Promise.all([
          getPrevDay(ticker),
          get52WeekData(ticker),
          getFinancials(ticker),
          getInsiderTransactions(ticker),
          getOptionsSentiment(ticker),
        ]);
        
        if (prevDay && historicalData.length > 20) {
          const processed = processStock(ticker, details, prevDay, historicalData, financials, insiderData, processedStocks.length);
          // Add options data
          processed.swingTradeScore = optionsData?.swingTradeScore || 0;
          processed.putCallRatio = optionsData?.putCallRatio;
          processed.optionsVolume = optionsData?.optionsVolume || 0;
          processed.openInterest = optionsData?.openInterest || 0;
          processed.ivRank = optionsData?.ivRank;
          
          processedStocks.push(processed);
          
          if (processedStocks.length % 5 === 0) {
            setStocks(calcScores([...processedStocks], weights, aiWeights));
          }
        }
        
        setScanProgress(p => ({ ...p, current: i + 1, phase: `Analyzing ${ticker}...` }));
        
        if (i % 5 === 0) {
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          setStatus({ type: 'loading', msg: `${processedStocks.length} stocks analyzed (${elapsed}s)` });
        }
        
        await new Promise(r => setTimeout(r, 450));
      }

      const scoredStocks = calcScores(processedStocks, weights, aiWeights);
      setStocks(scoredStocks);

      setDiscoveryStatus(p => ({ ...p, technicalScanner: 'complete', insiderScanner: 'complete', financialScanner: 'complete' }));
      
      for (const a of analysisAgents) {
        setAnalysisStatus(p => ({ ...p, [a.id]: 'complete' }));
      }

      const scanStats = { phase: 'complete', current: allTickers.length, total: allTickers.length, found: scoredStocks.length };
      
      // Save to session
      const sessionName = `${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()} (${scoredStocks.length} stocks)`;
      saveSession(newSessionId, scoredStocks, scanStats, sessionName);
      setSessions(getAllSessions());
      
      setLastUpdate(new Date());
      setCacheAge(0);
      
      const totalTime = Math.round((Date.now() - startTime) / 1000);
      setStatus({ type: 'live', msg: `${scoredStocks.length} small-caps found (${totalTime}s)` });
      setScanProgress(scanStats);

    } catch (err) {
      console.error('Scan error:', err);
      setError(`Scan failed: ${err.message}`);
      setStatus({ type: 'error', msg: 'Scan failed' });
    }

    setIsScanning(false);
    setTimeout(() => {
      setDiscoveryStatus(Object.fromEntries(discoveryAgents.map(a => [a.id, 'idle'])));
      setAnalysisStatus(Object.fromEntries(analysisAgents.map(a => [a.id, 'idle'])));
    }, 3000);
  };

  // Full Spectrum Scan - runs all scans in sequence
  const runFullSpectrumScan = async () => {
    if (isScanning || isAnalyzingAI || isScanningSupplyChain) return;
    
    setShowFullSpectrumModal(false);
    setIsRunningFullSpectrum(true);
    
    try {
      // Phase 1: Base Scan
      setFullSpectrumPhase('Running Base Scan...');
      const originalStockLimit = stockLimit;
      setStockLimit(spectrumSettings.baseStockLimit);
      
      // Start new session
      const newSessionId = generateSessionId();
      setCurrentSessionId(newSessionId);
      setIsScanning(true);
      setError(null);
      setStocks([]);
      const startTime = Date.now();

      const limitText = spectrumSettings.baseStockLimit === 0 ? 'all' : spectrumSettings.baseStockLimit;
      setStatus({ type: 'loading', msg: `Full Spectrum: Fetching ${limitText} stocks...` });
      setScanProgress({ phase: 'Loading tickers...', current: 0, total: 0, found: 0 });
      setDiscoveryStatus(p => ({ ...p, polygonScreener: 'running' }));
      
      const allTickers = await getFilteredTickers(spectrumSettings.baseStockLimit);
      setDiscoveryStatus(p => ({ ...p, polygonScreener: 'complete', marketCapFilter: 'running' }));
      
      setScanProgress({ phase: 'Filtering by market cap...', current: 0, total: allTickers.length, found: 0 });

      const qualifiedTickers = [];
      const batchSize = 50;
      
      // Use global settings for market cap or defaults
      const minMC = globalSettings.useCustomMarketCap ? globalSettings.minMarketCap * 1_000_000 : MIN_MARKET_CAP;
      const maxMC = globalSettings.useCustomMarketCap ? globalSettings.maxMarketCap * 1_000_000 : MAX_MARKET_CAP;
      
      for (let i = 0; i < allTickers.length; i += batchSize) {
        const batch = allTickers.slice(i, i + batchSize);
        
        const batchPromises = batch.map(async (tickerData) => {
          const ticker = tickerData.ticker;
          const details = await getTickerDetails(ticker);
          if (!details?.market_cap) return null;
          if (details.market_cap < minMC || details.market_cap > maxMC) return null;
          return { ticker, details };
        });
        
        const results = await Promise.all(batchPromises);
        const validResults = results.filter(r => r !== null);
        qualifiedTickers.push(...validResults);
        
        setScanProgress(p => ({ ...p, current: Math.min(i + batchSize, allTickers.length), found: qualifiedTickers.length }));
        await new Promise(r => setTimeout(r, 220));
      }

      setDiscoveryStatus(p => ({ ...p, marketCapFilter: 'complete', technicalScanner: 'running' }));
      setScanProgress({ phase: 'Analyzing qualified stocks...', current: 0, total: qualifiedTickers.length, found: qualifiedTickers.length });

      const processedStocks = [];
      for (let i = 0; i < qualifiedTickers.length; i++) {
        const { ticker, details } = qualifiedTickers[i];
        
        const [prevDay, historicalData, financials, insiderData] = await Promise.all([
          getPrevDay(ticker),
          get52WeekData(ticker),
          getFinancials(ticker),
          getInsiderTransactions(ticker),
        ]);

        if (prevDay && historicalData.length > 20) {
          const stock = processStock(ticker, details, prevDay, historicalData, financials, insiderData, processedStocks.length);
          processedStocks.push(stock);
        }

        if (i % 10 === 0) {
          setScanProgress(p => ({ ...p, current: i, found: processedStocks.length }));
          setStocks(calcScores([...processedStocks], weights, aiWeights));
        }
        await new Promise(r => setTimeout(r, 220));
      }

      setDiscoveryStatus(p => ({ ...p, technicalScanner: 'complete', insiderScanner: 'complete', financialScanner: 'complete' }));
      const scoredStocks = calcScores(processedStocks, weights, aiWeights);
      setStocks(scoredStocks);
      
      for (const a of analysisAgents) {
        setAnalysisStatus(p => ({ ...p, [a.id]: 'complete' }));
      }

      let currentStocks = scoredStocks;
      const scanStats = { phase: 'complete', current: allTickers.length, total: allTickers.length, found: scoredStocks.length };
      
      setIsScanning(false);
      
      // Phase 2: Singularity Scan
      if (spectrumSettings.singularityEnabled && currentStocks.length > 0) {
        setFullSpectrumPhase('Running Singularity Scan...');
        setIsScanningSupplyChain(true);
        
        const batchSize = singularityBatchSize;
        const totalBatches = Math.ceil(currentStocks.length / batchSize);
        setSupplyChainProgress({ current: 0, total: currentStocks.length });
        
        let updatedStocks = [...currentStocks];
        
        for (let batch = 0; batch < totalBatches; batch++) {
          const startIdx = batch * batchSize;
          const batchStocks = updatedStocks.slice(startIdx, startIdx + batchSize);
          
          setSupplyChainProgress({ current: startIdx, total: currentStocks.length });
          setStatus({ type: 'loading', msg: `Full Spectrum: Singularity scan... ${startIdx + batchStocks.length}/${currentStocks.length}` });
          
          const stockList = batchStocks.map(s => `${s.ticker}: ${s.name} (${s.sector || 'Unknown'})`).join('\n');
          
          const prompt = `Analyze these stocks for SINGULARITY relevance and categorize them.

SINGULARITY SCORE (0-100): How critical is this company to AI, robotics, energy transition?
- COMPUTE: Chips, GPUs, AI accelerators, lithography, chip packaging, photonics, quantum
- POWER: Data centers, cooling, nuclear, transformers, batteries, grid equipment
- ROBOTICS: Actuators, motors, sensors, lidar, rare earth magnets, humanoid components

CATEGORY DETECTION - Mark TRUE if the company is primarily in these sectors:
- isBank: Banks, financial services, credit cards, payment processing, lending
- isFood: Food production, restaurants, grocery, beverages, consumer packaged goods
- isHealthcare: Pharmaceuticals, biotech, hospitals, medical devices, health insurance
- isInsurance: Insurance companies (life, property, auto, reinsurance)
- isREIT: Real estate investment trusts, property management

STOCKS:
${stockList}

Respond with ONLY a JSON array:
[{"ticker":"ABC","singularity":85,"isBank":false,"isFood":false,"isHealthcare":false,"isInsurance":false,"isREIT":false}]`;

          try {
            console.log(`Singularity batch ${batch + 1}/${totalBatches} - analyzing ${batchStocks.length} stocks`);
            
            const response = await fetch("/api/grok", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ prompt, model: grokModel })
            });
            
            if (response.ok) {
              const data = await response.json();
              console.log('Singularity response:', data.analysis?.substring(0, 200));
              
              let scores = [];
              try {
                const jsonMatch = data.analysis.match(/\[[\s\S]*?\]/);
                if (jsonMatch) {
                  scores = JSON.parse(jsonMatch[0]);
                  console.log(`Parsed ${scores.length} singularity scores`);
                }
              } catch (e) {
                console.warn('Failed to parse singularity response:', e, data.analysis?.substring(0, 500));
              }
              
              if (scores.length > 0) {
                scores.forEach(item => {
                  updatedStocks = updatedStocks.map(s => 
                    s.ticker === item.ticker ? {
                      ...s,
                      singularityScore: Math.min(100, Math.max(0, item.singularity || 0)),
                      isBank: item.isBank || false,
                      isFood: item.isFood || false,
                      isHealthcare: item.isHealthcare || false,
                      isInsurance: item.isInsurance || false,
                      isREIT: item.isREIT || false
                    } : s
                  );
                });
                
                // Use functional update to preserve other parallel scan results
                setStocks(prev => prev.map(s => {
                  const updated = updatedStocks.find(u => u.ticker === s.ticker);
                  if (updated && updated.singularityScore !== undefined) {
                    return {
                      ...s,
                      singularityScore: updated.singularityScore,
                      isBank: updated.isBank,
                      isFood: updated.isFood,
                      isHealthcare: updated.isHealthcare,
                      isInsurance: updated.isInsurance,
                      isREIT: updated.isREIT
                    };
                  }
                  return s;
                }));
              }
            } else {
              console.error('Singularity API error:', response.status);
            }
          } catch (e) {
            console.error('Singularity scan batch failed:', e);
          }
          
          if (batch < totalBatches - 1) {
            await new Promise(r => setTimeout(r, 1500));
          }
        }
        
        currentStocks = [...updatedStocks];
        setIsScanningSupplyChain(false);
        setSupplyChainProgress({ current: 0, total: 0 });
        console.log(`Singularity scan complete. Stocks with scores: ${currentStocks.filter(s => s.singularityScore).length}`);
      }
      
      // Phase 3: Grok AI Analysis
      console.log('Phase 3 check - grokEnabled:', spectrumSettings.grokEnabled, 'stocks:', currentStocks.length);
      if (spectrumSettings.grokEnabled && currentStocks.length > 0) {
        setFullSpectrumPhase('Running Grok AI Analysis...');
        setIsAnalyzingAI(true);
        
        // Filter to only singularity 70+ if option enabled
        let stocksPool = [...currentStocks];
        console.log('grokOnlySingularity70:', spectrumSettings.grokOnlySingularity70);
        if (spectrumSettings.grokOnlySingularity70) {
          stocksPool = currentStocks.filter(s => (s.singularityScore || 0) >= 70);
          console.log(`Filtering to singularity 70+: ${stocksPool.length} stocks qualify`);
        }
        
        if (stocksPool.length === 0) {
          console.log('No stocks qualify for Grok analysis');
          setIsAnalyzingAI(false);
        } else {
          // grokCount of 0 means "all stocks"
          const countToAnalyze = spectrumSettings.grokCount === 0 
            ? stocksPool.length 
            : Math.min(spectrumSettings.grokCount, stocksPool.length);
          const stocksToAnalyze = stocksPool.slice(0, countToAnalyze);
          setAiProgress({ current: 0, total: stocksToAnalyze.length });
          console.log(`Grok will analyze ${stocksToAnalyze.length} stocks:`, stocksToAnalyze.map(s => s.ticker));
          
          let updatedStocks = [...currentStocks];
        
          for (let i = 0; i < stocksToAnalyze.length; i++) {
            setAiProgress({ current: i + 1, total: stocksToAnalyze.length });
            setStatus({ type: 'loading', msg: `Full Spectrum: Grok analyzing ${stocksToAnalyze[i].ticker} (${i + 1}/${stocksToAnalyze.length})...` });
            
            console.log(`Calling getAIAnalysis for ${stocksToAnalyze[i].ticker}...`);
            const result = await getAIAnalysis(stocksToAnalyze[i], grokModel);
            console.log(`Grok result for ${stocksToAnalyze[i].ticker}:`, result);
            
            updatedStocks = updatedStocks.map(s => 
              s.ticker === stocksToAnalyze[i].ticker ? { 
                ...s, 
                aiAnalysis: result.analysis,
                insiderConviction: result.insiderConviction,
                upsidePct: result.upsidePct,
                cupHandleScore: result.cupHandleScore
              } : s
            );
            setStocks(updatedStocks);
            
            if (i < stocksToAnalyze.length - 1) {
              await new Promise(r => setTimeout(r, 2000));
            }
          }
          
          const reScored = calcScores(updatedStocks, weights, aiWeights);
          setStocks(reScored);
          currentStocks = reScored;
          
          setIsAnalyzingAI(false);
          setAiProgress({ current: 0, total: 0 });
        }
      } else {
        console.log('Skipping Grok analysis - grokEnabled:', spectrumSettings.grokEnabled, 'stocks:', currentStocks.length);
      }
      
      // Save final session
      const finalScanStats = { phase: 'complete', current: allTickers.length, total: allTickers.length, found: currentStocks.length };
      const sessionName = `Full Spectrum ${new Date().toLocaleDateString()} (${currentStocks.length} stocks)`;
      saveSession(newSessionId, currentStocks, finalScanStats, sessionName);
      setSessions(getAllSessions());
      
      setLastUpdate(new Date());
      setCacheAge(0);
      
      const totalTime = Math.round((Date.now() - startTime) / 1000);
      setStatus({ type: 'live', msg: `Full Spectrum complete: ${currentStocks.length} stocks (${totalTime}s)` });
      
    } catch (err) {
      console.error('Full spectrum scan error:', err);
      setError(`Full spectrum scan failed: ${err.message}`);
      setStatus({ type: 'error', msg: 'Scan failed' });
    }
    
    setIsRunningFullSpectrum(false);
    setFullSpectrumPhase('');
    setTimeout(() => {
      setDiscoveryStatus(Object.fromEntries(discoveryAgents.map(a => [a.id, 'idle'])));
      setAnalysisStatus(Object.fromEntries(analysisAgents.map(a => [a.id, 'idle'])));
    }, 3000);
  };
  
  // Load a previous session
  const loadPreviousSession = (sessionId) => {
    const session = loadSession(sessionId);
    if (session && session.stocks?.length > 0) {
      const scored = calcScores(session.stocks, weights, aiWeights);
      setStocks(scored);
      setCurrentSessionId(session.id);
      setLastUpdate(new Date(session.timestamp));
      setCacheAge(Date.now() - session.timestamp);
      setStatus({ type: 'cached', msg: `${session.stocks.length} stocks (${session.name})` });
      setScanProgress(session.scanStats || { phase: 'complete', current: 0, total: 0, found: session.stocks.length });
      setShowSessions(false);
      localStorage.setItem('singularityhunter_current_session', sessionId);
    }
  };

  const handleWeight = (id, val) => {
    const w = { ...weights, [id]: val };
    setWeights(w);
    setStocks(p => calcScores(p, w, aiWeights));
  };

  const sorted = [...stocks]
    .filter(s => matchesCategory(s, sectorFilter))
    .filter(s => !filters.hideNetCashNegative || (s.netCash !== null && s.netCash >= 0))
    .filter(s => (s.singularityScore || 0) >= filters.minSingularityScore)
    .filter(s => !filters.excludeBanks || !s.isBank)
    .filter(s => !filters.excludeFood || !s.isFood)
    .filter(s => !filters.excludeHealthcare || !s.isHealthcare)
    .filter(s => !filters.excludeInsurance || !s.isInsurance)
    .filter(s => !filters.excludeREIT || !s.isREIT)
    .sort((a, b) => {
      if (sortBy === 'compositeScore') return b.compositeScore - a.compositeScore;
      if (sortBy === 'netCash') return (b.netCash || 0) - (a.netCash || 0);
      if (sortBy === 'insiderDate') {
        const dateA = a.lastInsiderPurchase?.date ? new Date(a.lastInsiderPurchase.date).getTime() : 0;
        const dateB = b.lastInsiderPurchase?.date ? new Date(b.lastInsiderPurchase.date).getTime() : 0;
        return dateB - dateA;
      }
      if (sortBy === 'upsidePct') {
        const upsideA = a.upsidePct ?? -999;
        const upsideB = b.upsidePct ?? -999;
        return upsideB - upsideA;
      }
      if (sortBy === 'insiderConviction') {
        const convA = a.insiderConviction ?? -1;
        const convB = b.insiderConviction ?? -1;
        return convB - convA;
      }
      if (sortBy === 'cupHandleScore') {
        const chA = a.cupHandleScore ?? -1;
        const chB = b.cupHandleScore ?? -1;
        return chB - chA;
      }
      if (sortBy === 'singularityScore') {
        return (b.singularityScore ?? -1) - (a.singularityScore ?? -1);
      }
      if (sortBy === 'upsidePrediction') {
        return (b.upsidePrediction ?? -999) - (a.upsidePrediction ?? -999);
      }
      if (sortBy === 'extendedChange') {
        const extA = a.preMarketChange ?? a.afterHoursChange ?? -999;
        const extB = b.preMarketChange ?? b.afterHoursChange ?? -999;
        return extB - extA;
      }
      if (sortBy === 'afterHoursChange') {
        return (b.afterHoursChange ?? -999) - (a.afterHoursChange ?? -999);
      }
      return (b.agentScores?.[sortBy] || 0) - (a.agentScores?.[sortBy] || 0);
    });

  // Helper to get max singularity score
  const getMaxSingularity = (stock) => {
    const scores = stock.singularityScores || {};
    return Math.max(scores.compute || 0, scores.energy || 0, scores.robotics || 0, scores.agi_interface || 0);
  };

  const stocksWithSingularity = stocks.filter(s => getMaxSingularity(s) >= 7).length;
  const stocksWithOracle = stocks.filter(s => s.prediction).length;

  const StatusIcon = ({ s }) => {
    if (s === 'running') return <RefreshCw className="w-4 h-4 text-amber-400 animate-spin" />;
    if (s === 'complete') return <CheckCircle className="w-4 h-4 text-emerald-400" />;
    return <Clock className="w-4 h-4 text-slate-500" />;
  };

  const NetCashBadge = ({ amount, hasData }) => {
    if (!hasData) {
      return <span className="text-xs text-slate-500 italic">—</span>;
    }
    const isPositive = amount >= 0;
    return (
      <span className="text-xs font-mono font-medium" style={{ color: isPositive ? '#34d399' : '#f87171' }}>
        {formatMoney(amount)}
      </span>
    );
  };

  const InsiderBadge = ({ data }) => {
    if (!data?.date) {
      return <span className="text-xs text-slate-500">—</span>;
    }
    const daysSince = Math.floor((Date.now() - new Date(data.date)) / (1000 * 60 * 60 * 24));
    const isRecent = daysSince < 90;
    return (
      <div className="text-xs">
        <div style={{ color: isRecent ? '#34d399' : '#94a3b8' }}>{formatDate(data.date)}</div>
        <div className="text-slate-400 font-mono">{formatMoney(data.amount)}</div>
      </div>
    );
  };

  const progressPct = scanProgress.total > 0 ? (scanProgress.current / scanProgress.total) * 100 : 0;
  const stocksWithAI = stocks.filter(s => s.aiAnalysis).length;

  return (
    <div className="min-h-screen text-slate-100" style={{ fontFamily: "system-ui, sans-serif", background: '#0a0e17' }}>
      <style>{`.mono{font-family:monospace}.card{background:rgba(15,23,42,0.8);backdrop-filter:blur(10px)}.row:hover{background:rgba(99,102,241,0.05)}`}</style>

      <header className="border-b border-slate-800/50 sticky top-0 z-50" style={{ background: 'rgba(10,14,23,0.95)', backdropFilter: 'blur(12px)' }}>
        <div className="max-w-[1800px] mx-auto px-6 py-4 flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #f59e0b, #ef4444)' }}><Atom className="w-6 h-6 text-white" /></div>
            <div>
              <h1 className="text-2xl font-bold"><span style={{ background: 'linear-gradient(90deg, #f59e0b, #ef4444)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>SingularityHunter</span></h1>
              <p className="text-xs text-slate-500">Hidden Suppliers to AGI • Robotics • Infinite Energy</p>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border" style={{ 
              background: status.type === 'live' ? 'rgba(16,185,129,0.1)' : 'rgba(99,102,241,0.1)', 
              borderColor: status.type === 'live' ? 'rgba(16,185,129,0.3)' : 'rgba(99,102,241,0.3)', 
              color: status.type === 'live' ? '#34d399' : '#a5b4fc' 
            }}>
              {(status.type === 'loading' || isAnalyzingAI || isRunningFullSpectrum || isRunningOracle) ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Database className="w-3.5 h-3.5" />}
              <span>{fullSpectrumPhase || status.msg}</span>
              {cacheAge && status.type === 'cached' && <span className="text-slate-500">• {formatCacheAge(cacheAge)}</span>}
            </div>
            
            {/* Sessions Button */}
            <button onClick={() => setShowSessions(!showSessions)} className="px-4 py-2.5 rounded-xl text-sm font-medium border flex items-center gap-2" style={{ background: showSessions ? 'rgba(139,92,246,0.2)' : 'rgba(30,41,59,0.5)', borderColor: 'rgba(51,65,85,0.5)', color: showSessions ? '#a78bfa' : '#94a3b8' }}><Clock className="w-4 h-4" />Sessions ({sessions.length})</button>
            
            <button onClick={() => setShowDiscovery(!showDiscovery)} className="px-4 py-2.5 rounded-xl text-sm font-medium border flex items-center gap-2" style={{ background: showDiscovery ? 'rgba(16,185,129,0.2)' : 'rgba(30,41,59,0.5)', borderColor: 'rgba(51,65,85,0.5)', color: showDiscovery ? '#6ee7b7' : '#94a3b8' }}><Radar className="w-4 h-4" />Discovery</button>
            <button onClick={() => setShowWeights(!showWeights)} className="px-4 py-2.5 rounded-xl text-sm font-medium border flex items-center gap-2" style={{ background: showWeights ? 'rgba(245,158,11,0.2)' : 'rgba(30,41,59,0.5)', borderColor: 'rgba(51,65,85,0.5)', color: showWeights ? '#fcd34d' : '#94a3b8' }}><Sliders className="w-4 h-4" />Weights</button>
            <button onClick={() => setShowSettings(!showSettings)} className="px-4 py-2.5 rounded-xl text-sm font-medium border flex items-center gap-2" style={{ background: showSettings ? 'rgba(236,72,153,0.2)' : 'rgba(30,41,59,0.5)', borderColor: 'rgba(51,65,85,0.5)', color: showSettings ? '#f472b6' : '#94a3b8' }}><Sliders className="w-4 h-4" />Settings</button>
            
            {stocks.length > 0 && (
              <>
                {/* Grok AI Button - Conviction Focus */}
                <button 
                  onClick={() => {
                    const currentView = [...stocks]
                      .filter(s => matchesCategory(s, sectorFilter))
                      .filter(s => !filters.hideNetCashNegative || (s.netCash !== null && s.netCash >= 0))
                      .filter(s => (s.singularityScore || 0) >= filters.minSingularityScore)
                      .filter(s => !filters.excludeBanks || !s.isBank)
                      .filter(s => !filters.excludeFood || !s.isFood)
                      .filter(s => !filters.excludeHealthcare || !s.isHealthcare)
                      .filter(s => !filters.excludeInsurance || !s.isInsurance)
                      .filter(s => !filters.excludeREIT || !s.isREIT)
                      .sort((a, b) => b.compositeScore - a.compositeScore);
                    runGrokAnalysis(currentView);
                  }} 
                  disabled={isScanning}
                  className="px-4 py-2.5 rounded-xl text-sm font-medium border flex items-center gap-2"
                  style={{ 
                    background: isAnalyzingAI ? 'rgba(16,185,129,0.3)' : 'rgba(16,185,129,0.1)', 
                    borderColor: 'rgba(16,185,129,0.3)', 
                    color: '#34d399',
                    opacity: isScanning ? 0.5 : 1
                  }}
                >
                  {isAnalyzingAI ? (
                    <><RefreshCw className="w-4 h-4 animate-spin" />Conv {aiProgress.current}/{aiProgress.total}...</>
                  ) : (
                    <><Sparkles className="w-4 h-4" />Conviction</>
                  )}
                </button>
                
                {/* Technical Analysis Button - Cup & Handle */}
                <button 
                  onClick={() => {
                    const currentView = [...stocks]
                      .filter(s => matchesCategory(s, sectorFilter))
                      .filter(s => !filters.hideNetCashNegative || (s.netCash !== null && s.netCash >= 0))
                      .filter(s => (s.singularityScore || 0) >= filters.minSingularityScore)
                      .filter(s => !filters.excludeBanks || !s.isBank)
                      .filter(s => !filters.excludeFood || !s.isFood)
                      .filter(s => !filters.excludeHealthcare || !s.isHealthcare)
                      .filter(s => !filters.excludeInsurance || !s.isInsurance)
                      .filter(s => !filters.excludeREIT || !s.isREIT)
                      .sort((a, b) => b.compositeScore - a.compositeScore);
                    runTechnicalAnalysis(currentView);
                  }} 
                  disabled={isScanning}
                  className="px-4 py-2.5 rounded-xl text-sm font-medium border flex items-center gap-2"
                  style={{ 
                    background: isAnalyzingTechnical ? 'rgba(99,102,241,0.3)' : 'rgba(99,102,241,0.1)', 
                    borderColor: 'rgba(99,102,241,0.3)', 
                    color: '#a5b4fc',
                    opacity: isScanning ? 0.5 : 1
                  }}
                >
                  {isAnalyzingTechnical ? (
                    <><RefreshCw className="w-4 h-4 animate-spin" />C&H {technicalProgress.current}/{technicalProgress.total}...</>
                  ) : (
                    <><Activity className="w-4 h-4" />Technical</>
                  )}
                </button>
                
                {/* Upside Scan Button */}
                <button 
                  onClick={() => {
                    const currentView = [...stocks]
                      .filter(s => matchesCategory(s, sectorFilter))
                      .filter(s => !filters.hideNetCashNegative || (s.netCash !== null && s.netCash >= 0))
                      .filter(s => (s.singularityScore || 0) >= filters.minSingularityScore)
                      .filter(s => !filters.excludeBanks || !s.isBank)
                      .filter(s => !filters.excludeFood || !s.isFood)
                      .filter(s => !filters.excludeHealthcare || !s.isHealthcare)
                      .filter(s => !filters.excludeInsurance || !s.isInsurance)
                      .filter(s => !filters.excludeREIT || !s.isREIT)
                      .sort((a, b) => b.compositeScore - a.compositeScore);
                    runUpsideAnalysis(currentView);
                  }} 
                  disabled={isScanning}
                  className="px-4 py-2.5 rounded-xl text-sm font-medium border flex items-center gap-2"
                  style={{ 
                    background: isAnalyzingUpside ? 'rgba(236,72,153,0.3)' : 'rgba(236,72,153,0.1)', 
                    borderColor: 'rgba(236,72,153,0.3)', 
                    color: '#f472b6',
                    opacity: isScanning ? 0.5 : 1
                  }}
                >
                  {isAnalyzingUpside ? (
                    <><RefreshCw className="w-4 h-4 animate-spin" />Upside {upsideProgress.current}/{upsideProgress.total}...</>
                  ) : (
                    <><TrendingUp className="w-4 h-4" />Upside 8mo</>
                  )}
                </button>
                
                {/* Extended Hours Button */}
                <button 
                  onClick={refreshPremarketData} 
                  disabled={isRefreshingPremarket || isScanning}
                  className="px-4 py-2.5 rounded-xl text-sm font-medium border flex items-center gap-2"
                  style={{ 
                    background: isRefreshingPremarket ? 'rgba(34,211,238,0.3)' : 'rgba(34,211,238,0.1)', 
                    borderColor: 'rgba(34,211,238,0.3)', 
                    color: '#22d3ee',
                    opacity: (isRefreshingPremarket || isScanning) ? 0.7 : 1
                  }}
                  title="Get Pre-Market or After-Hours data"
                >
                  {isRefreshingPremarket ? (
                    <><RefreshCw className="w-4 h-4 animate-spin" />Extended...</>
                  ) : (
                    <><Clock className="w-4 h-4" />Extended</>
                  )}
                </button>
                
                {/* Supply Chain Scan Button */}
                <button 
                  onClick={() => {
                    const currentView = [...stocks]
                      .filter(s => matchesCategory(s, sectorFilter))
                      .filter(s => !filters.hideNetCashNegative || (s.netCash !== null && s.netCash >= 0))
                      .filter(s => (s.singularityScore || 0) >= filters.minSingularityScore)
                      .filter(s => !filters.excludeBanks || !s.isBank)
                      .filter(s => !filters.excludeFood || !s.isFood)
                      .filter(s => !filters.excludeHealthcare || !s.isHealthcare)
                      .filter(s => !filters.excludeInsurance || !s.isInsurance)
                      .filter(s => !filters.excludeREIT || !s.isREIT)
                      .sort((a, b) => b.compositeScore - a.compositeScore);
                    runSingularityScan(currentView);
                  }}
                  disabled={isScanning}
                  className="px-4 py-2.5 rounded-xl text-sm font-medium border flex items-center gap-2"
                  style={{ 
                    background: isScanningSupplyChain ? 'rgba(245,158,11,0.3)' : 'rgba(245,158,11,0.1)', 
                    borderColor: 'rgba(245,158,11,0.3)', 
                    color: '#fbbf24',
                    opacity: isScanning ? 0.5 : 1
                  }}
                >
                  {isScanningSupplyChain ? (
                    <><RefreshCw className="w-4 h-4 animate-spin" />Scanning {supplyChainProgress.current}/{supplyChainProgress.total}...</>
                  ) : (
                    <><Zap className="w-4 h-4" />Singularity Scan</>
                  )}
                </button>
              </>
            )}
            
            {/* Stock Limit Selector */}
            <select 
              value={stockLimit} 
              onChange={e => setStockLimit(parseInt(e.target.value))}
              className="rounded-lg px-2 py-2 text-sm border outline-none"
              style={{ background: 'rgba(30,41,59,0.5)', borderColor: 'rgba(99,102,241,0.3)', color: '#a5b4fc', width: '100px' }}
              disabled={isScanning || isAnalyzingAI || isRunningFullSpectrum}
            >
              <option value={100}>100 stocks</option>
              <option value={500}>500 stocks</option>
              <option value={1000}>1000 stocks</option>
              <option value={0}>All stocks</option>
            </select>
            
            {/* Run Base Scan Button with Dropdown */}
            <div className="relative">
              <div className="flex">
                <button 
                  onClick={runBaseScan} 
                  disabled={isScanning || isAnalyzingAI || isRunningFullSpectrum} 
                  className="px-4 py-2.5 rounded-l-xl text-sm font-semibold flex items-center gap-2" 
                  style={{ background: isScanning ? 'rgba(245,158,11,0.2)' : 'linear-gradient(90deg, #6366f1, #8b5cf6)', color: isScanning ? '#fcd34d' : 'white', opacity: (isAnalyzingAI || isRunningFullSpectrum) ? 0.5 : 1 }}
                >
                  {isScanning && !isRunningFullSpectrum ? <><RefreshCw className="w-4 h-4 animate-spin" />Scanning...</> : <><Play className="w-4 h-4" />Run Base Scan</>}
                </button>
                <button
                  onClick={() => setShowBaseScanMenu(!showBaseScanMenu)}
                  disabled={isScanning || isAnalyzingAI || isRunningFullSpectrum}
                  className="px-2 py-2.5 rounded-r-xl text-sm font-semibold border-l border-white/20"
                  style={{ background: 'linear-gradient(90deg, #8b5cf6, #7c3aed)', color: 'white', opacity: (isScanning || isAnalyzingAI || isRunningFullSpectrum) ? 0.5 : 1 }}
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>
              
              {showBaseScanMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowBaseScanMenu(false)} />
                  <div className="absolute top-full left-0 mt-2 w-64 rounded-xl border shadow-xl z-50" style={{ background: 'rgba(15,23,42,0.98)', borderColor: 'rgba(99,102,241,0.3)' }}>
                    <button
                      onClick={() => { runBaseScan(); setShowBaseScanMenu(false); }}
                      className="w-full px-4 py-3 text-left text-sm hover:bg-white/5 rounded-t-xl flex items-center gap-3"
                      style={{ color: '#e2e8f0' }}
                    >
                    <Play className="w-4 h-4 text-indigo-400" />
                    <div>
                      <p className="font-medium">Find New Stocks</p>
                      <p className="text-xs text-slate-500">Scan market for new small-caps</p>
                    </div>
                  </button>
                  <button
                    onClick={() => { refreshCurrentStocks(); setShowBaseScanMenu(false); }}
                    disabled={stocks.length === 0}
                    className="w-full px-4 py-3 text-left text-sm hover:bg-white/5 rounded-b-xl flex items-center gap-3 border-t"
                    style={{ color: stocks.length === 0 ? '#64748b' : '#e2e8f0', borderColor: 'rgba(51,65,85,0.5)' }}
                  >
                    <RefreshCw className="w-4 h-4 text-emerald-400" />
                    <div>
                      <p className="font-medium">Refresh Current Stocks</p>
                      <p className="text-xs text-slate-500">{stocks.length > 0 ? `Update prices for ${stocks.length} stocks` : 'No stocks to refresh'}</p>
                    </div>
                  </button>
                  </div>
                </>
              )}
            </div>
            
            {/* Run Full Spectrum Button */}
            <button 
              onClick={() => setShowFullSpectrumModal(true)} 
              disabled={isScanning || isAnalyzingAI || isRunningFullSpectrum} 
              className="px-4 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2" 
              style={{ background: isRunningFullSpectrum ? 'rgba(245,158,11,0.2)' : 'linear-gradient(90deg, #f59e0b, #f97316)', color: isRunningFullSpectrum ? '#fcd34d' : 'white', opacity: (isScanning || isAnalyzingAI) && !isRunningFullSpectrum ? 0.5 : 1 }}
            >
              {isRunningFullSpectrum ? <><RefreshCw className="w-4 h-4 animate-spin" />Running...</> : <><Zap className="w-4 h-4" />Run Full Spectrum</>}
            </button>
          </div>
        </div>
      </header>

      {/* Full Spectrum Modal */}
      {showFullSpectrumModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }}>
          <div className="card rounded-2xl border border-slate-700 p-6 w-full max-w-md mx-4" style={{ background: 'rgba(15,23,42,0.98)' }}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-white flex items-center gap-2"><Zap className="w-6 h-6 text-amber-400" />Full Spectrum Scan</h2>
              <button onClick={() => setShowFullSpectrumModal(false)} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            
            <p className="text-sm text-slate-400 mb-6">This will run all scans in sequence: Base Scan → Supply Chain Tagging → Grok AI Analysis</p>
            
            <div className="space-y-4 mb-6">
              <div>
                <label className="text-sm text-slate-300 mb-2 block">Base Scan Stock Limit</label>
                <select 
                  value={spectrumSettings.baseStockLimit} 
                  onChange={e => setSpectrumSettings(p => ({...p, baseStockLimit: parseInt(e.target.value)}))}
                  className="w-full rounded-lg px-3 py-2 text-sm border outline-none"
                  style={{ background: 'rgba(30,41,59,0.5)', borderColor: 'rgba(99,102,241,0.3)', color: '#cbd5e1' }}
                >
                  <option value={100}>100 stocks</option>
                  <option value={500}>500 stocks</option>
                  <option value={1000}>1000 stocks</option>
                  <option value={0}>All stocks</option>
                </select>
              </div>
              
              <div className="flex items-center justify-between p-3 rounded-lg border" style={{ background: 'rgba(245,158,11,0.05)', borderColor: 'rgba(245,158,11,0.2)' }}>
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-amber-400" />
                  <span className="text-sm text-slate-200">Singularity Scan</span>
                </div>
                <button 
                  onClick={() => setSpectrumSettings(p => ({...p, singularityEnabled: !p.singularityEnabled}))}
                  className="w-12 h-6 rounded-full transition-colors"
                  style={{ background: spectrumSettings.singularityEnabled ? '#10b981' : 'rgba(51,65,85,0.5)' }}
                >
                  <div className="w-5 h-5 rounded-full bg-white transition-transform" style={{ transform: spectrumSettings.singularityEnabled ? 'translateX(26px)' : 'translateX(2px)' }} />
                </button>
              </div>
              
              {/* Grok only singularity 70+ option */}
              {spectrumSettings.grokEnabled && spectrumSettings.singularityEnabled && (
                <div className="flex items-center justify-between p-3 rounded-lg border" style={{ background: 'rgba(139,92,246,0.05)', borderColor: 'rgba(139,92,246,0.2)' }}>
                  <div className="flex items-center gap-2">
                    <Filter className="w-4 h-4 text-violet-400" />
                    <span className="text-sm text-slate-200">Grok only Singularity 70+</span>
                  </div>
                  <button 
                    onClick={() => setSpectrumSettings(p => ({...p, grokOnlySingularity70: !p.grokOnlySingularity70}))}
                    className="w-12 h-6 rounded-full transition-colors"
                    style={{ background: spectrumSettings.grokOnlySingularity70 ? '#10b981' : 'rgba(51,65,85,0.5)' }}
                  >
                    <div className="w-5 h-5 rounded-full bg-white transition-transform" style={{ transform: spectrumSettings.grokOnlySingularity70 ? 'translateX(26px)' : 'translateX(2px)' }} />
                  </button>
                </div>
              )}
              
              <div className="flex items-center justify-between p-3 rounded-lg border" style={{ background: 'rgba(239,68,68,0.05)', borderColor: 'rgba(239,68,68,0.2)' }}>
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-red-400" />
                  <span className="text-sm text-slate-200">Grok AI Analysis</span>
                </div>
                <button 
                  onClick={() => setSpectrumSettings(p => ({...p, grokEnabled: !p.grokEnabled}))}
                  className="w-12 h-6 rounded-full transition-colors"
                  style={{ background: spectrumSettings.grokEnabled ? '#10b981' : 'rgba(51,65,85,0.5)' }}
                >
                  <div className="w-5 h-5 rounded-full bg-white transition-transform" style={{ transform: spectrumSettings.grokEnabled ? 'translateX(26px)' : 'translateX(2px)' }} />
                </button>
              </div>
              
              {spectrumSettings.grokEnabled && (
                <div>
                  <label className="text-sm text-slate-300 mb-2 block">Grok AI - Stocks to Analyze</label>
                  <select 
                    value={spectrumSettings.grokCount} 
                    onChange={e => setSpectrumSettings(p => ({...p, grokCount: parseInt(e.target.value)}))}
                    className="w-full rounded-lg px-3 py-2 text-sm border outline-none"
                    style={{ background: 'rgba(30,41,59,0.5)', borderColor: 'rgba(239,68,68,0.3)', color: '#f87171' }}
                  >
                    <option value={10}>Top 10</option>
                    <option value={25}>Top 25</option>
                    <option value={50}>Top 50</option>
                    <option value={100}>Top 100</option>
                    <option value={0}>All stocks</option>
                  </select>
                </div>
              )}
            </div>
            
            <div className="flex gap-3">
              <button 
                onClick={() => setShowFullSpectrumModal(false)} 
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium border"
                style={{ background: 'rgba(30,41,59,0.5)', borderColor: 'rgba(51,65,85,0.5)', color: '#94a3b8' }}
              >
                Cancel
              </button>
              <button 
                onClick={runFullSpectrumScan} 
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2"
                style={{ background: 'linear-gradient(90deg, #f59e0b, #f97316)', color: 'white' }}
              >
                <Play className="w-4 h-4" />Start Full Spectrum
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }}>
          <div className="card rounded-2xl border border-slate-700 p-6 w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto" style={{ background: 'rgba(15,23,42,0.98)' }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-white flex items-center gap-2"><Sliders className="w-6 h-6 text-pink-400" />Settings</h2>
              <button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            
            {/* Grok Model Selection */}
            <div className="mb-6 p-4 rounded-xl border" style={{ background: 'rgba(245,158,11,0.05)', borderColor: 'rgba(245,158,11,0.2)' }}>
              <h3 className="text-sm font-semibold text-amber-400 mb-3">Grok AI Model</h3>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Model for all AI scans</label>
                <select 
                  value={grokModel} 
                  onChange={e => setGrokModel(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 text-sm border outline-none"
                  style={{ background: 'rgba(30,41,59,0.5)', borderColor: 'rgba(245,158,11,0.3)', color: '#fbbf24' }}
                >
                  <option value="grok-4">Grok 4 (Smartest)</option>
                  <option value="grok-4-fast-reasoning">Grok 4 Fast Reasoning (Faster)</option>
                </select>
                <p className="text-xs text-slate-500 mt-1">Grok 4 is more thorough, Fast Reasoning is quicker but may be less detailed</p>
              </div>
            </div>
            
            {/* Scan Settings Section */}
            <div className="mb-6 p-4 rounded-xl border" style={{ background: 'rgba(99,102,241,0.05)', borderColor: 'rgba(99,102,241,0.2)' }}>
              <h3 className="text-sm font-semibold text-indigo-400 mb-3">AI Scan Counts</h3>
              
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Conviction Scan</label>
                  <select 
                    value={convictionCount} 
                    onChange={e => setConvictionCount(parseInt(e.target.value))}
                    className="w-full rounded-lg px-3 py-2 text-sm border outline-none"
                    style={{ background: 'rgba(30,41,59,0.5)', borderColor: 'rgba(16,185,129,0.3)', color: '#34d399' }}
                  >
                    <option value={5}>5 stocks</option>
                    <option value={10}>10 stocks</option>
                    <option value={25}>25 stocks</option>
                    <option value={50}>50 stocks</option>
                    <option value={100}>100 stocks</option>
                    <option value={0}>All stocks</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">C&H Technical Scan</label>
                  <select 
                    value={technicalCount} 
                    onChange={e => setTechnicalCount(parseInt(e.target.value))}
                    className="w-full rounded-lg px-3 py-2 text-sm border outline-none"
                    style={{ background: 'rgba(30,41,59,0.5)', borderColor: 'rgba(99,102,241,0.3)', color: '#a5b4fc' }}
                  >
                    <option value={5}>5 stocks</option>
                    <option value={10}>10 stocks</option>
                    <option value={25}>25 stocks</option>
                    <option value={50}>50 stocks</option>
                    <option value={100}>100 stocks</option>
                    <option value={0}>All stocks</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Upside 8mo Scan</label>
                  <select 
                    value={upsideCount} 
                    onChange={e => setUpsideCount(parseInt(e.target.value))}
                    className="w-full rounded-lg px-3 py-2 text-sm border outline-none"
                    style={{ background: 'rgba(30,41,59,0.5)', borderColor: 'rgba(236,72,153,0.3)', color: '#f472b6' }}
                  >
                    <option value={5}>5 stocks</option>
                    <option value={10}>10 stocks</option>
                    <option value={25}>25 stocks</option>
                    <option value={50}>50 stocks</option>
                    <option value={100}>100 stocks</option>
                    <option value={0}>All stocks</option>
                  </select>
                </div>
              </div>
              
              {/* Singularity Batch Size */}
              <div className="mb-4 p-3 rounded-lg border" style={{ background: 'rgba(245,158,11,0.05)', borderColor: 'rgba(245,158,11,0.2)' }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-amber-400" />
                    <div>
                      <span className="text-sm text-slate-200">Singularity Scan Batch Size</span>
                      <p className="text-xs text-slate-500">Stocks per AI call (smaller = more accurate, slower)</p>
                    </div>
                  </div>
                  <select 
                    value={singularityBatchSize} 
                    onChange={e => setSingularityBatchSize(parseInt(e.target.value))}
                    className="rounded-lg px-3 py-2 text-sm border outline-none"
                    style={{ background: 'rgba(30,41,59,0.5)', borderColor: 'rgba(245,158,11,0.3)', color: '#fbbf24' }}
                  >
                    <option value={1}>1 stock (most accurate)</option>
                    <option value={5}>5 stocks</option>
                    <option value={15}>15 stocks (default)</option>
                    <option value={30}>30 stocks (fastest)</option>
                  </select>
                </div>
              </div>
              
              {/* Market Cap Settings */}
              <div className="flex items-center justify-between p-3 rounded-lg border mb-3" style={{ background: 'rgba(16,185,129,0.05)', borderColor: 'rgba(16,185,129,0.2)' }}>
                <div>
                  <span className="text-sm text-slate-200">Custom Market Cap Range</span>
                  <p className="text-xs text-slate-500">Default: $40M - $400M</p>
                </div>
                <button 
                  onClick={() => setGlobalSettings(p => ({...p, useCustomMarketCap: !p.useCustomMarketCap}))}
                  className="w-12 h-6 rounded-full transition-colors"
                  style={{ background: globalSettings.useCustomMarketCap ? '#10b981' : 'rgba(51,65,85,0.5)' }}
                >
                  <div className="w-5 h-5 rounded-full bg-white transition-transform" style={{ transform: globalSettings.useCustomMarketCap ? 'translateX(26px)' : 'translateX(2px)' }} />
                </button>
              </div>
              
              {globalSettings.useCustomMarketCap && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Min Market Cap ($M)</label>
                    <input 
                      type="number"
                      value={globalSettings.minMarketCap}
                      onChange={e => setGlobalSettings(p => ({...p, minMarketCap: parseInt(e.target.value) || 0}))}
                      className="w-full rounded-lg px-3 py-2 text-sm border outline-none"
                      style={{ background: 'rgba(30,41,59,0.5)', borderColor: 'rgba(16,185,129,0.3)', color: '#34d399' }}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Max Market Cap ($M)</label>
                    <input 
                      type="number"
                      value={globalSettings.maxMarketCap}
                      onChange={e => setGlobalSettings(p => ({...p, maxMarketCap: parseInt(e.target.value) || 1000}))}
                      className="w-full rounded-lg px-3 py-2 text-sm border outline-none"
                      style={{ background: 'rgba(30,41,59,0.5)', borderColor: 'rgba(16,185,129,0.3)', color: '#34d399' }}
                    />
                  </div>
                </div>
              )}
            </div>
            
            <button 
              onClick={() => setShowSettings(false)} 
              className="w-full px-4 py-2.5 rounded-xl text-sm font-semibold"
              style={{ background: 'linear-gradient(90deg, #ec4899, #f472b6)', color: 'white' }}
            >
              Save & Close
            </button>
          </div>
        </div>
      )}

      {/* Sessions Panel */}
      {showSessions && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }}>
          <div className="card rounded-2xl border border-slate-700 p-6 w-full max-w-lg mx-4 max-h-[80vh] overflow-hidden flex flex-col" style={{ background: 'rgba(15,23,42,0.98)' }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-white flex items-center gap-2"><Clock className="w-6 h-6 text-violet-400" />Saved Sessions</h2>
              <button onClick={() => setShowSessions(false)} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            
            {/* New Session Button */}
            <button
              onClick={() => {
                setStocks([]);
                setCurrentSessionId(null);
                setSelected(null);
                setScanProgress({ phase: 'idle', current: 0, total: 0, found: 0 });
                setStatus({ type: 'ready', msg: 'New session created. Run a scan to find stocks.' });
                setShowSessions(false);
              }}
              className="mb-4 w-full px-4 py-3 rounded-xl text-sm font-semibold border flex items-center justify-center gap-2 hover:border-emerald-500/50 transition-colors"
              style={{ background: 'rgba(16,185,129,0.1)', borderColor: 'rgba(16,185,129,0.3)', color: '#34d399' }}
            >
              <Plus className="w-5 h-5" />
              New Session
            </button>
            
            <div className="flex-1 overflow-y-auto space-y-2">
              {sessions.length === 0 ? (
                <p className="text-center text-slate-500 py-8">No saved sessions yet. Run a scan to create one.</p>
              ) : sessions.map(session => (
                <div 
                  key={session.id} 
                  className="p-3 rounded-xl border cursor-pointer hover:border-violet-500/50 transition-colors"
                  style={{ 
                    background: currentSessionId === session.id ? 'rgba(139,92,246,0.1)' : 'rgba(30,41,59,0.5)', 
                    borderColor: currentSessionId === session.id ? 'rgba(139,92,246,0.5)' : 'rgba(51,65,85,0.5)' 
                  }}
                  onClick={() => loadPreviousSession(session.id)}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-200">{session.name}</p>
                      <p className="text-xs text-slate-500">{session.stockCount} stocks • {formatCacheAge(Date.now() - session.timestamp)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {currentSessionId === session.id && <span className="text-xs text-violet-400">Current</span>}
                      <button 
                        onClick={(e) => { e.stopPropagation(); deleteSession(session.id); setSessions(getAllSessions()); }}
                        className="text-slate-500 hover:text-red-400 p-1"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            
            <div className="mt-4 pt-4 border-t border-slate-700">
              <button 
                onClick={() => setShowSessions(false)} 
                className="w-full px-4 py-2.5 rounded-xl text-sm font-medium border"
                style={{ background: 'rgba(30,41,59,0.5)', borderColor: 'rgba(51,65,85,0.5)', color: '#94a3b8' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-[1800px] mx-auto px-6 py-6 min-h-screen">
        {error && <div className="mb-4 p-4 rounded-xl border flex items-center gap-3" style={{ background: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.3)' }}><AlertCircle className="w-5 h-5 text-red-400" /><p className="text-sm text-red-300 flex-1">{error}</p><button onClick={() => setError(null)} className="text-red-400"><X className="w-4 h-4" /></button></div>}

        {(isScanning || isAnalyzingAI) && (
          <div className="mb-6 p-5 rounded-2xl border" style={{ background: isAnalyzingAI ? 'rgba(239,68,68,0.1)' : 'rgba(99,102,241,0.1)', borderColor: isAnalyzingAI ? 'rgba(239,68,68,0.3)' : 'rgba(99,102,241,0.3)' }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <RefreshCw className={`w-5 h-5 animate-spin ${isAnalyzingAI ? 'text-red-400' : 'text-indigo-400'}`} />
                <span className={`text-sm ${isAnalyzingAI ? 'text-red-300' : 'text-indigo-300'}`}>
                  {isAnalyzingAI ? `Grok AI analyzing...` : scanProgress.phase}
                </span>
              </div>
              <div className="flex items-center gap-4 text-sm">
                {isAnalyzingAI ? (
                  <span className="text-red-400 mono">{aiProgress.current} / {aiProgress.total}</span>
                ) : (
                  <>
                    <span className="text-indigo-400 mono">{scanProgress.current} / {scanProgress.total}</span>
                    <span className="text-emerald-400 mono">{scanProgress.found} qualified</span>
                  </>
                )}
              </div>
            </div>
            <div className="h-3 rounded-full overflow-hidden" style={{ background: 'rgba(30,41,59,0.5)' }}>
              <div 
                className="h-full rounded-full transition-all duration-300" 
                style={{ 
                  width: isAnalyzingAI ? `${(aiProgress.current / aiProgress.total) * 100}%` : `${progressPct}%`, 
                  background: isAnalyzingAI ? 'linear-gradient(90deg, #ef4444, #f87171)' : 'linear-gradient(90deg, #6366f1, #8b5cf6)' 
                }} 
              />
            </div>
          </div>
        )}

        {showDiscovery && (
          <div className="mb-6 card rounded-2xl border border-slate-800/50 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold flex items-center gap-2"><Radar className="w-5 h-5 text-emerald-400" />Discovery Pipeline</h2>
              <div className="flex gap-4 text-center">
                <div className="px-4 py-2 rounded-xl border" style={{ background: 'rgba(15,23,42,0.5)', borderColor: 'rgba(51,65,85,0.5)' }}><p className="text-[10px] text-slate-500">Scanned</p><p className="mono text-xl font-bold text-slate-200">{scanProgress.total.toLocaleString()}</p></div>
                <div className="px-4 py-2 rounded-xl border" style={{ background: 'rgba(16,185,129,0.1)', borderColor: 'rgba(16,185,129,0.2)' }}><p className="text-[10px] text-emerald-400">Qualified</p><p className="mono text-xl font-bold text-emerald-400">{scanProgress.found}</p></div>
                <div className="px-4 py-2 rounded-xl border" style={{ background: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.2)' }}><p className="text-[10px] text-red-400">AI Analyzed</p><p className="mono text-xl font-bold text-red-400">{stocksWithAI}</p></div>
              </div>
            </div>
            <div className="grid grid-cols-5 gap-3">
              {discoveryAgents.map(a => (
                <div key={a.id} className="p-3 rounded-xl border" style={{ background: discoveryStatus[a.id] === 'complete' ? 'rgba(16,185,129,0.05)' : discoveryStatus[a.id] === 'running' ? 'rgba(245,158,11,0.05)' : 'rgba(15,23,42,0.5)', borderColor: discoveryStatus[a.id] === 'complete' ? 'rgba(16,185,129,0.3)' : discoveryStatus[a.id] === 'running' ? 'rgba(245,158,11,0.3)' : 'rgba(51,65,85,0.5)' }}>
                  <div className="flex items-center justify-between mb-2"><div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${a.color}15` }}><a.icon className="w-4 h-4" style={{ color: a.color }} /></div><StatusIcon s={discoveryStatus[a.id]} /></div>
                  <p className="text-sm font-medium text-slate-200">{a.name}</p><p className="text-[10px] text-slate-500">{a.coverage}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {showWeights && (
          <div className="mb-6 card rounded-2xl border border-slate-800/50 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold flex items-center gap-2"><Sliders className="w-5 h-5 text-amber-400" />Scoring Weights</h2>
              <button onClick={() => { setWeights({ pricePosition: 40, insiderActivity: 40, netCash: 20 }); setAiWeights({ conviction: 20, upside: 20, cupHandle: 10 }); }} className="text-xs text-slate-400 hover:text-white px-3 py-1.5 rounded-lg border" style={{ background: 'rgba(30,41,59,0.5)', borderColor: 'rgba(51,65,85,0.5)' }}>Reset All</button>
            </div>
            
            <p className="text-xs text-slate-500 mb-3">Base Scoring (applied to all stocks)</p>
            <div className="grid grid-cols-3 gap-4 mb-6">
              {analysisAgents.map(a => (
                <div key={a.id} className="rounded-xl p-4 border" style={{ background: 'rgba(15,23,42,0.5)', borderColor: 'rgba(51,65,85,0.5)' }}>
                  <div className="flex items-center gap-2 mb-3"><div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${a.color}20` }}><a.icon className="w-4 h-4" style={{ color: a.color }} /></div><span className="text-sm font-medium text-slate-200">{a.name}</span></div>
                  <div className="flex items-center gap-3"><input type="range" min="0" max="100" value={weights[a.id]} onChange={e => handleWeight(a.id, parseInt(e.target.value))} className="flex-1" style={{ accentColor: a.color }} /><span className="mono text-sm font-semibold w-8 text-right" style={{ color: a.color }}>{weights[a.id]}</span></div>
                </div>
              ))}
            </div>
            
            <p className="text-xs text-slate-500 mb-3">AI Bonus Points (added after Grok analysis)</p>
            <div className="grid grid-cols-3 gap-4">
              <div className="rounded-xl p-4 border" style={{ background: 'rgba(239,68,68,0.05)', borderColor: 'rgba(239,68,68,0.2)' }}>
                <div className="flex items-center gap-2 mb-3"><div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(239,68,68,0.2)' }}><Users className="w-4 h-4 text-red-400" /></div><span className="text-sm font-medium text-slate-200">Conviction</span></div>
                <div className="flex items-center gap-3"><input type="range" min="0" max="50" value={aiWeights.conviction} onChange={e => { const v = parseInt(e.target.value); setAiWeights(p => ({...p, conviction: v})); setStocks(s => calcScores(s, weights, {...aiWeights, conviction: v})); }} className="flex-1" style={{ accentColor: '#f87171' }} /><span className="mono text-sm font-semibold w-8 text-right text-red-400">+{aiWeights.conviction}</span></div>
              </div>
              <div className="rounded-xl p-4 border" style={{ background: 'rgba(239,68,68,0.05)', borderColor: 'rgba(239,68,68,0.2)' }}>
                <div className="flex items-center gap-2 mb-3"><div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(239,68,68,0.2)' }}><TrendingUp className="w-4 h-4 text-red-400" /></div><span className="text-sm font-medium text-slate-200">Upside %</span></div>
                <div className="flex items-center gap-3"><input type="range" min="0" max="50" value={aiWeights.upside} onChange={e => { const v = parseInt(e.target.value); setAiWeights(p => ({...p, upside: v})); setStocks(s => calcScores(s, weights, {...aiWeights, upside: v})); }} className="flex-1" style={{ accentColor: '#f87171' }} /><span className="mono text-sm font-semibold w-8 text-right text-red-400">+{aiWeights.upside}</span></div>
              </div>
              <div className="rounded-xl p-4 border" style={{ background: 'rgba(239,68,68,0.05)', borderColor: 'rgba(239,68,68,0.2)' }}>
                <div className="flex items-center gap-2 mb-3"><div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(239,68,68,0.2)' }}><BarChart3 className="w-4 h-4 text-red-400" /></div><span className="text-sm font-medium text-slate-200">Cup & Handle</span></div>
                <div className="flex items-center gap-3"><input type="range" min="0" max="50" value={aiWeights.cupHandle} onChange={e => { const v = parseInt(e.target.value); setAiWeights(p => ({...p, cupHandle: v})); setStocks(s => calcScores(s, weights, {...aiWeights, cupHandle: v})); }} className="flex-1" style={{ accentColor: '#f87171' }} /><span className="mono text-sm font-semibold w-8 text-right text-red-400">{aiWeights.cupHandle}</span></div>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-3">
            <div className="card rounded-2xl border border-slate-800/50 p-5 sticky top-28">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2"><Brain className="w-5 h-5 text-violet-400" />Analysis Agents</h2>
              <div className="space-y-2">
                {analysisAgents.map(a => (
                  <div key={a.id} className="p-3 rounded-xl border flex items-center justify-between" style={{ background: analysisStatus[a.id] === 'complete' ? 'rgba(16,185,129,0.05)' : 'rgba(15,23,42,0.5)', borderColor: analysisStatus[a.id] === 'complete' ? 'rgba(16,185,129,0.3)' : 'rgba(51,65,85,0.5)' }}>
                    <div className="flex items-center gap-2"><div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${a.color}15` }}><a.icon className="w-4 h-4" style={{ color: a.color }} /></div><div><p className="text-sm font-medium text-slate-200">{a.name}</p><p className="text-[10px] text-slate-500">{a.desc}</p></div></div>
                    <StatusIcon s={analysisStatus[a.id]} />
                  </div>
                ))}
              </div>
              
              <div className="mt-6 p-4 rounded-xl border" style={{ background: 'rgba(239,68,68,0.05)', borderColor: 'rgba(239,68,68,0.2)' }}>
                <h3 className="text-sm font-semibold text-red-400 mb-2 flex items-center gap-2"><Sparkles className="w-4 h-4" />Grok AI Deep Analysis</h3>
                <p className="text-xs text-slate-400 mb-2">Analyzes Stocktwits sentiment, insider conviction, future catalysts, and upside potential.</p>
                <p className="text-xs text-slate-500">{stocksWithAI} stocks analyzed</p>
              </div>
            </div>
          </div>

          <div className="col-span-9">
            <div className="card rounded-2xl border border-slate-800/50 overflow-hidden">
              <div className="p-5 border-b border-slate-800/50 flex items-center justify-between">
                <div><h2 className="text-lg font-semibold flex items-center gap-2"><TrendingUp className="w-5 h-5 text-indigo-400" />Stock Rankings</h2><p className="text-xs text-slate-500">{sorted.length} of {stocks.length} stocks {lastUpdate && `• ${lastUpdate.toLocaleTimeString()}`}</p></div>
                <div className="flex gap-3 items-center">
                  <button 
                    onClick={() => setShowAddStocks(!showAddStocks)}
                    className="px-3 py-2 rounded-lg text-sm border flex items-center gap-2"
                    style={{ 
                      background: showAddStocks ? 'rgba(16,185,129,0.2)' : 'rgba(30,41,59,0.5)', 
                      borderColor: showAddStocks ? 'rgba(16,185,129,0.5)' : 'rgba(51,65,85,0.5)', 
                      color: showAddStocks ? '#34d399' : '#94a3b8' 
                    }}
                    title="Add stocks manually"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={() => setShowClearData(!showClearData)}
                    className="px-3 py-2 rounded-lg text-sm border flex items-center gap-2"
                    style={{ 
                      background: showClearData ? 'rgba(239,68,68,0.2)' : 'rgba(30,41,59,0.5)', 
                      borderColor: showClearData ? 'rgba(239,68,68,0.5)' : 'rgba(51,65,85,0.5)', 
                      color: showClearData ? '#f87171' : '#94a3b8' 
                    }}
                    title="Clear column data"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={() => setShowFilters(!showFilters)}
                    className="px-3 py-2 rounded-lg text-sm border flex items-center gap-2"
                    style={{ 
                      background: showFilters || Object.values(filters).some(v => v === true || v > 0) ? 'rgba(139,92,246,0.2)' : 'rgba(30,41,59,0.5)', 
                      borderColor: showFilters || Object.values(filters).some(v => v === true || v > 0) ? 'rgba(139,92,246,0.5)' : 'rgba(51,65,85,0.5)', 
                      color: showFilters || Object.values(filters).some(v => v === true || v > 0) ? '#a78bfa' : '#94a3b8' 
                    }}
                  >
                    <Filter className="w-4 h-4" />
                    Filters {Object.values(filters).filter(v => v === true || v > 0).length > 0 && `(${Object.values(filters).filter(v => v === true || v > 0).length})`}
                  </button>
                  <select value={sectorFilter} onChange={e => setSectorFilter(e.target.value)} className="rounded-lg px-3 py-2 text-sm border outline-none" style={{ background: 'rgba(30,41,59,0.5)', borderColor: 'rgba(51,65,85,0.5)', color: '#cbd5e1' }}>
                    {Object.entries(STOCK_CATEGORIES).map(([key, cat]) => (
                      <option key={key} value={key}>{cat.name}</option>
                    ))}
                  </select>
                  <select value={sortBy} onChange={e => setSortBy(e.target.value)} className="rounded-lg px-3 py-2 text-sm border outline-none" style={{ background: 'rgba(30,41,59,0.5)', borderColor: 'rgba(51,65,85,0.5)', color: '#cbd5e1' }}>
                    <option value="compositeScore">Score</option>
                    <option value="insiderDate">Recent Insider Buys</option>
                    <option value="netCash">Net Cash</option>
                    <option value="upsidePct">Upside %</option>
                    <option value="insiderConviction">Conviction</option>
                  </select>
                </div>
              </div>
              
              {/* Filter Panel */}
              {showFilters && (
                <div className="p-4 border-b border-slate-800/50" style={{ background: 'rgba(139,92,246,0.05)' }}>
                  <div className="grid grid-cols-4 gap-4">
                    {/* Net Cash Filter */}
                    <div className="flex items-center justify-between p-3 rounded-lg border" style={{ background: 'rgba(16,185,129,0.05)', borderColor: 'rgba(16,185,129,0.2)' }}>
                      <div className="flex items-center gap-2">
                        <Banknote className="w-4 h-4 text-emerald-400" />
                        <span className="text-sm text-slate-200">Net Cash+ Only</span>
                      </div>
                      <button 
                        onClick={() => setFilters(f => ({...f, hideNetCashNegative: !f.hideNetCashNegative}))}
                        className="w-10 h-5 rounded-full transition-colors"
                        style={{ background: filters.hideNetCashNegative ? '#10b981' : 'rgba(51,65,85,0.5)' }}
                      >
                        <div className="w-4 h-4 rounded-full bg-white transition-transform" style={{ transform: filters.hideNetCashNegative ? 'translateX(22px)' : 'translateX(2px)' }} />
                      </button>
                    </div>
                    
                    {/* Min Singularity Score */}
                    <div className="p-3 rounded-lg border" style={{ background: 'rgba(245,158,11,0.05)', borderColor: 'rgba(245,158,11,0.2)' }}>
                      <div className="flex items-center gap-2 mb-2">
                        <Zap className="w-4 h-4 text-amber-400" />
                        <span className="text-sm text-slate-200">Min Singularity</span>
                      </div>
                      <select 
                        value={filters.minSingularityScore}
                        onChange={e => setFilters(f => ({...f, minSingularityScore: parseInt(e.target.value)}))}
                        className="w-full rounded px-2 py-1 text-sm border outline-none"
                        style={{ background: 'rgba(30,41,59,0.5)', borderColor: 'rgba(245,158,11,0.3)', color: '#fbbf24' }}
                      >
                        <option value={0}>No minimum</option>
                        <option value={30}>30+</option>
                        <option value={50}>50+</option>
                        <option value={70}>70+</option>
                        <option value={80}>80+</option>
                      </select>
                    </div>
                    
                    {/* Category Exclusions */}
                    <div className="col-span-2 p-3 rounded-lg border" style={{ background: 'rgba(239,68,68,0.05)', borderColor: 'rgba(239,68,68,0.2)' }}>
                      <div className="flex items-center gap-2 mb-2">
                        <X className="w-4 h-4 text-red-400" />
                        <span className="text-sm text-slate-200">Exclude Categories</span>
                        <span className="text-xs text-slate-500">(detected by Singularity scan)</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {[
                          { key: 'excludeBanks', label: 'Banks' },
                          { key: 'excludeFood', label: 'Food' },
                          { key: 'excludeHealthcare', label: 'Healthcare' },
                          { key: 'excludeInsurance', label: 'Insurance' },
                          { key: 'excludeREIT', label: 'REITs' }
                        ].map(cat => (
                          <button
                            key={cat.key}
                            onClick={() => setFilters(f => ({...f, [cat.key]: !f[cat.key]}))}
                            className="px-2 py-1 rounded text-xs font-medium transition-colors"
                            style={{ 
                              background: filters[cat.key] ? 'rgba(239,68,68,0.3)' : 'rgba(30,41,59,0.5)',
                              color: filters[cat.key] ? '#f87171' : '#94a3b8',
                              border: `1px solid ${filters[cat.key] ? 'rgba(239,68,68,0.5)' : 'rgba(51,65,85,0.5)'}`
                            }}
                          >
                            {filters[cat.key] ? '✕ ' : ''}{cat.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  
                  {/* Clear All Filters */}
                  <div className="mt-3 flex justify-end">
                    <button
                      onClick={() => setFilters({
                        hideNetCashNegative: false,
                        minSingularityScore: 0,
                        excludeBanks: false,
                        excludeFood: false,
                        excludeHealthcare: false,
                        excludeInsurance: false,
                        excludeREIT: false
                      })}
                      className="px-3 py-1 rounded text-xs text-slate-400 hover:text-white transition-colors"
                    >
                      Clear All Filters
                    </button>
                  </div>
                </div>
              )}
              
              {/* Add Stocks Panel */}
              {showAddStocks && (
                <div className="p-4 border-b border-slate-800/50" style={{ background: 'rgba(16,185,129,0.05)' }}>
                  <div className="flex items-center gap-2 mb-3">
                    <Plus className="w-4 h-4 text-emerald-400" />
                    <span className="text-sm font-semibold text-emerald-400">Add Stocks Manually</span>
                  </div>
                  <div className="flex gap-3">
                    <input
                      type="text"
                      value={addStocksInput}
                      onChange={e => setAddStocksInput(e.target.value)}
                      placeholder="Enter tickers separated by commas (e.g., AAPL, MSFT, GOOGL)"
                      className="flex-1 rounded-lg px-4 py-2 text-sm border outline-none"
                      style={{ background: 'rgba(30,41,59,0.5)', borderColor: 'rgba(16,185,129,0.3)', color: '#e2e8f0' }}
                      onKeyDown={e => e.key === 'Enter' && addManualStocks()}
                    />
                    <button
                      onClick={addManualStocks}
                      disabled={isAddingStocks || !addStocksInput.trim()}
                      className="px-4 py-2 rounded-lg text-sm font-medium border flex items-center gap-2"
                      style={{ 
                        background: 'rgba(16,185,129,0.2)', 
                        borderColor: 'rgba(16,185,129,0.5)', 
                        color: '#34d399',
                        opacity: isAddingStocks || !addStocksInput.trim() ? 0.5 : 1
                      }}
                    >
                      {isAddingStocks ? (
                        <><RefreshCw className="w-4 h-4 animate-spin" />Adding...</>
                      ) : (
                        <><Plus className="w-4 h-4" />Add Stocks</>
                      )}
                    </button>
                  </div>
                  <p className="text-xs text-slate-500 mt-2">Stocks will be fetched from Polygon API and added to the table</p>
                </div>
              )}
              
              {/* Clear Data Panel */}
              {showClearData && (
                <div className="p-4 border-b border-slate-800/50" style={{ background: 'rgba(239,68,68,0.05)' }}>
                  <div className="flex items-center gap-2 mb-3">
                    <Trash2 className="w-4 h-4 text-red-400" />
                    <span className="text-sm font-semibold text-red-400">Clear AI Scan Data</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => clearColumnData('conviction')}
                      className="px-3 py-2 rounded-lg text-sm font-medium border flex items-center gap-2 hover:bg-opacity-30 transition-colors"
                      style={{ background: 'rgba(16,185,129,0.1)', borderColor: 'rgba(16,185,129,0.3)', color: '#34d399' }}
                    >
                      <Trash2 className="w-3 h-3" />
                      Conviction Data
                    </button>
                    <button
                      onClick={() => clearColumnData('upside')}
                      className="px-3 py-2 rounded-lg text-sm font-medium border flex items-center gap-2 hover:bg-opacity-30 transition-colors"
                      style={{ background: 'rgba(236,72,153,0.1)', borderColor: 'rgba(236,72,153,0.3)', color: '#f472b6' }}
                    >
                      <Trash2 className="w-3 h-3" />
                      Upside 8mo Data
                    </button>
                    <button
                      onClick={() => clearColumnData('technical')}
                      className="px-3 py-2 rounded-lg text-sm font-medium border flex items-center gap-2 hover:bg-opacity-30 transition-colors"
                      style={{ background: 'rgba(99,102,241,0.1)', borderColor: 'rgba(99,102,241,0.3)', color: '#a5b4fc' }}
                    >
                      <Trash2 className="w-3 h-3" />
                      C&H Technical Data
                    </button>
                    <button
                      onClick={() => clearColumnData('singularity')}
                      className="px-3 py-2 rounded-lg text-sm font-medium border flex items-center gap-2 hover:bg-opacity-30 transition-colors"
                      style={{ background: 'rgba(245,158,11,0.1)', borderColor: 'rgba(245,158,11,0.3)', color: '#fbbf24' }}
                    >
                      <Trash2 className="w-3 h-3" />
                      Singularity Data
                    </button>
                    <button
                      onClick={() => clearColumnData('all')}
                      className="px-3 py-2 rounded-lg text-sm font-medium border flex items-center gap-2 hover:bg-opacity-30 transition-colors"
                      style={{ background: 'rgba(239,68,68,0.2)', borderColor: 'rgba(239,68,68,0.5)', color: '#f87171' }}
                    >
                      <Trash2 className="w-3 h-3" />
                      Clear ALL AI Data
                    </button>
                  </div>
                  <p className="text-xs text-slate-500 mt-2">This will clear the selected scan data for all stocks. Stock prices and basic info will remain.</p>
                </div>
              )}
              
                <div className="px-4 py-2 border-b border-slate-800/50 flex items-center gap-4 text-xs text-slate-500 font-medium" style={{ background: 'rgba(15,23,42,0.5)' }}>
                  <div className="w-10 text-center">Rank</div>
                  <div className="flex-1">Ticker / Name</div>
                  <div className="w-24 text-right">Price / MCap</div>
                  <div 
                    className="w-14 text-center cursor-pointer hover:text-slate-300 transition-colors flex items-center justify-center gap-1"
                    onClick={() => setSortBy(sortBy === 'extendedChange' ? 'compositeScore' : 'extendedChange')}
                    title="Pre-Market or After-Hours Change %"
                  >
                    Ext
                    {sortBy === 'extendedChange' && <span className="text-cyan-400">↓</span>}
                  </div>
                  <div className="w-16 text-center">Net Cash</div>
                  <div 
                    className="w-20 text-center cursor-pointer hover:text-slate-300 transition-colors flex items-center justify-center gap-1"
                    onClick={() => setSortBy(sortBy === 'insiderDate' ? 'compositeScore' : 'insiderDate')}
                  >
                    Insider
                    {sortBy === 'insiderDate' && <span className="text-emerald-400">↓</span>}
                  </div>
                  <div 
                    className="w-10 text-center cursor-pointer hover:text-slate-300 transition-colors flex items-center justify-center gap-1"
                    onClick={() => setSortBy(sortBy === 'singularityScore' ? 'compositeScore' : 'singularityScore')}
                    title="Singularity Score"
                  >
                    Sg
                    {sortBy === 'singularityScore' && <span className="text-amber-400">↓</span>}
                  </div>
                  <div 
                    className="w-12 text-center cursor-pointer hover:text-slate-300 transition-colors flex items-center justify-center gap-1"
                    onClick={() => setSortBy(sortBy === 'upsidePrediction' ? 'compositeScore' : 'upsidePrediction')}
                    title="Upside 8-Month Prediction"
                  >
                    8mo
                    {sortBy === 'upsidePrediction' && <span className="text-pink-400">↓</span>}
                  </div>
                  <div 
                    className="w-10 text-center cursor-pointer hover:text-slate-300 transition-colors flex items-center justify-center gap-1"
                    onClick={() => setSortBy(sortBy === 'insiderConviction' ? 'compositeScore' : 'insiderConviction')}
                    title="Insider Conviction"
                  >
                    Cv
                    {sortBy === 'insiderConviction' && <span className="text-emerald-400">↓</span>}
                  </div>
                  <div 
                    className="w-10 text-center cursor-pointer hover:text-slate-300 transition-colors flex items-center justify-center gap-1"
                    onClick={() => setSortBy(sortBy === 'cupHandleScore' ? 'compositeScore' : 'cupHandleScore')}
                    title="Cup & Handle Score"
                  >
                    CH
                    {sortBy === 'cupHandleScore' && <span className="text-emerald-400">↓</span>}
                  </div>
                  <div className="w-12 text-center">52wL</div>
                  <div 
                    className="w-14 text-center cursor-pointer hover:text-slate-300 transition-colors flex items-center justify-center gap-1"
                    onClick={() => setSortBy('compositeScore')}
                  >
                    Score
                    {sortBy === 'compositeScore' && <span className="text-indigo-400">↓</span>}
                  </div>
                  <div className="w-6"></div>
                </div>
              
              <div className="divide-y divide-slate-800/30 max-h-[calc(100vh-350px)] overflow-y-auto">
                {sorted.length === 0 && !isScanning ? (
                  <div className="p-12 text-center"><Database className="w-12 h-12 text-slate-700 mx-auto mb-4" /><p className="text-slate-400">Click "Run Full Scan" to find small-cap opportunities</p></div>
                ) : sorted.map((s, i) => (
                  <div key={s.ticker} className="row cursor-pointer" onClick={() => setSelected(selected?.ticker === s.ticker ? null : s)}>
                    <div className="p-4">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center mono font-bold text-sm" style={{ background: i < 3 ? ['rgba(245,158,11,0.2)', 'rgba(148,163,184,0.2)', 'rgba(194,65,12,0.2)'][i] : 'rgba(30,41,59,0.5)', color: i < 3 ? ['#fbbf24', '#cbd5e1', '#fb923c'][i] : '#64748b' }}>#{i + 1}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="mono font-bold text-lg text-slate-100">{s.ticker}</span>
                            <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: s.change >= 0 ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)', color: s.change >= 0 ? '#34d399' : '#f87171' }}>{s.change >= 0 ? '+' : ''}{s.change.toFixed(2)}%</span>
                            {s.aiAnalysis && <Sparkles className="w-4 h-4 text-emerald-400" title={`Conviction: ${s.insiderConviction}%`} />}
                            {s.technicalAnalysis && <Activity className="w-4 h-4 text-indigo-400" title={`C&H: ${s.cupHandleScore}`} />}
                            {s.upsideAnalysis && <TrendingUp className="w-4 h-4 text-pink-400" title={`Upside: ${s.upsidePrediction > 0 ? '+' : ''}${s.upsidePrediction}% in 8mo`} />}
                            {s.singularityScore >= 70 && <Zap className="w-4 h-4 text-amber-400" title={`Singularity: ${s.singularityScore}`} />}
                          </div>
                          <p className="text-xs text-slate-500 truncate">{s.name}</p>
                        </div>
                        <div className="text-right w-24"><p className="mono text-sm font-semibold text-slate-200">${s.price?.toFixed(2)}</p><p className="text-xs text-indigo-400 mono">${s.marketCap}M</p></div>
                        {/* Extended Hours (Pre-Market or After-Hours) */}
                        <div className="w-14 text-center">
                          {s.preMarketChange !== null && s.preMarketChange !== undefined ? (
                            <div>
                              <span className="text-xs font-bold mono" style={{ color: s.preMarketChange >= 0 ? '#22d3ee' : '#f87171' }}>
                                {s.preMarketChange >= 0 ? '+' : ''}{s.preMarketChange.toFixed(1)}%
                              </span>
                              <p className="text-[9px] text-slate-500">PRE</p>
                            </div>
                          ) : s.afterHoursChange !== null && s.afterHoursChange !== undefined ? (
                            <div>
                              <span className="text-xs font-bold mono" style={{ color: s.afterHoursChange >= 0 ? '#22d3ee' : '#f87171' }}>
                                {s.afterHoursChange >= 0 ? '+' : ''}{s.afterHoursChange.toFixed(1)}%
                              </span>
                              <p className="text-[9px] text-slate-500">AH</p>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-600">—</span>
                          )}
                        </div>
                        <div className="w-16 text-center"><NetCashBadge amount={s.netCash} hasData={s.hasFinancials} /></div>
                        <div className="w-20 text-center"><InsiderBadge data={s.lastInsiderPurchase} /></div>
                        {/* Singularity Score */}
                        <div className="w-10 text-center">
                          {s.singularityScore !== null && s.singularityScore !== undefined ? (
                            <span 
                              className="text-[10px] font-bold mono px-1 py-0.5 rounded"
                              style={{ 
                                background: s.singularityScore >= 70 ? 'rgba(245,158,11,0.2)' : s.singularityScore >= 40 ? 'rgba(100,116,139,0.2)' : 'rgba(51,65,85,0.2)',
                                color: s.singularityScore >= 70 ? '#fbbf24' : s.singularityScore >= 40 ? '#94a3b8' : '#64748b'
                              }}
                            >
                              {s.singularityScore}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-600">—</span>
                          )}
                        </div>
                        {/* 8-Month Prediction (Upside Scan) */}
                        <div className="w-12 text-center">
                          {s.upsidePrediction !== null && s.upsidePrediction !== undefined ? (
                            <span 
                              className="text-[10px] font-bold mono px-1 py-0.5 rounded"
                              style={{ 
                                background: s.upsidePrediction >= 200 ? 'rgba(16,185,129,0.3)' : s.upsidePrediction >= 50 ? 'rgba(16,185,129,0.2)' : s.upsidePrediction >= 0 ? 'rgba(245,158,11,0.2)' : 'rgba(239,68,68,0.2)',
                                color: s.upsidePrediction >= 200 ? '#34d399' : s.upsidePrediction >= 50 ? '#6ee7b7' : s.upsidePrediction >= 0 ? '#fbbf24' : '#f87171'
                              }}
                            >
                              {s.upsidePrediction > 0 ? '+' : ''}{s.upsidePrediction}%
                            </span>
                          ) : (
                            <span className="text-xs text-slate-600">—</span>
                          )}
                        </div>
                        {/* Conviction */}
                        <div className="w-10 text-center">
                          {s.insiderConviction !== null && s.insiderConviction !== undefined ? (
                            <span 
                              className="text-[10px] font-bold mono px-1 py-0.5 rounded"
                              style={{ 
                                background: s.insiderConviction >= 70 ? 'rgba(16,185,129,0.2)' : s.insiderConviction >= 40 ? 'rgba(245,158,11,0.2)' : 'rgba(239,68,68,0.2)',
                                color: s.insiderConviction >= 70 ? '#34d399' : s.insiderConviction >= 40 ? '#fbbf24' : '#f87171'
                              }}
                            >
                              {s.insiderConviction}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-600">—</span>
                          )}
                        </div>
                        {/* Cup & Handle */}
                        <div className="w-10 text-center">
                          {s.cupHandleScore !== null && s.cupHandleScore !== undefined ? (
                            <span 
                              className="text-[10px] font-bold mono px-1 py-0.5 rounded"
                              style={{ 
                                background: s.cupHandleScore >= 70 ? 'rgba(16,185,129,0.2)' : s.cupHandleScore >= 40 ? 'rgba(245,158,11,0.2)' : 'rgba(100,116,139,0.2)',
                                color: s.cupHandleScore >= 70 ? '#34d399' : s.cupHandleScore >= 40 ? '#fbbf24' : '#64748b'
                              }}
                            >
                              {s.cupHandleScore}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-600">—</span>
                          )}
                        </div>
                        <div className="w-12 text-center">
                          <div className="mono text-[10px] font-semibold" style={{ color: s.fromLow < 20 ? '#34d399' : s.fromLow < 50 ? '#fbbf24' : '#f87171' }}>{s.fromLow?.toFixed(1)}%</div>
                        </div>
                        <div className="w-14"><div className="flex items-center justify-between mb-1"><span className="mono text-xs font-bold text-indigo-400">{s.compositeScore.toFixed(1)}</span></div><div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(30,41,59,0.5)' }}><div className="h-full rounded-full" style={{ width: `${s.compositeScore}%`, background: 'linear-gradient(90deg, #6366f1, #8b5cf6)' }} /></div></div>
                        <div className="w-6">{selected?.ticker === s.ticker ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}</div>
                      </div>
                      
                      {selected?.ticker === s.ticker && (
                        <div className="mt-4 pt-4 border-t border-slate-800/30">
                          {s.aiAnalysis && (
                            <div className="mb-4 p-4 rounded-xl border" style={{ background: 'rgba(16,185,129,0.08)', borderColor: 'rgba(16,185,129,0.3)' }}>
                              <h4 className="text-sm font-semibold text-emerald-400 mb-2 flex items-center gap-2">
                                <Sparkles className="w-4 h-4" />
                                Insider Conviction Analysis
                                {s.insiderConviction !== null && (
                                  <span className="ml-2 px-2 py-0.5 rounded text-xs font-bold" style={{ background: s.insiderConviction >= 70 ? 'rgba(16,185,129,0.2)' : s.insiderConviction >= 40 ? 'rgba(245,158,11,0.2)' : 'rgba(239,68,68,0.2)', color: s.insiderConviction >= 70 ? '#34d399' : s.insiderConviction >= 40 ? '#fbbf24' : '#f87171' }}>
                                    {s.insiderConviction}% Conviction
                                  </span>
                                )}
                              </h4>
                              <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">{s.aiAnalysis}</p>
                            </div>
                          )}
                          
                          {s.upsideAnalysis && (
                            <div className="mb-4 p-4 rounded-xl border" style={{ background: 'rgba(236,72,153,0.08)', borderColor: 'rgba(236,72,153,0.3)' }}>
                              <h4 className="text-sm font-semibold text-pink-400 mb-2 flex items-center gap-2">
                                <TrendingUp className="w-4 h-4" />
                                8-Month Upside Analysis
                                {s.upsidePrediction !== null && (
                                  <span className="ml-2 px-2 py-0.5 rounded text-xs font-bold" style={{ 
                                    background: s.upsidePrediction >= 200 ? 'rgba(16,185,129,0.3)' : s.upsidePrediction >= 50 ? 'rgba(16,185,129,0.2)' : s.upsidePrediction >= 0 ? 'rgba(245,158,11,0.2)' : 'rgba(239,68,68,0.2)', 
                                    color: s.upsidePrediction >= 200 ? '#34d399' : s.upsidePrediction >= 50 ? '#6ee7b7' : s.upsidePrediction >= 0 ? '#fbbf24' : '#f87171' 
                                  }}>
                                    {s.upsidePrediction > 0 ? '+' : ''}{s.upsidePrediction}% in 8 months
                                  </span>
                                )}
                              </h4>
                              <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">{s.upsideAnalysis}</p>
                            </div>
                          )}
                          
                          {s.technicalAnalysis && (
                            <div className="mb-4 p-4 rounded-xl border" style={{ background: 'rgba(99,102,241,0.08)', borderColor: 'rgba(99,102,241,0.3)' }}>
                              <h4 className="text-sm font-semibold text-indigo-400 mb-2 flex items-center gap-2">
                                <Activity className="w-4 h-4" />
                                Cup & Handle Analysis
                                {s.cupHandleScore !== null && (
                                  <span className="ml-2 px-2 py-0.5 rounded text-xs font-bold" style={{ background: s.cupHandleScore >= 70 ? 'rgba(16,185,129,0.2)' : s.cupHandleScore >= 40 ? 'rgba(245,158,11,0.2)' : 'rgba(239,68,68,0.2)', color: s.cupHandleScore >= 70 ? '#34d399' : s.cupHandleScore >= 40 ? '#fbbf24' : '#f87171' }}>
                                    {s.cupHandleScore} C&H Score
                                  </span>
                                )}
                              </h4>
                              <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">{s.technicalAnalysis}</p>
                            </div>
                          )}
                          
                          {!s.aiAnalysis && !s.upsideAnalysis && !s.technicalAnalysis && i < 10 && (
                            <div className="mb-4 p-3 rounded-xl border" style={{ background: 'rgba(99,102,241,0.05)', borderColor: 'rgba(99,102,241,0.2)' }}>
                              <p className="text-sm text-slate-400 flex items-center gap-2"><Sparkles className="w-4 h-4 text-indigo-400" />Run Conviction, Upside 8mo, or C&H Scan to analyze</p>
                            </div>
                          )}
                          
                          <div className="grid grid-cols-4 gap-4">
                            <div className="rounded-lg p-3 border" style={{ background: 'rgba(16,185,129,0.05)', borderColor: 'rgba(16,185,129,0.2)' }}>
                              <p className="text-xs text-emerald-400 mb-1">52-Week Range</p>
                              <p className="text-lg font-bold text-slate-200">${s.low52?.toFixed(2)} - ${s.high52?.toFixed(2)}</p>
                              <p className="text-[10px] text-slate-500">{s.positionIn52Week?.toFixed(0)}% of range</p>
                            </div>
                            <div className="rounded-lg p-3 border" style={{ background: 'rgba(139,92,246,0.05)', borderColor: 'rgba(139,92,246,0.2)' }}>
                              <p className="text-xs text-violet-400 mb-1">Net Cash Position</p>
                              {s.hasFinancials ? (
                                <>
                                  <p className="text-lg font-bold" style={{ color: s.netCash >= 0 ? '#34d399' : '#f87171' }}>{formatMoney(s.netCash)}</p>
                                  <p className="text-[10px] text-slate-500">Cash: {formatMoney(s.cash)} | Debt: {formatMoney(s.debt)}</p>
                                </>
                              ) : (
                                <p className="text-slate-500 italic">No data available</p>
                              )}
                            </div>
                            <div className="rounded-lg p-3 border" style={{ background: 'rgba(16,185,129,0.05)', borderColor: 'rgba(16,185,129,0.2)' }}>
                              <p className="text-xs text-emerald-400 mb-1">Last Insider Purchase</p>
                              {s.lastInsiderPurchase ? (
                                <>
                                  <p className="text-lg font-bold text-slate-200">{formatMoney(s.lastInsiderPurchase.amount)}</p>
                                  <p className="text-[10px] text-slate-500">{formatDate(s.lastInsiderPurchase.date)} • {s.lastInsiderPurchase.shares?.toLocaleString()} shares</p>
                                  {s.lastInsiderPurchase.name && <p className="text-[10px] text-slate-400 truncate">by {s.lastInsiderPurchase.name}</p>}
                                </>
                              ) : (
                                <p className="text-slate-500 italic">None found</p>
                              )}
                            </div>
                            <div className="rounded-lg p-3 border" style={{ background: 'rgba(245,158,11,0.05)', borderColor: 'rgba(245,158,11,0.2)' }}>
                              <p className="text-xs text-amber-400 mb-1">RSI (14-day)</p>
                              <p className="text-lg font-bold text-slate-200">{Math.round(s.rsi)}</p>
                              <p className="text-[10px] text-slate-500">{s.rsi < 30 ? 'Oversold' : s.rsi > 70 ? 'Overbought' : 'Neutral'}</p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        
        <footer className="mt-8 pb-8 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <p className="text-xs text-slate-600">SingularityHunter • Polygon.io + Finnhub + xAI Grok Oracle</p>
            <span className="text-xs px-2 py-1 rounded bg-slate-800 text-slate-500 mono">v2.3</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>Stock Limit: {stockLimit === 0 ? 'All' : stockLimit}</span>
            {currentSessionId && <span>• Session Active</span>}
          </div>
        </footer>
      </div>
    </div>
  );
}
