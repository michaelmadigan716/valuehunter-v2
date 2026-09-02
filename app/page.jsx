'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { computeTechnicalOpinion } from '@/lib/technicals';
import { classifyTier, TIER_RULES } from '@/lib/tiers';
import { AGENT_DEFS, DEFAULT_PLAYBOOKS, computeMarketMetrics, getAIAnalysis, getTechnicalAnalysis, getValuationAnalysis, getMomentumAnalysis, getBuyoutAnalysis, getLeadershipAnalysis, getPlaybookAnalysis } from '@/lib/scanAgents';
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
  hunt: { name: 'Hunt tier (3-5x capable)', keywords: [] },
  all: { name: 'All Stocks', keywords: [] },
  singularity: { name: 'Singularity (70+)', keywords: [], singularityFilter: true },
  watchlist: { name: '⭐ Watchlist', keywords: [] },
  tierB: { name: 'Watch-only tier (capped sectors / big caps)', keywords: [] },
  tierC: { name: 'Skip tier (funds, SPACs, shells)', keywords: [] },
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
  // Prefer the daily-refreshed cloud universe (new listings in, delisted out);
  // fall back to live Polygon pagination if it isn't available.
  try {
    const res = await fetch('/api/main-session?universe=1');
    if (res.ok) {
      const data = await res.json();
      const uni = data.universe;
      if (uni && uni.tickers && Object.keys(uni.tickers).length > 1000) {
        const list = Object.keys(uni.tickers).sort().map(t => ({ ticker: t, name: uni.tickers[t].name }));
        console.log(`Universe from cloud: ${list.length} tickers (prices ${uni.prices_date || 'n/a'})`);
        return stockLimit > 0 ? list.slice(0, stockLimit) : list;
      }
    }
  } catch (e) { console.warn('Cloud universe unavailable, falling back to Polygon pagination'); }

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
  const [selectedStocks, setSelectedStocks] = useState(new Set()); // multi-select for targeted scans
  const [showSelectedScanMenu, setShowSelectedScanMenu] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isAnalyzingAI, setIsAnalyzingAI] = useState(false);
  const [isAnalyzingExplosive, setIsAnalyzingExplosive] = useState(false);
  const [isAnalyzingTeam, setIsAnalyzingTeam] = useState(false);
  const [isAnalyzingValuation, setIsAnalyzingValuation] = useState(false);
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
  const [explosiveProgress, setExplosiveProgress] = useState({ current: 0, total: 0 });
  const [teamProgress, setTeamProgress] = useState({ current: 0, total: 0 });
  const [valuationProgress, setValuationProgress] = useState({ current: 0, total: 0 });
  const [technicalProgress, setTechnicalProgress] = useState({ current: 0, total: 0 });
  const [analysisStatus, setAnalysisStatus] = useState(Object.fromEntries(analysisAgents.map(a => [a.id, 'idle'])));
  const [discoveryStatus, setDiscoveryStatus] = useState(Object.fromEntries(discoveryAgents.map(a => [a.id, 'idle'])));
  const [sortBy, setSortBy] = useState('compositeScore');
  const [sectorFilter, setSectorFilter] = useState('hunt');
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
    computedEnabled: true,      // free momentum/volatility metrics from price data
    grokEnabled: true,          // Conviction (insider) scan
    technicalEnabled: true,     // Cup & Handle scan
    valuationEnabled: true,
    momentumEnabled: false,     // live-search scans - opt in
    buyoutEnabled: false,
    leadershipEnabled: false,
    playbookEnabled: false,
    grokCount: 25,              // shared "stocks to analyze" count for all AI agent scans
    grokOnlySingularity70: false  // Only analyze stocks with singularity >= 70
  });

  // Filter by category keywords or Singularity buckets
  const matchesCategory = (stock, categoryKey) => {
    if (categoryKey === 'all') return true;
    if (categoryKey === 'watchlist') return Boolean(watchlist[stock.ticker]);
    if (categoryKey === 'hunt' || categoryKey === 'tierB' || categoryKey === 'tierC') {
      const tier = stock.tier || classifyTier(stock).tier;
      if (categoryKey === 'hunt') return tier === 'A' || Boolean(watchlist[stock.ticker]);
      if (categoryKey === 'tierB') return tier === 'B';
      return tier === 'C';
    }
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
  const [convictionCount, setConvictionCount] = useState(0);
  const [technicalCount, setTechnicalCount] = useState(0);
  const [explosiveCount, setExplosiveCount] = useState(0);
  const [teamCount, setTeamCount] = useState(0);
  const [parabolicCount, setParabolicCount] = useState(0);
  const [valuationCount, setValuationCount] = useState(0);
  const FALLBACK_MODELS = [
    { id: 'grok-4.6', label: 'Smartest (grok-4.6)' },
    { id: 'grok-4.3', label: 'Fastest (grok-4.3)' },
  ];
  const [availableModels, setAvailableModels] = useState(null);
  const [grokModel, setGrokModel] = useState('grok-4.6');
  useEffect(() => {
    fetch('/api/grok').then(r => r.ok ? r.json() : null).then(d => {
      if (d?.models?.length) setAvailableModels(d.models);
    }).catch(() => {});
  }, []);
  const [singularityBatchSize, setSingularityBatchSize] = useState(15);
  
  // Singularity Gate - minimum singularity score required for AI scans to run on a stock
  const [singularityGate, setSingularityGate] = useState(0); // 0 = disabled, otherwise min score
  
  // Stock picker for adding to sessions
  const [showStockPicker, setShowStockPicker] = useState(null); // ticker of stock showing picker
  
  // Top Gainers Filter
  const [showTopGainers, setShowTopGainers] = useState(false);
  const [topGainersThreshold, setTopGainersThreshold] = useState(5); // minimum % gain
  
  // Parabolic Continuation Scan
  const [isAnalyzingParabolic, setIsAnalyzingParabolic] = useState(false);
  const [parabolicProgress, setParabolicProgress] = useState({ current: 0, total: 0 });
  
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
    cupHandle: 10,
    singularity: 20,
    valuation: 10,
    momentum: 15,
    buyout: 15,
    leadership: 10,
    playbook: 15,
    technicals: 10
  });
  const [fullSpectrumPhase, setFullSpectrumPhase] = useState('');

  const calcScores = useCallback((list, w, aiW) => {
    const aw = aiW || { conviction: 20, upside: 20, cupHandle: 20 };
    
    // Calculate total weight (base + AI)
    const baseTotal = Object.values(w).reduce((a, b) => a + b, 0);
    const aiTotal = (aw.conviction || 0) + (aw.cupHandle || 0) + (aw.singularity || 0) + (aw.valuation || 0) + (aw.momentum || 0) + (aw.buyout || 0) + (aw.leadership || 0) + (aw.playbook || 0) + (aw.technicals || 0);
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
      
      // AI scores - Cup & Handle (0-100 scale)
      if (aw.cupHandle > 0 && s.cupHandleScore !== null && s.cupHandleScore !== undefined) {
        score += (s.cupHandleScore / 100) * (aw.cupHandle / grandTotal) * 100;
      }
      
      // AI scores - Singularity: bucket object (0-10 scale) or the flat
      // singularityScore (0-100) written by the Singularity scan
      if (aw.singularity > 0) {
        let singularityNormalized = 0;
        if (s.singularityScores) {
          singularityNormalized = Math.max(
            s.singularityScores.compute || 0,
            s.singularityScores.energy || 0,
            s.singularityScores.robotics || 0,
            s.singularityScores.agi_interface || 0
          ) / 10;
        }
        if (s.singularityScore !== null && s.singularityScore !== undefined) {
          singularityNormalized = Math.max(singularityNormalized, s.singularityScore / 100);
        }
        if (singularityNormalized > 0) {
          score += singularityNormalized * (aw.singularity / grandTotal) * 100;
        }
      }

      // AI scores - Valuation (0-100 scale, high = undervalued)
      if (aw.valuation > 0 && s.valuationScore !== null && s.valuationScore !== undefined) {
        score += (s.valuationScore / 100) * (aw.valuation / grandTotal) * 100;
      }

      // Momentum + options scores (0-100 scales, weights default 0)
      const simpleContrib = [
        ['momentum', s.momentumScore], ['buyout', s.buyoutScore], ['leadership', s.leadershipScore], ['playbook', s.playbookScore], ['technicals', s.techScore],
      ];
      for (const [k, v] of simpleContrib) {
        if ((aw[k] || 0) > 0 && v !== null && v !== undefined) {
          score += (v / 100) * (aw[k] / grandTotal) * 100;
        }
      }

      return { ...s, compositeScore: Math.min(100, Math.max(0, score)) };
    }).sort((a, b) => b.compositeScore - a.compositeScore);
  }, []);

  // ============================================
  // AGENT REGISTRY + GENERIC RUNNER (checkpoint / resume-on-refresh)
  // ============================================
  const stocksRef = React.useRef(stocks);
  useEffect(() => { stocksRef.current = stocks; }, [stocks]);
  const sessionIdRef = React.useRef(null);
  useEffect(() => { sessionIdRef.current = currentSessionId; }, [currentSessionId]);
  const resumeTimerRef = React.useRef(null);

  const [agentRunning, setAgentRunning] = useState(null);
  const scanControlRef = React.useRef(null); // null | 'pause' | 'cancel'
  const [pausedRun, setPausedRun] = useState(null);

  // Playbooks - editable winning-circumstance definitions
  const [playbooks, setPlaybooks] = useState(DEFAULT_PLAYBOOKS);
  const playbooksRef = React.useRef(DEFAULT_PLAYBOOKS);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('singularityhunter_playbooks') || 'null');
      if (Array.isArray(saved) && saved.length > 0) { setPlaybooks(saved); playbooksRef.current = saved; }
    } catch (e) {}
  }, []);
  const updatePlaybook = (id, description) => setPlaybooks(prev => {
    const next = prev.map(p => (p.id === id ? { ...p, description } : p));
    playbooksRef.current = next;
    try { localStorage.setItem('singularityhunter_playbooks', JSON.stringify(next)); } catch (e) {}
    return next;
  });

  // Watchlist (scout finds + your stars) - drives the research team
  const [watchlist, setWatchlist] = useState({});
  const [scoutsLatest, setScoutsLatest] = useState(null);
  const toggleWatch = async (stock) => {
    const on = !watchlist[stock.ticker];
    setWatchlist(prev => { const next = { ...prev }; if (on) next[stock.ticker] = { route: 'manual', reason: 'Starred by you', addedAt: Date.now() }; else delete next[stock.ticker]; return next; });
    try {
      const res = await fetch('/api/main-session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'watch', ticker: stock.ticker, name: stock.name, on }) });
      const d = await res.json();
      if (d.watchlist) setWatchlist(d.watchlist);
    } catch (e) {}
  };

  // Research team feed
  const [researchFeed, setResearchFeed] = useState([]);
  const [researchConfig, setResearchConfig] = useState({ n: 10, model: 'grok-4.3' });
  const [showResearch, setShowResearch] = useState(false);
  const [isRunningResearch, setIsRunningResearch] = useState(false);
  const [feedViewedAt, setFeedViewedAt] = useState(0);
  useEffect(() => {
    try { setFeedViewedAt(parseInt(localStorage.getItem('singularityhunter_feed_viewed') || '0')); } catch (e) {}
    fetch('/api/research?feed=1').then(r => r.ok ? r.json() : null).then(d => {
      if (d) { setResearchFeed(d.feed || []); if (d.config) setResearchConfig(d.config); if (d.watchlist) setWatchlist(d.watchlist); if (d.scouts) setScoutsLatest(d.scouts); }
    }).catch(() => {});
  }, []);
  const openResearch = () => {
    setShowResearch(s => !s);
    const now = Date.now();
    setFeedViewedAt(now);
    try { localStorage.setItem('singularityhunter_feed_viewed', String(now)); } catch (e) {}
  };
  const runResearchNow = async () => {
    if (isRunningResearch) return;
    setIsRunningResearch(true);
    try {
      for (let hop = 0; hop < 8; hop++) {
        const res = await fetch('/api/research', { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || res.status);
        if (data.running) { await new Promise(r => setTimeout(r, 15000)); continue; }
        if (data.done || data.note) break;
      }
      const d = await fetch('/api/research?feed=1').then(r => r.json());
      setResearchFeed(d.feed || []); if (d.watchlist) setWatchlist(d.watchlist); if (d.scouts) setScoutsLatest(d.scouts);
    } catch (e) { setError(`Research pass failed: ${e.message}`); }
    setIsRunningResearch(false);
  };
  const [isRunningScouts, setIsRunningScouts] = useState(false);
  const runScoutsNow = async () => {
    if (isRunningScouts) return;
    setIsRunningScouts(true);
    try {
      const res = await fetch('/api/scouts', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.status);
      const d = await fetch('/api/research?feed=1').then(r => r.json());
      setResearchFeed(d.feed || []); if (d.watchlist) setWatchlist(d.watchlist); if (d.scouts) setScoutsLatest(d.scouts);
      // pull server-added watchlist stocks into the table
      const ms = await fetch('/api/main-session').then(r => r.json()).catch(() => null);
      if (ms?.session?.stocks?.length) { stocksRef.current = calcScores(ms.session.stocks, weights, aiWeights); setStocks(stocksRef.current); }
      setStatus({ type: 'live', msg: `Scouts: ${data.candidates} candidates, ${data.triaged} triaged, ${(data.added || []).length} added to watchlist` });
    } catch (e) { setError(`Scouts failed: ${e.message}`); }
    setIsRunningScouts(false);
  };
  const saveResearchConfig = (cfg) => {
    setResearchConfig(cfg);
    fetch('/api/research', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: cfg }) }).catch(() => {});
  };
  const unreadResearch = researchFeed.filter(f => f.ts > feedViewedAt).length;

  // Server-side scan jobs (survive refresh / closed tabs). Used when the cloud
  // Main Session is on; local mode falls back to the in-browser runner.
  const [serverJobs, setServerJobs] = useState([]);
  const jobProgressRef = React.useRef({});
  const pullCloudStocks = async () => {
    try {
      const ms = await fetch('/api/main-session').then(r => r.json());
      if (!ms?.session?.stocks?.length) return;
      const cloud = new Map(ms.session.stocks.map(s => [s.ticker, s]));
      const localTickers = new Set(stocksRef.current.map(s => s.ticker));
      const merged = stocksRef.current.map(s => (cloud.has(s.ticker) ? { ...s, ...cloud.get(s.ticker) } : s));
      for (const [t, s] of cloud) if (!localTickers.has(t)) merged.push(s);
      stocksRef.current = calcScores(merged, weights, aiWeights);
      setStocks(stocksRef.current);
    } catch (e) {}
  };
  const pollJobs = async () => {
    try {
      const d = await fetch('/api/jobs').then(r => r.json());
      const jobs = d.jobs || [];
      setServerJobs(jobs);
      let changed = false;
      for (const j of jobs) {
        const done = j.progress?.done || 0;
        if (jobProgressRef.current[j.id] !== undefined && jobProgressRef.current[j.id] !== done) changed = true;
        if (jobProgressRef.current[j.id] === undefined && j.status === 'done' && Date.now() - (j.finishedAt || 0) < 120000) changed = true;
        jobProgressRef.current[j.id] = done;
      }
      if (changed) await pullCloudStocks();
      return jobs;
    } catch (e) { return []; }
  };
  useEffect(() => {
    if (!useMainSessionRef.current) return; // ref: declared later in the component, safe to read at effect time
    pollJobs();
    const t = setInterval(() => {
      const active = serverJobs.some(j => j.status === 'queued' || j.status === 'running' || j.status === 'paused');
      if (active || showResearch) pollJobs();
    }, 5000);
    return () => clearInterval(t);
  }, [serverJobs.length, showResearch]);

  const enqueueJob = async (agentIds, tickers) => {
    try {
      const res = await fetch('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agentIds, tickers, model: grokModel, playbooks: playbooksRef.current }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || res.status);
      fetch('/api/worker', { method: 'POST' }).catch(() => {}); // kick the worker now; cron keeps it going
      setStatus({ type: 'loading', msg: `Queued ${agentIds.length} scan${agentIds.length > 1 ? 's' : ''} on ${tickers.length} stock${tickers.length > 1 ? 's' : ''} - runs on the server, safe to refresh` });
      await pollJobs();
      return d.job;
    } catch (e) { setError(`Could not queue scan: ${e.message}`); return null; }
  };
  const jobAction = async (id, action) => {
    try {
      await fetch('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, id }) });
      if (action === 'resume') fetch('/api/worker', { method: 'POST' }).catch(() => {});
      await pollJobs();
    } catch (e) {}
  };
  // Unified entry point: server job when cloud mode is on, browser runner otherwise
  const startScan = (agentIds, tickers) => {
    if (useMainSessionRef.current) return enqueueJob(agentIds, tickers);
    return runAgentQueue(agentIds, tickers);
  };

  // Main Session (cloud) - one canonical session in KV, synced across devices
  const [useMainSession, setUseMainSession] = useState(true);
  const useMainSessionRef = React.useRef(true);
  useEffect(() => {
    try { const v = localStorage.getItem('singularityhunter_use_cloud'); if (v !== null) { setUseMainSession(v === '1'); useMainSessionRef.current = v === '1'; } } catch (e) {}
  }, []);
  const toggleMainSession = () => setUseMainSession(prev => {
    const next = !prev; useMainSessionRef.current = next;
    try { localStorage.setItem('singularityhunter_use_cloud', next ? '1' : '0'); } catch (e) {}
    return next;
  });
  const [universeMeta, setUniverseMeta] = useState(null);
  const [isRefreshingData, setIsRefreshingData] = useState(false);
  const lastCloudSyncRef = React.useRef(0);

  const syncMainToCloud = (force = false) => {
    if (!useMainSessionRef.current) return;
    const now = Date.now();
    if (!force && now - lastCloudSyncRef.current < 60000) return;
    lastCloudSyncRef.current = now;
    try {
      fetch('/api/main-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stocks: stocksRef.current, weights, aiWeights }),
      }).catch(() => {});
    } catch (e) {}
  };

  const refreshMarketData = async () => {
    if (isRefreshingData) return;
    setIsRefreshingData(true);
    setStatus({ type: 'loading', msg: 'Refreshing market data (universe, prices, insiders)...' });
    try {
      for (let hop = 0; hop < 12; hop++) {
        const res = await fetch('/api/refresh', { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || res.status);
        if (data.running) { await new Promise(r => setTimeout(r, 15000)); continue; }
        setStatus({ type: 'loading', msg: `Refreshing market data... stage: ${data.now_at_stage}` });
        if (data.done) break;
      }
      const meta = await fetch('/api/main-session').then(r => r.json()).catch(() => null);
      if (meta?.universe_meta) setUniverseMeta(meta.universe_meta);
      if (meta?.session && useMainSessionRef.current) {
        stocksRef.current = calcScores(meta.session.stocks, weights, aiWeights);
        setStocks(stocksRef.current);
        setCurrentSessionId('main');
        sessionIdRef.current = 'main';
      }
      setStatus({ type: 'live', msg: 'Market data refreshed' });
    } catch (e) {
      setError(`Data refresh failed: ${e.message}`);
      setStatus({ type: 'error', msg: 'Refresh failed' });
    }
    setIsRefreshingData(false);
  };
  const [agentScanCount, setAgentScanCount] = useState(25);
  const [isComputingMetrics, setIsComputingMetrics] = useState(false);
  const [resumeBanner, setResumeBanner] = useState(null);
  const [openScanGroup, setOpenScanGroup] = useState(null);

  // Table column visibility (scan-score columns toggleable via Columns menu)
  const DEFAULT_COLS = { netCash: true, insider: true, sg: true, vl: true, cv: true, ch: true, te: true, low52: true, mo: true, by: true, ld: true, pk: true };
  const [colVisible, setColVisible] = useState(DEFAULT_COLS);
  const [showColumnsMenu, setShowColumnsMenu] = useState(false);
  useEffect(() => { try { const saved = JSON.parse(localStorage.getItem('singularityhunter_columns') || 'null'); if (saved) setColVisible(prev => ({ ...prev, ...saved })); } catch (e) {} }, []);
  const toggleColumn = (key) => setColVisible(prev => { const next = { ...prev, [key]: !prev[key] }; try { localStorage.setItem('singularityhunter_columns', JSON.stringify(next)); } catch (e) {} return next; });
  const COLUMN_LABELS = { netCash: 'Net Cash', insider: 'Insider', sg: 'Singularity', vl: 'Valuation', cv: 'Conviction', ch: 'Cup & Handle', te: 'Technical Opinion', low52: '% From 52w Low', mo: 'Momentum', by: 'Buyout', ld: 'Leadership', pk: 'Playbook' };
  const NEW_SCORE_COLS = [
    { key: 'te', field: 'techScore', label: 'Te', title: 'Technical Opinion - % of 13 Barchart-style indicators on Buy (free, computed)', color: '#22d3ee' },
    { key: 'mo', field: 'momentumScore', label: 'Mo', title: 'Momentum (chart + continuation + parabolic potential)', color: '#fb923c' },
    { key: 'by', field: 'buyoutScore', label: 'By', title: 'Buyout likelihood (people + intent + buzz + fit)', color: '#fbbf24' },
    { key: 'ld', field: 'leadershipScore', label: 'Ld', title: 'Leadership (CEO + team + public presence + vibes)', color: '#f472b6' },
    { key: 'pk', field: 'playbookScore', label: 'Pk', title: 'Playbook match (best of your winning setups)', color: '#a78bfa' },
  ];

  const AGENT_ICONS = { conviction: Sparkles, technical: Activity, valuation: DollarSign, momentum: Flame, buyout: Banknote, leadership: Users, playbook: Target };
  const AGENT_REGISTRY = AGENT_DEFS.map(d => ({
    ...d,
    group: 'core',
    icon: AGENT_ICONS[d.id] || Sparkles,
    fn: d.id === 'playbook' ? (s, m) => d.fn(s, m, { playbooks: playbooksRef.current }) : d.fn,
  }));

  const CHECKPOINT_KEY = 'singularityhunter_scan_checkpoint';
  const persistCheckpoint = (data) => { try { localStorage.setItem(CHECKPOINT_KEY, JSON.stringify({ ...data, ts: Date.now() })); } catch (e) {} };
  const clearCheckpoint = () => { try { localStorage.removeItem(CHECKPOINT_KEY); } catch (e) {} };

  const persistProgressToSession = (sid) => {
    try {
      saveSession(sid, stocksRef.current, { phase: 'in-progress', current: 0, total: 0, found: stocksRef.current.length }, 'Main Session');
    } catch (e) {}
    syncMainToCloud();
  };

  // Runs each agent over the ticker list sequentially, checkpointing after
  // every stock so a page refresh (or deploy) can resume where it left off.
  const runAgentQueue = async (agentIds, tickers, completedMap = {}, opts = {}) => {
    const agents = AGENT_REGISTRY.filter(a => agentIds.includes(a.id));
    if (agents.length === 0 || tickers.length === 0) return;
    const model = opts.model || grokModel;
    const sid = 'main';
    if (!sessionIdRef.current) { sessionIdRef.current = sid; setCurrentSessionId(sid); }
    setIsAnalyzingAI(true);
    setError(null);

    scanControlRef.current = null;
    outer: for (const agent of agents) {
      const doneSet = new Set(completedMap[agent.id] || []);
      const remaining = tickers.filter(t => !doneSet.has(t));
      if (remaining.length === 0) continue;
      setAgentRunning(agent.id);
      if (opts.setPhase) setFullSpectrumPhase(`Running ${agent.label} Scan...`);

      for (let i = 0; i < remaining.length; i++) {
        if (scanControlRef.current) break outer;
        const ticker = remaining[i];
        const idx = tickers.length - remaining.length + i + 1;
        setAiProgress({ current: idx, total: tickers.length });
        setStatus({ type: 'loading', msg: `${agent.label}: ${ticker} (${idx}/${tickers.length})...` });

        const stock = stocksRef.current.find(s => s.ticker === ticker);
        if (stock) {
          const result = await agent.fn(stock, model);
          stocksRef.current = stocksRef.current.map(s => (s.ticker === ticker ? agent.apply(s, result) : s));
          setStocks(prev => prev.map(s => (s.ticker === ticker ? agent.apply(s, result) : s)));
        }

        doneSet.add(ticker);
        completedMap[agent.id] = [...doneSet];
        // Save results BEFORE marking the stock complete in the checkpoint,
        // so a refresh can never lose a scanned stock
        persistProgressToSession(sid);
        persistCheckpoint({ kind: 'agents', agentIds, tickers, completed: completedMap, model });

        if (i < remaining.length - 1) await new Promise(r => setTimeout(r, 1200));
      }
    }

    stocksRef.current = calcScores(stocksRef.current, weights, aiWeights);
    setStocks(stocksRef.current);
    persistProgressToSession(sid);
    setSessions(getAllSessions());
    setAgentRunning(null);
    setIsAnalyzingAI(false);
    setAiProgress({ current: 0, total: 0 });

    const control = scanControlRef.current;
    scanControlRef.current = null;
    if (control === 'cancel') {
      clearCheckpoint();
      setPausedRun(null);
      setStatus({ type: 'live', msg: 'Scan cancelled' });
      return 'cancelled';
    }
    if (control === 'pause') {
      const doneCount = Object.values(completedMap).reduce((a, arr) => a + arr.length, 0);
      persistCheckpoint({ kind: 'agents', agentIds, tickers, completed: completedMap, model, paused: true });
      setPausedRun({ agentIds, tickers, completed: completedMap, model });
      setStatus({ type: 'cached', msg: `Scan paused (${doneCount}/${agentIds.length * tickers.length} steps done)` });
      return 'paused';
    }
    clearCheckpoint();
    setPausedRun(null);
    syncMainToCloud(true);
    setStatus({ type: 'live', msg: `${agents.map(a => a.label).join(' + ')} scan complete` });
    return 'done';
  };

  const getCurrentView = () => [...stocksRef.current]
    .filter(s => matchesCategory(s, sectorFilter))
    .filter(s => !filters.hideNetCashNegative || (s.netCash !== null && s.netCash >= 0))
    .filter(s => (s.singularityScore || 0) >= filters.minSingularityScore)
    .filter(s => singularityGate === 0 || (s.singularityScore || 0) >= singularityGate)
    .filter(s => !filters.excludeBanks || !s.isBank)
    .filter(s => !filters.excludeFood || !s.isFood)
    .filter(s => !filters.excludeHealthcare || !s.isHealthcare)
    .filter(s => !filters.excludeInsurance || !s.isInsurance)
    .filter(s => !filters.excludeREIT || !s.isREIT)
    .sort((a, b) => b.compositeScore - a.compositeScore);

  const launchAgentScan = (agent) => {
    setOpenScanGroup(null);
    let pool;
    if (agent.pool === 'gainers') {
      pool = [...stocksRef.current]
        .filter(s => s.change >= topGainersThreshold)
        .filter(s => singularityGate === 0 || (s.singularityScore || 0) >= singularityGate)
        .sort((a, b) => (b.change || 0) - (a.change || 0));
      if (pool.length === 0) { setError(`No stocks with ${topGainersThreshold}%+ gains${singularityGate > 0 ? ` and Singularity ≥ ${singularityGate}` : ''}. Try lowering threshold.`); return; }
    } else {
      pool = getCurrentView();
      if (pool.length === 0) { setError(singularityGate > 0 ? `No stocks with Singularity Score ≥ ${singularityGate}. Run Singularity scan first or lower the gate.` : 'No stocks to scan. Run a base scan first.'); return; }
    }
    const count = agentScanCount === 0 ? pool.length : Math.min(agentScanCount, pool.length);
    startScan([agent.id], pool.slice(0, count).map(s => s.ticker));
  };

  const runComputedMetricsScan = async (label) => {
    setOpenScanGroup(null);
    const pool = getCurrentView();
    if (pool.length === 0) { setError('No stocks to compute metrics for. Run a base scan first.'); return; }
    setIsComputingMetrics(true);
    setError(null);
    try {
      const metrics = await computeMarketMetrics(pool, (done, total) => setStatus({ type: 'loading', msg: `${label}: ${done}/${total} stocks...` }));
      stocksRef.current = stocksRef.current.map(s => (metrics[s.ticker] ? { ...s, ...metrics[s.ticker] } : s));
      stocksRef.current = calcScores(stocksRef.current, weights, aiWeights);
      setStocks(stocksRef.current);
      if (sessionIdRef.current) persistProgressToSession(sessionIdRef.current);
      setStatus({ type: 'live', msg: `${label} complete (${pool.length} stocks)` });
    } catch (e) {
      setError(`${label} failed: ${e.message}`);
    }
    setIsComputingMetrics(false);
  };

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

    // Load the cloud Main Session (overrides local cache when enabled)
    (async () => {
      try {
        if (localStorage.getItem('singularityhunter_use_cloud') === '0') return;
        if (localStorage.getItem(CHECKPOINT_KEY)) return; // don't clobber a resumable scan
        const res = await fetch('/api/main-session');
        if (!res.ok) return;
        const data = await res.json();
        if (data.universe_meta) setUniverseMeta(data.universe_meta);
        if (!data.session || !Array.isArray(data.session.stocks) || data.session.stocks.length === 0) {
          // No cloud session yet - seed it from the local one
          setTimeout(() => { if (stocksRef.current.length > 0) syncMainToCloud(true); }, 3000);
        }
        if (data.session && Array.isArray(data.session.stocks) && data.session.stocks.length > 0) {
          stocksRef.current = calcScores(data.session.stocks, weights, aiWeights);
          setStocks(stocksRef.current);
          setCurrentSessionId('main');
          sessionIdRef.current = 'main';
          setLastUpdate(new Date(data.session.timestamp));
          setCacheAge(Date.now() - data.session.timestamp);
          setStatus({ type: 'cached', msg: `${data.session.stocks.length} stocks (Main Session)` });
        }
      } catch (e) {}
    })();

    // Resume an interrupted agent scan (refresh/deploy mid-scan)
    try {
      const cp = JSON.parse(localStorage.getItem(CHECKPOINT_KEY) || 'null');
      if (cp && cp.kind === 'agents' && cp.tickers?.length && cp.agentIds?.length) {
        const doneCount = Object.values(cp.completed || {}).reduce((a, arr) => a + arr.length, 0);
        const totalCount = cp.agentIds.length * cp.tickers.length;
        if (doneCount < totalCount && cp.paused) {
          // User paused this scan - offer Resume instead of auto-starting
          setPausedRun({ agentIds: cp.agentIds, tickers: cp.tickers, completed: cp.completed || {}, model: cp.model });
          setStatus({ type: 'cached', msg: `Scan paused (${doneCount}/${totalCount} steps done)` });
        } else if (doneCount < totalCount) {
          setResumeBanner(`Resuming interrupted scan - ${doneCount}/${totalCount} steps already done. Starting in a moment...`);
          resumeTimerRef.current = setTimeout(() => {
            setResumeBanner(null);
            runAgentQueue(cp.agentIds, cp.tickers, cp.completed || {}, { model: cp.model });
          }, 2500);
        } else {
          localStorage.removeItem(CHECKPOINT_KEY);
        }
      }
    } catch (e) {}
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

  // Add a stock to another session
  const addStockToSession = (stock, targetSessionId) => {
    const targetSession = loadSession(targetSessionId);
    if (!targetSession) return;
    
    // Check if stock already exists in target session
    if (targetSession.stocks.some(s => s.ticker === stock.ticker)) {
      setStatus({ type: 'ready', msg: `${stock.ticker} already in ${targetSession.name}` });
      return;
    }
    
    // Add stock to target session
    const updatedStocks = [...targetSession.stocks, stock];
    saveSession(targetSessionId, { ...targetSession, stocks: updatedStocks });
    
    // Refresh sessions list
    setSessions(getAllSessions());
    setStatus({ type: 'live', msg: `Added ${stock.ticker} to ${targetSession.name}` });
    setShowStockPicker(null);
  };

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
  // Explosive Growth Analysis - Singularity contract/demand potential
  const runExplosiveGrowthAnalysis = async (stocksInOrder) => {
    if (stocks.length === 0) return;
    
    setIsAnalyzingExplosive(true);
    setError(null);
    
    const orderedStocks = stocksInOrder || stocks;
    const countToAnalyze = explosiveCount === 0 ? orderedStocks.length : Math.min(explosiveCount, orderedStocks.length);
    const stocksToAnalyze = orderedStocks.slice(0, countToAnalyze);
    setExplosiveProgress({ current: 0, total: stocksToAnalyze.length });
    
    for (let i = 0; i < stocksToAnalyze.length; i++) {
      setExplosiveProgress({ current: i + 1, total: stocksToAnalyze.length });
      setStatus({ type: 'loading', msg: `Explosive Growth: ${stocksToAnalyze[i].ticker} (${i + 1}/${stocksToAnalyze.length})...` });
      
      const result = await getExplosiveGrowthAnalysis(stocksToAnalyze[i], grokModel);
      
      // Update stocks in state directly to allow parallel scans
      setStocks(prev => prev.map(s => 
        s.ticker === stocksToAnalyze[i].ticker ? { 
          ...s, 
          explosiveAnalysis: result.explosiveAnalysis,
          explosiveScore: result.explosiveScore
        } : s
      ));
      
      if (i < stocksToAnalyze.length - 1) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }
    
    setIsAnalyzingExplosive(false);
    setExplosiveProgress({ current: 0, total: 0 });
    setStatus({ type: 'live', msg: `${stocks.length} stocks • Explosive Growth scan complete` });
  };

  // Team Analysis - Management evaluation
  const runTeamAnalysis = async (stocksInOrder) => {
    if (stocks.length === 0) return;
    
    setIsAnalyzingTeam(true);
    setError(null);
    
    const orderedStocks = stocksInOrder || stocks;
    const countToAnalyze = teamCount === 0 ? orderedStocks.length : Math.min(teamCount, orderedStocks.length);
    const stocksToAnalyze = orderedStocks.slice(0, countToAnalyze);
    setTeamProgress({ current: 0, total: stocksToAnalyze.length });
    
    for (let i = 0; i < stocksToAnalyze.length; i++) {
      setTeamProgress({ current: i + 1, total: stocksToAnalyze.length });
      setStatus({ type: 'loading', msg: `Team Analysis: ${stocksToAnalyze[i].ticker} (${i + 1}/${stocksToAnalyze.length})...` });
      
      const result = await getTeamAnalysis(stocksToAnalyze[i], grokModel);
      
      // Update stocks in state directly to allow parallel scans
      setStocks(prev => prev.map(s => 
        s.ticker === stocksToAnalyze[i].ticker ? { 
          ...s, 
          teamAnalysis: result.teamAnalysis,
          teamScore: result.teamScore
        } : s
      ));
      
      if (i < stocksToAnalyze.length - 1) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }
    
    setIsAnalyzingTeam(false);
    setTeamProgress({ current: 0, total: 0 });
    setStatus({ type: 'live', msg: `${stocks.length} stocks • Team Analysis complete` });
  };

  // Parabolic Continuation Analysis - for top gainers
  const runParabolicAnalysis = async (stocksInOrder) => {
    if (stocks.length === 0) return;
    
    setIsAnalyzingParabolic(true);
    setError(null);
    
    const orderedStocks = stocksInOrder || stocks;
    const countToAnalyze = parabolicCount === 0 ? orderedStocks.length : Math.min(parabolicCount, orderedStocks.length);
    const stocksToAnalyze = orderedStocks.slice(0, countToAnalyze);
    setParabolicProgress({ current: 0, total: stocksToAnalyze.length });
    
    for (let i = 0; i < stocksToAnalyze.length; i++) {
      setParabolicProgress({ current: i + 1, total: stocksToAnalyze.length });
      setStatus({ type: 'loading', msg: `Parabolic: ${stocksToAnalyze[i].ticker} (${i + 1}/${stocksToAnalyze.length})...` });
      
      const result = await getParabolicAnalysis(stocksToAnalyze[i], grokModel);
      
      // Update stocks in state directly to allow parallel scans
      setStocks(prev => prev.map(s => 
        s.ticker === stocksToAnalyze[i].ticker ? { 
          ...s, 
          parabolicAnalysis: result.parabolicAnalysis,
          parabolicScore: result.parabolicScore
        } : s
      ));
      
      if (i < stocksToAnalyze.length - 1) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }
    
    setIsAnalyzingParabolic(false);
    setParabolicProgress({ current: 0, total: 0 });
    setStatus({ type: 'live', msg: `${stocks.length} stocks • Parabolic scan complete` });
  };

  // Valuation Analysis - Under/Overvalued Assessment
  const runValuationAnalysis = async (stocksInOrder) => {
    if (stocks.length === 0) return;
    
    setIsAnalyzingValuation(true);
    setError(null);
    
    const orderedStocks = stocksInOrder || stocks;
    const countToAnalyze = valuationCount === 0 ? orderedStocks.length : Math.min(valuationCount, orderedStocks.length);
    const stocksToAnalyze = orderedStocks.slice(0, countToAnalyze);
    setValuationProgress({ current: 0, total: stocksToAnalyze.length });
    
    for (let i = 0; i < stocksToAnalyze.length; i++) {
      setValuationProgress({ current: i + 1, total: stocksToAnalyze.length });
      setStatus({ type: 'loading', msg: `Valuation: ${stocksToAnalyze[i].ticker} (${i + 1}/${stocksToAnalyze.length})...` });
      
      const result = await getValuationAnalysis(stocksToAnalyze[i], grokModel);
      
      // Update stocks in state directly to allow parallel scans
      setStocks(prev => prev.map(s => 
        s.ticker === stocksToAnalyze[i].ticker ? { 
          ...s, 
          valuationAnalysis: result.valuationAnalysis,
          valuationScore: result.valuationScore
        } : s
      ));
      
      if (i < stocksToAnalyze.length - 1) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }
    
    setIsAnalyzingValuation(false);
    setValuationProgress({ current: 0, total: 0 });
    setStatus({ type: 'live', msg: `${stocks.length} stocks • Valuation scan complete` });
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
      
      // Use functional update to preserve other scan results
      setStocks(prev => prev.map(s => {
        const updated = updatedStocks.find(u => u.ticker === s.ticker);
        if (updated) {
          return {
            ...s,
            preMarketChange: updated.preMarketChange,
            afterHoursChange: updated.afterHoursChange,
            preMarketPrice: updated.preMarketPrice,
            afterHoursPrice: updated.afterHoursPrice
          };
        }
        return s;
      }));
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
    
    // Get current stock list at start
    const stocksToRefresh = [...stocks];
    
    for (let i = 0; i < stocksToRefresh.length; i++) {
      const stock = stocksToRefresh[i];
      setScanProgress({ phase: 'Refreshing prices...', current: i + 1, total: stocksToRefresh.length, found: stocksToRefresh.length });
      setStatus({ type: 'loading', msg: `Refreshing ${stock.ticker}... (${i + 1}/${stocksToRefresh.length})` });
      
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
          
          // Use functional update to preserve other scan results
          setStocks(prev => prev.map(s => 
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
          ));
        }
      } catch (e) {
        console.error(`Failed to refresh ${stock.ticker}:`, e);
      }
      
      // Small delay to avoid rate limiting
      if (i < stocksToRefresh.length - 1 && i % 5 === 4) {
        await new Promise(r => setTimeout(r, 200));
      }
    }
    
    // Recalculate scores using functional update
    setStocks(prev => calcScores(prev, weights, aiWeights));
    
    // Save to session
    setStocks(prev => {
      if (currentSessionId) {
        const scanStats = { phase: 'complete', current: prev.length, total: prev.length, found: prev.length };
        saveSession(currentSessionId, prev, scanStats);
        setSessions(getAllSessions());
      }
      return prev;
    });
    
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
      // Recalculate scores for all stocks including new ones using functional update
      setStocks(prev => {
        const allStocks = [...prev, ...newStocks];
        return calcScores(allStocks, weights, aiWeights);
      });
      setStatus({ type: 'live', msg: `Added ${newStocks.length} stocks` });
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
        case 'explosive':
          return { ...s, explosiveAnalysis: null, explosiveScore: null };
        case 'team':
          return { ...s, teamAnalysis: null, teamScore: null };
        case 'parabolic':
          return { ...s, parabolicAnalysis: null, parabolicScore: null };
        case 'valuation':
          return { ...s, valuationAnalysis: null, valuationScore: null };
        case 'technical':
          return { ...s, technicalAnalysis: null, cupHandleScore: null };
        case 'singularity':
          return { ...s, singularityScore: null, isBank: false, isFood: false, isHealthcare: false, isInsurance: false, isREIT: false };
        case 'all':
          return { 
            ...s, 
            aiAnalysis: null, 
            insiderConviction: null,
            explosiveAnalysis: null, 
            explosiveScore: null,
            teamAnalysis: null,
            teamScore: null,
            parabolicAnalysis: null,
            parabolicScore: null,
            valuationAnalysis: null,
            valuationScore: null,
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
    
    for (let i = 0; i < stockList.length; i++) {
      setOracleProgress({ current: i + 1, total: stockList.length });
      setStatus({ type: 'loading', msg: `Oracle analyzing ${stockList[i].ticker} (${i + 1}/${stockList.length})...` });
      
      const result = await getOracleAnalysis(stockList[i]);
      
      // Use functional update to preserve other scan results
      setStocks(prev => prev.map(s => 
        s.ticker === stockList[i].ticker ? { 
          ...s, 
          oracleAnalysis: result.oracleAnalysis,
          prediction: result.prediction,
          oracleConviction: result.oracleConviction,
          targetTimeframe: result.targetTimeframe,
          tenXThesis: result.tenXThesis
        } : s
      ));
      
      if (i < stockList.length - 1) {
        await new Promise(r => setTimeout(r, 2500));
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
    const newSessionId = 'main';
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
      // Toggle OFF = scan every market cap; ON = user's custom range
      const minMC = globalSettings.useCustomMarketCap ? globalSettings.minMarketCap * 1_000_000 : 0;
      const maxMC = globalSettings.useCustomMarketCap ? globalSettings.maxMarketCap * 1_000_000 : Infinity;
      
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
      const sessionName = 'Main Session';
      saveSession(newSessionId, scoredStocks, scanStats, sessionName);
      syncMainToCloud(true);
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
      const newSessionId = 'main';
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
      // Toggle OFF = scan every market cap; ON = user's custom range
      const minMC = globalSettings.useCustomMarketCap ? globalSettings.minMarketCap * 1_000_000 : 0;
      const maxMC = globalSettings.useCustomMarketCap ? globalSettings.maxMarketCap * 1_000_000 : Infinity;
      
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

      // Persist base-scan results immediately so a refresh mid-spectrum
      // doesn't lose them
      sessionIdRef.current = newSessionId;
      saveSession(newSessionId, currentStocks, scanStats, 'Main Session');
      setSessions(getAllSessions());
      
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
      
      // Phase 2.5: computed momentum + volatility metrics (free, no AI calls)
      if (spectrumSettings.computedEnabled !== false && currentStocks.length > 0) {
        setFullSpectrumPhase('Computing Momentum & Volatility Data...');
        try {
          const metrics = await computeMarketMetrics(currentStocks, (done, total) => setStatus({ type: 'loading', msg: `Full Spectrum: market metrics ${done}/${total}...` }));
          currentStocks = currentStocks.map(s => (metrics[s.ticker] ? { ...s, ...metrics[s.ticker] } : s));
          stocksRef.current = currentStocks;
          setStocks(currentStocks);
        } catch (e) {
          console.error('Computed metrics phase failed:', e);
        }
      }

      // Phase 3: AI agent scans via the generic checkpointing runner -
      // every enabled agent runs over the same top-N pool, one at a time.
      const spectrumAgentIds = [
        spectrumSettings.grokEnabled && 'conviction',
        spectrumSettings.technicalEnabled && 'technical',
        spectrumSettings.valuationEnabled && 'valuation',
        spectrumSettings.momentumEnabled && 'momentum',
        spectrumSettings.buyoutEnabled && 'buyout',
        spectrumSettings.leadershipEnabled && 'leadership',
        spectrumSettings.playbookEnabled && 'playbook',
      ].filter(Boolean);

      if (spectrumAgentIds.length > 0 && currentStocks.length > 0) {
        let stocksPool = [...currentStocks];
        if (singularityGate > 0) stocksPool = stocksPool.filter(s => (s.singularityScore || 0) >= singularityGate);
        if (spectrumSettings.grokOnlySingularity70) stocksPool = stocksPool.filter(s => (s.singularityScore || 0) >= 70);

        if (stocksPool.length === 0) {
          console.log('No stocks qualify for AI agent scans');
        } else {
          const countToAnalyze = spectrumSettings.grokCount === 0 ? stocksPool.length : Math.min(spectrumSettings.grokCount, stocksPool.length);
          const tickers = stocksPool.slice(0, countToAnalyze).map(s => s.ticker);
          let runResult;
          if (useMainSessionRef.current) {
            // Hand the AI phase to the server worker - it keeps running even if
            // this tab is closed. Results stream into the table as they land.
            syncMainToCloud(true);
            await new Promise(r => setTimeout(r, 1500));
            await enqueueJob(spectrumAgentIds, tickers);
            runResult = 'queued';
          } else {
            runResult = await runAgentQueue(spectrumAgentIds, tickers, {}, { setPhase: true });
          }
          currentStocks = stocksRef.current;
          if (runResult === 'cancelled' || runResult === 'paused') {
            // Save what we have and stop the spectrum here
            saveSession(newSessionId, currentStocks, scanStats, 'Main Session');
            setSessions(getAllSessions());
            setIsRunningFullSpectrum(false);
            setFullSpectrumPhase('');
            return;
          }
        }
      } else {
        console.log('Skipping AI agent scans - none enabled or no stocks');
      }
      
      // Save final session
      const finalScanStats = { phase: 'complete', current: allTickers.length, total: allTickers.length, found: currentStocks.length };
      const sessionName = 'Main Session';
      saveSession(newSessionId, currentStocks, finalScanStats, sessionName);
      syncMainToCloud(true);
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
    // Filter by top gainers (previous day change)
    .filter(s => !showTopGainers || (s.change >= topGainersThreshold))
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
      if (sortBy === 'change') return (b.change || 0) - (a.change || 0); // Sort by daily change
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
      if (sortBy === 'explosiveScore') {
        return (b.explosiveScore ?? -1) - (a.explosiveScore ?? -1);
      }
      if (sortBy === 'teamScore') {
        return (b.teamScore ?? -1) - (a.teamScore ?? -1);
      }
      if (sortBy === 'parabolicScore') {
        return (b.parabolicScore ?? -1) - (a.parabolicScore ?? -1);
      }
      if (sortBy === 'valuationScore') {
        return (b.valuationScore ?? -1) - (a.valuationScore ?? -1);
      }
      if (['techScore','momentumScore','buyoutScore','leadershipScore','playbookScore'].includes(sortBy)) {
        return (b[sortBy] ?? -1) - (a[sortBy] ?? -1);
      }
      if (sortBy === 'fromLow') {
        // Ascending - lowest % from 52w low first (closest to bottom)
        return (a.fromLow ?? 999) - (b.fromLow ?? 999);
      }
      if (sortBy === 'fromLowDesc') {
        // Descending - highest % from 52w low first (furthest from bottom)
        return (b.fromLow ?? -1) - (a.fromLow ?? -1);
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
            <a href="/swing" className="ml-4 px-3 py-1.5 rounded-lg text-xs font-medium border" style={{ background: 'rgba(30,41,59,0.5)', borderColor: 'rgba(51,65,85,0.5)', color: '#94a3b8' }} title="Your trade history - positions, executions, realized P&L">Swing Trade Hunter ↗</a>
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

            {/* Scan pause / cancel / resume controls */}
            {isAnalyzingAI && (
              <>
                <button onClick={() => { scanControlRef.current = 'pause'; setStatus({ type: 'loading', msg: 'Pausing after current stock...' }); }} className="px-3 py-2 rounded-lg text-xs font-semibold border flex items-center gap-1.5" style={{ background: 'rgba(245,158,11,0.12)', borderColor: 'rgba(245,158,11,0.4)', color: '#fbbf24' }}>
                  <Clock className="w-3.5 h-3.5" />Pause
                </button>
                <button onClick={() => { scanControlRef.current = 'cancel'; setStatus({ type: 'loading', msg: 'Cancelling after current stock...' }); }} className="px-3 py-2 rounded-lg text-xs font-semibold border flex items-center gap-1.5" style={{ background: 'rgba(239,68,68,0.12)', borderColor: 'rgba(239,68,68,0.4)', color: '#f87171' }}>
                  <X className="w-3.5 h-3.5" />Cancel
                </button>
              </>
            )}
            {!isAnalyzingAI && pausedRun && (
              <>
                <button onClick={() => { const pr = pausedRun; setPausedRun(null); runAgentQueue(pr.agentIds, pr.tickers, pr.completed, { model: pr.model }); }} className="px-3 py-2 rounded-lg text-xs font-semibold border flex items-center gap-1.5" style={{ background: 'rgba(16,185,129,0.12)', borderColor: 'rgba(16,185,129,0.4)', color: '#34d399' }}>
                  <Play className="w-3.5 h-3.5" />Resume Scan
                </button>
                <button onClick={() => { clearCheckpoint(); setPausedRun(null); setStatus({ type: 'live', msg: 'Paused scan discarded' }); }} className="px-3 py-2 rounded-lg text-xs font-semibold border flex items-center gap-1.5" style={{ background: 'rgba(239,68,68,0.12)', borderColor: 'rgba(239,68,68,0.4)', color: '#f87171' }}>
                  <X className="w-3.5 h-3.5" />Discard
                </button>
              </>
            )}
            
            {/* Research Feed Button */}
            <div className="relative">
              <button onClick={openResearch} className="px-4 py-2.5 rounded-xl text-sm font-medium border flex items-center gap-2" style={{ background: showResearch ? 'rgba(167,139,250,0.2)' : 'rgba(30,41,59,0.5)', borderColor: 'rgba(51,65,85,0.5)', color: showResearch ? '#a78bfa' : '#94a3b8' }}>
                <Radar className="w-4 h-4" />Research
                {unreadResearch > 0 && <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold" style={{ background: 'rgba(167,139,250,0.25)', color: '#c4b5fd' }}>{unreadResearch}</span>}
              </button>
              {showResearch && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowResearch(false)} />
                  <div className="absolute right-0 top-full mt-2 w-[420px] max-h-[70vh] overflow-y-auto rounded-xl border p-3 z-50" style={{ background: 'rgba(15,23,42,0.98)', borderColor: 'rgba(51,65,85,0.7)', boxShadow: '0 12px 32px rgba(0,0,0,0.5)' }}>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <p className="text-xs uppercase tracking-wide text-slate-500 font-semibold">Research Team Feed</p>
                      <div className="flex items-center gap-2">
                        <select value={researchConfig.n} onChange={e => saveResearchConfig({ ...researchConfig, n: parseInt(e.target.value) })} className="rounded px-1.5 py-1 text-[11px] border outline-none" style={{ background: 'rgba(30,41,59,0.8)', borderColor: 'rgba(51,65,85,0.5)', color: '#94a3b8' }} title="How many top stocks the daily research pass watches">
                          <option value={5}>Top 5</option>
                          <option value={10}>Top 10</option>
                          <option value={25}>Top 25</option>
                        </select>
                        <button onClick={runResearchNow} disabled={isRunningResearch} className="px-2.5 py-1 rounded-lg text-[11px] font-semibold border flex items-center gap-1" style={{ background: 'rgba(167,139,250,0.12)', borderColor: 'rgba(167,139,250,0.4)', color: '#a78bfa', opacity: isRunningResearch ? 0.6 : 1 }}>
                          {isRunningResearch ? <><RefreshCw className="w-3 h-3 animate-spin" />Working...</> : 'Run pass now'}
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <p className="text-[10px] text-slate-600">Watchlist: {Object.keys(watchlist).length} stocks (scout finds + your ★). Monitored daily for new info - suggestions only, never touches your scores.</p>
                      <button onClick={runScoutsNow} disabled={isRunningScouts} className="shrink-0 px-2.5 py-1 rounded-lg text-[11px] font-semibold border flex items-center gap-1" style={{ background: 'rgba(34,211,238,0.12)', borderColor: 'rgba(34,211,238,0.4)', color: '#67e8f9', opacity: isRunningScouts ? 0.6 : 1 }} title="Run the value / momentum / social scouts now">
                        {isRunningScouts ? <><RefreshCw className="w-3 h-3 animate-spin" />Scouting...</> : 'Run scouts'}
                      </button>
                    </div>
                    {scoutsLatest && (
                      <div className="mb-2 p-2 rounded-lg border text-[11px]" style={{ background: 'rgba(34,211,238,0.05)', borderColor: 'rgba(34,211,238,0.2)' }}>
                        <span className="text-cyan-300 font-semibold">Last scout pass</span> <span className="text-slate-500">{new Date(scoutsLatest.ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                        <span className="text-slate-400"> - value {scoutsLatest.counts?.value || 0}, momentum {scoutsLatest.counts?.momentum || 0}, social {scoutsLatest.counts?.social || 0} candidates</span>
                        {scoutsLatest.added?.length > 0 && <span className="text-emerald-400"> - added: {scoutsLatest.added.join(', ')}</span>}
                      </div>
                    )}
                    {researchFeed.length === 0 && <p className="text-xs text-slate-500 py-4 text-center">No findings yet. The daily pass runs automatically, or hit "Run pass now".</p>}
                    {researchFeed.slice(0, 60).map((f, i) => {
                      const sigColor = f.significance >= 70 ? '#f87171' : f.significance >= 40 ? '#fbbf24' : '#64748b';
                      const agent = AGENT_REGISTRY.find(a => a.id === f.suggest);
                      return (
                        <div key={i} className="mb-2 p-2.5 rounded-lg border" style={{ background: 'rgba(30,41,59,0.4)', borderColor: f.ts > feedViewedAt ? 'rgba(167,139,250,0.4)' : 'rgba(51,65,85,0.4)' }}>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="mono font-bold text-sm text-slate-100">{f.ticker}</span>
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ background: sigColor + '22', color: sigColor }}>sig {f.significance}</span>
                            <span className="text-[10px] text-slate-600 ml-auto">{new Date(f.ts).toLocaleDateString()} {new Date(f.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                          <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">{f.summary}</p>
                          {agent && f.significance >= 40 && (
                            <button onClick={() => { setShowResearch(false); startScan([agent.id], [f.ticker]); }} className="mt-1.5 px-2 py-1 rounded text-[10px] font-semibold border" style={{ borderColor: agent.color + '66', color: agent.color }}>
                              Re-run {agent.label} on {f.ticker}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
            
            <button onClick={() => setShowDiscovery(!showDiscovery)} className="px-4 py-2.5 rounded-xl text-sm font-medium border flex items-center gap-2" style={{ background: showDiscovery ? 'rgba(16,185,129,0.2)' : 'rgba(30,41,59,0.5)', borderColor: 'rgba(51,65,85,0.5)', color: showDiscovery ? '#6ee7b7' : '#94a3b8' }}><Radar className="w-4 h-4" />Discovery</button>
            <button onClick={() => setShowWeights(!showWeights)} className="px-4 py-2.5 rounded-xl text-sm font-medium border flex items-center gap-2" style={{ background: showWeights ? 'rgba(245,158,11,0.2)' : 'rgba(30,41,59,0.5)', borderColor: 'rgba(51,65,85,0.5)', color: showWeights ? '#fcd34d' : '#94a3b8' }}><Sliders className="w-4 h-4" />Weights</button>
            <button onClick={() => setShowSettings(!showSettings)} className="px-4 py-2.5 rounded-xl text-sm font-medium border flex items-center gap-2" style={{ background: showSettings ? 'rgba(236,72,153,0.2)' : 'rgba(30,41,59,0.5)', borderColor: 'rgba(51,65,85,0.5)', color: showSettings ? '#f472b6' : '#94a3b8' }}><Sliders className="w-4 h-4" />Settings</button>
            
            {stocks.length > 0 && (
              <>
                {/* Singularity Gate indicator */}
                {singularityGate > 0 && (
                  <div 
                    className="px-2.5 py-1.5 rounded-lg text-xs font-medium border flex items-center gap-1.5 cursor-pointer"
                    style={{ background: 'rgba(245,158,11,0.15)', borderColor: 'rgba(245,158,11,0.4)', color: '#fbbf24' }}
                    onClick={() => setShowSettings(true)}
                    title={`Singularity Gate: only scanning stocks with score ≥ ${singularityGate} (${stocks.filter(s => (s.singularityScore || 0) >= singularityGate).length} stocks). Click to edit.`}
                  >
                    <Filter className="w-3 h-3" />
                    Gate ≥{singularityGate}
                    <span className="text-amber-500/70">({stocks.filter(s => (s.singularityScore || 0) >= singularityGate).length})</span>
                  </div>
                )}
                
                {/* Grouped scan menus */}
                {[
                  { key: 'core', label: 'Scans', color: '#34d399', bg: 'rgba(16,185,129,' },
                ].map(group => {
                  const groupAgents = AGENT_REGISTRY.filter(a => a.group === group.key);
                  const activeAgent = groupAgents.find(a => a.id === agentRunning);
                  const isOpen = openScanGroup === group.key;
                  return (
                    <div key={group.key} className="relative">
                      <button
                        onClick={() => setOpenScanGroup(isOpen ? null : group.key)}
                        disabled={isScanning}
                        className="px-4 py-2.5 rounded-xl text-sm font-medium border flex items-center gap-2"
                        style={{ background: activeAgent ? `${group.bg}0.3)` : `${group.bg}0.1)`, borderColor: `${group.bg}0.3)`, color: group.color, opacity: isScanning ? 0.5 : 1 }}
                      >
                        {activeAgent ? (
                          <><RefreshCw className="w-4 h-4 animate-spin" />{activeAgent.label} {aiProgress.current}/{aiProgress.total}...</>
                        ) : (
                          <>{group.label}<ChevronDown className="w-3.5 h-3.5" /></>
                        )}
                      </button>
                      {isOpen && (
                        <div className="absolute right-0 top-full mt-2 w-64 rounded-xl border p-2 z-50 space-y-1" style={{ background: 'rgba(15,23,42,0.98)', borderColor: 'rgba(51,65,85,0.7)', boxShadow: '0 12px 32px rgba(0,0,0,0.5)' }}>
                          <button onClick={() => runComputedMetricsScan('Market data')} disabled={isComputingMetrics || isAnalyzingAI} className="w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2 hover:bg-slate-800" style={{ color: '#67e8f9', opacity: (isComputingMetrics || isAnalyzingAI) ? 0.5 : 1 }}>
                            {isComputingMetrics ? <RefreshCw className="w-4 h-4 animate-spin" /> : <BarChart3 className="w-4 h-4" />}Market Data (Technicals / RS / Vol)<span className="text-xs text-slate-500 ml-auto">free</span>
                          </button>
                          {groupAgents.map(agent => { const AgentIcon = agent.icon; return (
                            <button key={agent.id} onClick={() => launchAgentScan(agent)} disabled={isAnalyzingAI || isScanning} className="w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2 hover:bg-slate-800" style={{ color: agent.color, opacity: (isAnalyzingAI || isScanning) ? 0.5 : 1 }}>
                              {agentRunning === agent.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : <AgentIcon className="w-4 h-4" />}{agent.label}
                            </button>
                          ); })}
                          <button onClick={() => { setOpenScanGroup(null); runSingularityScan(getCurrentView()); }} disabled={isAnalyzingAI || isScanning || isScanningSupplyChain} className="w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2 hover:bg-slate-800" style={{ color: '#fbbf24', opacity: (isAnalyzingAI || isScanning) ? 0.5 : 1 }}>
                            {isScanningSupplyChain ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}Singularity Scan{isScanningSupplyChain && <span className="text-xs text-slate-500 ml-auto">{supplyChainProgress.current}/{supplyChainProgress.total}</span>}
                          </button>
                          <div className="border-t border-slate-800 pt-2 mt-1 px-3 pb-1 flex items-center justify-between text-xs text-slate-500">
                            <span>Stocks per scan</span>
                            <select value={agentScanCount} onChange={e => setAgentScanCount(parseInt(e.target.value))} className="rounded px-1.5 py-0.5 border outline-none" style={{ background: 'rgba(30,41,59,0.8)', borderColor: 'rgba(51,65,85,0.5)', color: '#94a3b8' }}>
                              <option value={10}>Top 10</option>
                              <option value={25}>Top 25</option>
                              <option value={50}>Top 50</option>
                              <option value={0}>All</option>
                            </select>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
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
            
            <p className="text-sm text-slate-400 mb-6">Runs everything in sequence: Base Scan → Singularity Scan → each enabled AI agent below. Every agent is one AI call per stock; the live-search ones are off by default.</p>
            
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
              {(spectrumSettings.grokEnabled || spectrumSettings.technicalEnabled || spectrumSettings.valuationEnabled || spectrumSettings.momentumEnabled || spectrumSettings.buyoutEnabled || spectrumSettings.leadershipEnabled || spectrumSettings.playbookEnabled) && spectrumSettings.singularityEnabled && (
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
              
              <div className="flex items-center justify-between p-3 rounded-lg border" style={{ background: 'rgba(34,211,238,0.05)', borderColor: 'rgba(34,211,238,0.2)' }}>
                <div className="flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-cyan-400" />
                  <span className="text-sm text-slate-200">Momentum & Volatility Data <span className="text-xs text-slate-500">(free, no AI)</span></span>
                </div>
                <button
                  onClick={() => setSpectrumSettings(p => ({...p, computedEnabled: !p.computedEnabled}))}
                  className="w-12 h-6 rounded-full transition-colors"
                  style={{ background: spectrumSettings.computedEnabled ? '#10b981' : 'rgba(51,65,85,0.5)' }}
                >
                  <div className="w-5 h-5 rounded-full bg-white transition-transform" style={{ transform: spectrumSettings.computedEnabled ? 'translateX(26px)' : 'translateX(2px)' }} />
                </button>
              </div>

              {[
                { title: 'AI Agent Scans', agents: [
                  { key: 'grokEnabled', label: 'Conviction' },
                  { key: 'technicalEnabled', label: 'Technical (C&H)' },
                  { key: 'valuationEnabled', label: 'Valuation' },
                  { key: 'momentumEnabled', label: 'Momentum' },
                  { key: 'buyoutEnabled', label: 'Buyout' },
                  { key: 'leadershipEnabled', label: 'Leadership' },
                  { key: 'playbookEnabled', label: 'Playbook Match' },
                ]},
              ].map(group => (
                <div key={group.title}>
                  <label className="text-sm text-slate-300 mb-2 block">{group.title}</label>
                  <div className="grid grid-cols-2 gap-2">
                    {group.agents.map(agent => (
                      <button
                        key={agent.key}
                        onClick={() => setSpectrumSettings(p => ({...p, [agent.key]: !p[agent.key]}))}
                        className="flex items-center justify-between px-3 py-2 rounded-lg border text-sm"
                        style={{
                          background: spectrumSettings[agent.key] ? 'rgba(16,185,129,0.1)' : 'rgba(30,41,59,0.5)',
                          borderColor: spectrumSettings[agent.key] ? 'rgba(16,185,129,0.4)' : 'rgba(51,65,85,0.5)',
                          color: spectrumSettings[agent.key] ? '#e2e8f0' : '#64748b'
                        }}
                      >
                        <span>{agent.label}</span>
                        <span className="text-xs font-semibold" style={{ color: spectrumSettings[agent.key] ? '#10b981' : '#475569' }}>{spectrumSettings[agent.key] ? 'ON' : 'OFF'}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}

              {(spectrumSettings.grokEnabled || spectrumSettings.technicalEnabled || spectrumSettings.valuationEnabled || spectrumSettings.momentumEnabled || spectrumSettings.buyoutEnabled || spectrumSettings.leadershipEnabled || spectrumSettings.playbookEnabled) && (
                <div>
                  <label className="text-sm text-slate-300 mb-2 block">AI Agents - Stocks to Analyze (applies to every agent above)</label>
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
                  {(availableModels || FALLBACK_MODELS).map(m => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
                <p className="text-xs text-slate-500 mt-1">List updates automatically as xAI releases new models. Smartest = best analysis, Fastest = cheapest/quickest.</p>
              </div>
            </div>
            
            {/* Scan Settings Section */}
            <div className="mb-6 p-4 rounded-xl border" style={{ background: 'rgba(99,102,241,0.05)', borderColor: 'rgba(99,102,241,0.2)' }}>
              <h3 className="text-sm font-semibold text-indigo-400 mb-3">AI Scan Counts</h3>
              <p className="text-xs text-slate-500 mb-4">Per-scan stock counts moved to the Scans dropdown ("Stocks per scan").</p>
              
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
              
              {/* Singularity Gate - minimum score for AI scans */}
              <div className="mb-4 p-3 rounded-lg border" style={{ background: singularityGate > 0 ? 'rgba(245,158,11,0.1)' : 'rgba(245,158,11,0.05)', borderColor: singularityGate > 0 ? 'rgba(245,158,11,0.4)' : 'rgba(245,158,11,0.2)' }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Filter className="w-4 h-4 text-amber-400" />
                    <div>
                      <span className="text-sm text-slate-200">Singularity Gate</span>
                      <p className="text-xs text-slate-500">Only AI-scan stocks with singularity score ≥ this value</p>
                      {singularityGate > 0 && (
                        <p className="text-xs text-amber-400 mt-0.5">
                          Active: {stocks.filter(s => (s.singularityScore || 0) >= singularityGate).length} of {stocks.length} stocks pass
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={singularityGate}
                      onChange={e => setSingularityGate(Math.max(0, Math.min(100, parseInt(e.target.value) || 0)))}
                      className="w-16 rounded-lg px-2 py-2 text-sm border outline-none text-center"
                      style={{ background: 'rgba(30,41,59,0.5)', borderColor: singularityGate > 0 ? 'rgba(245,158,11,0.4)' : 'rgba(245,158,11,0.3)', color: singularityGate > 0 ? '#fbbf24' : '#94a3b8' }}
                      min="0"
                      max="100"
                      placeholder="0"
                    />
                    {singularityGate > 0 && (
                      <button
                        onClick={() => setSingularityGate(0)}
                        className="p-1.5 rounded hover:bg-slate-700/50 text-slate-500 hover:text-slate-300"
                        title="Disable gate"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
              
              {/* Scan eligibility tiers */}
              <div className="mb-3 p-3 rounded-lg border" style={{ background: 'rgba(16,185,129,0.05)', borderColor: 'rgba(16,185,129,0.2)' }}>
                <span className="text-sm text-slate-200">Scan eligibility tiers</span>
                <p className="text-xs text-slate-500 mb-2">Routine AI scans and the default table view use the Hunt tier. Watch-only stocks still enter via scouts or your ★. Skip tier is hidden dead weight.</p>
                <div className="text-xs text-slate-400 space-y-1">
                  <p><span className="text-emerald-400 font-semibold">Hunt:</span> market cap ${TIER_RULES.minMarketCapM}M - ${TIER_RULES.maxMarketCapM / 1000}B, price ${TIER_RULES.minPrice} - ${TIER_RULES.maxPrice}, avg volume ≥ ${(TIER_RULES.minDollarVolume / 1000).toFixed(0)}K/day, not in a capped industry</p>
                  <p><span className="text-amber-400 font-semibold">Watch-only:</span> {[...new Set(TIER_RULES.cappedSic.map(r => r[2]))].join(', ')}, or outside the cap/price/volume range</p>
                  <p><span className="text-slate-500 font-semibold">Skip:</span> funds, SPACs/blank checks, trusts, sub-$0.20 or &lt;$100K/day</p>
                  <p className="text-slate-600">Restaurants and consumer names stay eligible on purpose (Monster / Victoria's Secret-type runs).</p>
                </div>
              </div>

              {/* Playbooks editor */}
              <div className="mb-3 p-3 rounded-lg border" style={{ background: 'rgba(167,139,250,0.05)', borderColor: 'rgba(167,139,250,0.2)' }}>
                <span className="text-sm text-slate-200">Playbooks</span>
                <p className="text-xs text-slate-500 mb-2">Your winning circumstances - the Playbook Match scan scores every stock against these. Edit freely.</p>
                {playbooks.map(p => (
                  <div key={p.id} className="mb-2">
                    <label className="text-xs font-semibold mb-1 block" style={{ color: '#a78bfa' }}>{p.name}</label>
                    <textarea
                      value={p.description}
                      onChange={e => updatePlaybook(p.id, e.target.value)}
                      rows={3}
                      className="w-full rounded-lg px-3 py-2 text-xs border outline-none"
                      style={{ background: 'rgba(30,41,59,0.5)', borderColor: 'rgba(167,139,250,0.25)', color: '#cbd5e1', resize: 'vertical' }}
                    />
                  </div>
                ))}
              </div>

              {/* Cloud Main Session + daily data refresh */}
              <div className="mb-3 p-3 rounded-lg border" style={{ background: 'rgba(34,211,238,0.05)', borderColor: 'rgba(34,211,238,0.2)' }}>
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <span className="text-sm text-slate-200">Main Session (cloud)</span>
                    <p className="text-xs text-slate-500">One shared session synced to the cloud. OFF = classic local sessions only.</p>
                  </div>
                  <button
                    onClick={toggleMainSession}
                    className="w-12 h-6 rounded-full transition-colors"
                    style={{ background: useMainSession ? '#10b981' : 'rgba(51,65,85,0.5)' }}
                  >
                    <div className="w-5 h-5 rounded-full bg-white transition-transform" style={{ transform: useMainSession ? 'translateX(26px)' : 'translateX(2px)' }} />
                  </button>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-slate-500">
                    {universeMeta ? `Universe: ${universeMeta.count?.toLocaleString?.() || universeMeta.count} tickers - prices ${universeMeta.prices_date || 'n/a'} - fundamentals swept ${universeMeta.swept || 0}/${universeMeta.sweep_total || universeMeta.count || 0} - refreshes hourly` : 'No universe data yet - run a refresh to build it'}
                  </p>
                  <button
                    onClick={refreshMarketData}
                    disabled={isRefreshingData}
                    className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold border flex items-center gap-1.5"
                    style={{ background: 'rgba(34,211,238,0.12)', borderColor: 'rgba(34,211,238,0.4)', color: '#67e8f9', opacity: isRefreshingData ? 0.6 : 1 }}
                  >
                    {isRefreshingData ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" />Refreshing...</> : <><RefreshCw className="w-3.5 h-3.5" />Refresh now</>}
                  </button>
                </div>
              </div>

              {/* Market Cap Settings */}
              <div className="flex items-center justify-between p-3 rounded-lg border mb-3" style={{ background: 'rgba(16,185,129,0.05)', borderColor: 'rgba(16,185,129,0.2)' }}>
                <div>
                  <span className="text-sm text-slate-200">Market Cap Filter</span>
                  <p className="text-xs text-slate-500">OFF = all market caps scanned. ON = only your custom range.</p>
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

      <div className="max-w-[1800px] mx-auto px-6 py-6 min-h-screen">
        {error && <div className="mb-4 p-4 rounded-xl border flex items-center gap-3" style={{ background: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.3)' }}><AlertCircle className="w-5 h-5 text-red-400" /><p className="text-sm text-red-300 flex-1">{error}</p><button onClick={() => setError(null)} className="text-red-400"><X className="w-4 h-4" /></button></div>}
        {resumeBanner && <div className="mb-4 p-4 rounded-xl border flex items-center gap-3" style={{ background: 'rgba(245,158,11,0.1)', borderColor: 'rgba(245,158,11,0.3)' }}><RefreshCw className="w-5 h-5 text-amber-400 animate-spin" /><p className="text-sm text-amber-300 flex-1">{resumeBanner}</p><button onClick={() => { if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current); clearCheckpoint(); setResumeBanner(null); }} className="px-3 py-1 rounded-lg text-xs border text-amber-400" style={{ borderColor: 'rgba(245,158,11,0.4)' }}>Cancel</button></div>}

        {/* Floating scan activity panel */}
        {(isScanning || isScanningSupplyChain || isAnalyzingAI || isComputingMetrics || pausedRun || serverJobs.some(j => ['queued','running','paused'].includes(j.status) || (j.status === 'done' && Date.now() - (j.finishedAt || 0) < 60000))) && (
          <div className="fixed bottom-4 right-4 z-50 w-80 rounded-xl border p-3 space-y-3" style={{ background: 'rgba(15,23,42,0.97)', borderColor: 'rgba(51,65,85,0.7)', boxShadow: '0 12px 32px rgba(0,0,0,0.5)' }}>
            <p className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Scan Activity</p>
            {serverJobs.filter(j => ['queued','running','paused'].includes(j.status) || (j.status === 'done' && Date.now() - (j.finishedAt || 0) < 60000)).slice(0, 4).map(j => {
              const labels = j.agentIds.map(id => AGENT_REGISTRY.find(a => a.id === id)?.label || id).join(' + ');
              const total = j.progress?.total || (j.agentIds.length * j.tickers.length);
              const done = j.progress?.done || 0;
              const color = j.status === 'done' ? '#34d399' : j.status === 'paused' ? '#fbbf24' : '#a78bfa';
              return (
                <div key={j.id}>
                  <div className="flex justify-between text-xs mb-1 gap-2"><span className="truncate" style={{ color }}>{j.status === 'queued' ? 'Queued' : j.status === 'paused' ? 'Paused' : j.status === 'done' ? 'Done' : 'Server'}: {labels}</span><span className="text-slate-500 mono shrink-0">{done}/{total}</span></div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(30,41,59,0.8)' }}><div className="h-full rounded-full transition-all" style={{ width: `${total ? (done / total) * 100 : 0}%`, background: color }} /></div>
                  {j.progress?.ticker && j.status === 'running' && <p className="text-[10px] text-slate-500 mt-1 truncate">{j.progress.agent}: {j.progress.ticker} - runs on server, safe to refresh</p>}
                  {j.status !== 'done' && (
                    <div className="flex gap-2 mt-2">
                      {j.status === 'paused'
                        ? <button onClick={() => jobAction(j.id, 'resume')} className="flex-1 px-2 py-1 rounded text-[10px] font-semibold border" style={{ borderColor: 'rgba(16,185,129,0.4)', color: '#34d399' }}>Resume</button>
                        : <button onClick={() => jobAction(j.id, 'pause')} className="flex-1 px-2 py-1 rounded text-[10px] font-semibold border" style={{ borderColor: 'rgba(245,158,11,0.4)', color: '#fbbf24' }}>Pause</button>}
                      <button onClick={() => jobAction(j.id, 'cancel')} className="flex-1 px-2 py-1 rounded text-[10px] font-semibold border" style={{ borderColor: 'rgba(239,68,68,0.4)', color: '#f87171' }}>Cancel</button>
                    </div>
                  )}
                </div>
              );
            })}
            {isScanning && (
              <div>
                <div className="flex justify-between text-xs mb-1"><span className="text-indigo-300">Base Scan</span><span className="text-slate-500 mono">{scanProgress.current}/{scanProgress.total || '...'}</span></div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(30,41,59,0.8)' }}><div className="h-full rounded-full transition-all" style={{ width: `${scanProgress.total ? (scanProgress.current / scanProgress.total) * 100 : 5}%`, background: 'linear-gradient(90deg, #6366f1, #8b5cf6)' }} /></div>
                {scanProgress.phase && <p className="text-[10px] text-slate-500 mt-1 truncate">{scanProgress.phase}</p>}
              </div>
            )}
            {isScanningSupplyChain && (
              <div>
                <div className="flex justify-between text-xs mb-1"><span className="text-amber-300">Singularity Scan</span><span className="text-slate-500 mono">{supplyChainProgress.current}/{supplyChainProgress.total || '...'}</span></div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(30,41,59,0.8)' }}><div className="h-full rounded-full transition-all" style={{ width: `${supplyChainProgress.total ? (supplyChainProgress.current / supplyChainProgress.total) * 100 : 5}%`, background: 'linear-gradient(90deg, #f59e0b, #f97316)' }} /></div>
              </div>
            )}
            {isAnalyzingAI && agentRunning && (() => { const ag = AGENT_REGISTRY.find(a => a.id === agentRunning); return (
              <div>
                <div className="flex justify-between text-xs mb-1"><span style={{ color: ag?.color || '#34d399' }}>{ag?.label || 'AI Scan'}</span><span className="text-slate-500 mono">{aiProgress.current}/{aiProgress.total}</span></div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(30,41,59,0.8)' }}><div className="h-full rounded-full transition-all" style={{ width: `${aiProgress.total ? (aiProgress.current / aiProgress.total) * 100 : 5}%`, background: ag?.color || '#34d399' }} /></div>
                <div className="flex gap-2 mt-2">
                  <button onClick={() => { scanControlRef.current = 'pause'; setStatus({ type: 'loading', msg: 'Pausing after current stock...' }); }} className="flex-1 px-2 py-1 rounded text-[10px] font-semibold border" style={{ borderColor: 'rgba(245,158,11,0.4)', color: '#fbbf24' }}>Pause</button>
                  <button onClick={() => { scanControlRef.current = 'cancel'; setStatus({ type: 'loading', msg: 'Cancelling after current stock...' }); }} className="flex-1 px-2 py-1 rounded text-[10px] font-semibold border" style={{ borderColor: 'rgba(239,68,68,0.4)', color: '#f87171' }}>Cancel</button>
                </div>
              </div>
            ); })()}
            {isComputingMetrics && (
              <div className="flex items-center gap-2 text-xs text-cyan-300"><RefreshCw className="w-3 h-3 animate-spin" />Computing market data...</div>
            )}
            {pausedRun && !isAnalyzingAI && (
              <div>
                <div className="flex justify-between text-xs mb-1"><span className="text-slate-300">Paused scan</span><span className="text-slate-500 mono">{Object.values(pausedRun.completed || {}).reduce((a, arr) => a + arr.length, 0)}/{pausedRun.agentIds.length * pausedRun.tickers.length}</span></div>
                <div className="flex gap-2 mt-1">
                  <button onClick={() => { const pr = pausedRun; setPausedRun(null); runAgentQueue(pr.agentIds, pr.tickers, pr.completed, { model: pr.model }); }} className="flex-1 px-2 py-1 rounded text-[10px] font-semibold border" style={{ borderColor: 'rgba(16,185,129,0.4)', color: '#34d399' }}>Resume</button>
                  <button onClick={() => { clearCheckpoint(); setPausedRun(null); setStatus({ type: 'live', msg: 'Paused scan discarded' }); }} className="flex-1 px-2 py-1 rounded text-[10px] font-semibold border" style={{ borderColor: 'rgba(239,68,68,0.4)', color: '#f87171' }}>Discard</button>
                </div>
              </div>
            )}
          </div>
        )}

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
              <button onClick={() => { setWeights({ pricePosition: 40, insiderActivity: 40, netCash: 20 }); setAiWeights({ conviction: 15, cupHandle: 10, singularity: 20, valuation: 10, momentum: 15, buyout: 15, leadership: 10, playbook: 15, technicals: 10 }); }} className="text-xs text-slate-400 hover:text-white px-3 py-1.5 rounded-lg border" style={{ background: 'rgba(30,41,59,0.5)', borderColor: 'rgba(51,65,85,0.5)' }}>Reset All</button>
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
                <div className="flex items-center gap-2 mb-3"><div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(239,68,68,0.2)' }}><BarChart3 className="w-4 h-4 text-red-400" /></div><span className="text-sm font-medium text-slate-200">Cup & Handle</span></div>
                <div className="flex items-center gap-3"><input type="range" min="0" max="50" value={aiWeights.cupHandle} onChange={e => { const v = parseInt(e.target.value); setAiWeights(p => ({...p, cupHandle: v})); setStocks(s => calcScores(s, weights, {...aiWeights, cupHandle: v})); }} className="flex-1" style={{ accentColor: '#f87171' }} /><span className="mono text-sm font-semibold w-8 text-right text-red-400">{aiWeights.cupHandle}</span></div>
              </div>
              <div className="rounded-xl p-4 border" style={{ background: 'rgba(245,158,11,0.05)', borderColor: 'rgba(245,158,11,0.2)' }}>
                <div className="flex items-center gap-2 mb-3"><div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(245,158,11,0.2)' }}><Zap className="w-4 h-4 text-amber-400" /></div><span className="text-sm font-medium text-slate-200">Singularity</span></div>
                <div className="flex items-center gap-3"><input type="range" min="0" max="50" value={aiWeights.singularity || 0} onChange={e => { const v = parseInt(e.target.value); setAiWeights(p => ({...p, singularity: v})); setStocks(s => calcScores(s, weights, {...aiWeights, singularity: v})); }} className="flex-1" style={{ accentColor: '#f59e0b' }} /><span className="mono text-sm font-semibold w-8 text-right text-amber-400">{aiWeights.singularity || 0}</span></div>
              </div>
              <div className="rounded-xl p-4 border" style={{ background: 'rgba(52,211,153,0.05)', borderColor: 'rgba(52,211,153,0.2)' }}>
                <div className="flex items-center gap-2 mb-3"><div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(52,211,153,0.2)' }}><DollarSign className="w-4 h-4 text-emerald-400" /></div><span className="text-sm font-medium text-slate-200">Valuation</span></div>
                <div className="flex items-center gap-3"><input type="range" min="0" max="50" value={aiWeights.valuation || 0} onChange={e => { const v = parseInt(e.target.value); setAiWeights(p => ({...p, valuation: v})); setStocks(s => calcScores(s, weights, {...aiWeights, valuation: v})); }} className="flex-1" style={{ accentColor: '#34d399' }} /><span className="mono text-sm font-semibold w-8 text-right text-emerald-400">{aiWeights.valuation || 0}</span></div>
              </div>
              {[
                { k: 'momentum', label: 'Momentum', color: '#fb923c' },
                { k: 'buyout', label: 'Buyout', color: '#fbbf24' },
                { k: 'leadership', label: 'Leadership', color: '#f472b6' },
                { k: 'playbook', label: 'Playbook', color: '#a78bfa' },
                { k: 'technicals', label: 'Technical Opinion', color: '#22d3ee' },
              ].map(w => (
                <div key={w.k} className="rounded-xl p-4 border" style={{ background: 'rgba(30,41,59,0.3)', borderColor: 'rgba(51,65,85,0.4)' }}>
                  <div className="flex items-center gap-2 mb-3"><div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(51,65,85,0.4)' }}><BarChart3 className="w-4 h-4" style={{ color: w.color }} /></div><span className="text-sm font-medium text-slate-200">{w.label}</span></div>
                  <div className="flex items-center gap-3"><input type="range" min="0" max="50" value={aiWeights[w.k] || 0} onChange={e => { const v = parseInt(e.target.value); setAiWeights(p => ({...p, [w.k]: v})); setStocks(st => calcScores(st, weights, {...aiWeights, [w.k]: v})); }} className="flex-1" style={{ accentColor: w.color }} /><span className="mono text-sm font-semibold w-8 text-right" style={{ color: w.color }}>{aiWeights[w.k] || 0}</span></div>
                </div>
              ))}
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
                  
                  {/* Top Gainers Toggle */}
                  <button 
                    onClick={() => setShowTopGainers(!showTopGainers)}
                    className="px-3 py-2 rounded-lg text-sm border flex items-center gap-2"
                    style={{ 
                      background: showTopGainers ? 'rgba(34,197,94,0.2)' : 'rgba(30,41,59,0.5)', 
                      borderColor: showTopGainers ? 'rgba(34,197,94,0.5)' : 'rgba(51,65,85,0.5)', 
                      color: showTopGainers ? '#4ade80' : '#94a3b8' 
                    }}
                    title={`Show only stocks up ${topGainersThreshold}%+ today`}
                  >
                    <TrendingUp className="w-4 h-4" />
                    Top Gainers
                    {showTopGainers && <span className="text-xs">({topGainersThreshold}%+)</span>}
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

                  {/* Columns visibility menu */}
                  <div className="relative">
                    <button
                      onClick={() => setShowColumnsMenu(!showColumnsMenu)}
                      className="px-3 py-2 rounded-lg text-sm border flex items-center gap-2"
                      style={{
                        background: showColumnsMenu ? 'rgba(34,211,238,0.2)' : 'rgba(30,41,59,0.5)',
                        borderColor: showColumnsMenu ? 'rgba(34,211,238,0.5)' : 'rgba(51,65,85,0.5)',
                        color: showColumnsMenu ? '#67e8f9' : '#94a3b8'
                      }}
                    >
                      <Sliders className="w-4 h-4" />
                      Columns
                    </button>
                    {showColumnsMenu && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setShowColumnsMenu(false)} />
                        <div className="absolute left-0 top-full mt-2 w-56 rounded-xl border p-2 z-50 max-h-96 overflow-y-auto" style={{ background: 'rgba(15,23,42,0.98)', borderColor: 'rgba(51,65,85,0.7)', boxShadow: '0 12px 32px rgba(0,0,0,0.5)' }}>
                          <p className="px-2 py-1 text-[10px] text-slate-500 uppercase">Show columns</p>
                          {Object.keys(COLUMN_LABELS).map(key => (
                            <label key={key} className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-slate-300 hover:bg-slate-800 cursor-pointer">
                              <input type="checkbox" checked={!!colVisible[key]} onChange={() => toggleColumn(key)} className="w-3.5 h-3.5 rounded accent-cyan-500" />
                              {COLUMN_LABELS[key]}
                            </label>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                  <select value={sectorFilter} onChange={e => setSectorFilter(e.target.value)} className="rounded-lg px-3 py-2 text-sm border outline-none" style={{ background: 'rgba(30,41,59,0.5)', borderColor: 'rgba(51,65,85,0.5)', color: '#cbd5e1' }}>
                    {Object.entries(STOCK_CATEGORIES).map(([key, cat]) => (
                      <option key={key} value={key}>{cat.name}</option>
                    ))}
                  </select>
                  <select value={sortBy} onChange={e => setSortBy(e.target.value)} className="rounded-lg px-3 py-2 text-sm border outline-none" style={{ background: 'rgba(30,41,59,0.5)', borderColor: 'rgba(51,65,85,0.5)', color: '#cbd5e1' }}>
                    <option value="compositeScore">Score</option>
                    <option value="change">Daily Change %</option>
                    <option value="insiderDate">Recent Insider Buys</option>
                    <option value="netCash">Net Cash</option>
                    <option value="upsidePct">Upside %</option>
                    <option value="insiderConviction">Conviction</option>
                    <option value="parabolicScore">Parabolic</option>
                    <option value="valuationScore">Valuation</option>
                  </select>
                </div>
              </div>
              
              {/* Filter Panel */}
              {showFilters && (
                <div className="p-4 border-b border-slate-800/50" style={{ background: 'rgba(139,92,246,0.05)' }}>
                  <div className="grid grid-cols-4 gap-4">
                    {/* Top Gainers Threshold */}
                    <div className="p-3 rounded-lg border" style={{ background: 'rgba(34,197,94,0.05)', borderColor: 'rgba(34,197,94,0.2)' }}>
                      <div className="flex items-center gap-2 mb-2">
                        <TrendingUp className="w-4 h-4 text-green-400" />
                        <span className="text-sm text-slate-200">Gainers Threshold</span>
                      </div>
                      <select 
                        value={topGainersThreshold}
                        onChange={e => setTopGainersThreshold(parseInt(e.target.value))}
                        className="w-full rounded px-2 py-1 text-sm border outline-none"
                        style={{ background: 'rgba(30,41,59,0.5)', borderColor: 'rgba(34,197,94,0.3)', color: '#4ade80' }}
                      >
                        <option value={3}>3%+ gains</option>
                        <option value={5}>5%+ gains</option>
                        <option value={10}>10%+ gains</option>
                        <option value={15}>15%+ gains</option>
                        <option value={20}>20%+ gains</option>
                      </select>
                    </div>
                    
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
                    <div className="p-3 rounded-lg border" style={{ background: 'rgba(239,68,68,0.05)', borderColor: 'rgba(239,68,68,0.2)' }}>
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
                      onClick={() => clearColumnData('explosive')}
                      className="px-3 py-2 rounded-lg text-sm font-medium border flex items-center gap-2 hover:bg-opacity-30 transition-colors"
                      style={{ background: 'rgba(236,72,153,0.1)', borderColor: 'rgba(236,72,153,0.3)', color: '#f472b6' }}
                    >
                      <Trash2 className="w-3 h-3" />
                      Explosive Growth Data
                    </button>
                    <button
                      onClick={() => clearColumnData('team')}
                      className="px-3 py-2 rounded-lg text-sm font-medium border flex items-center gap-2 hover:bg-opacity-30 transition-colors"
                      style={{ background: 'rgba(168,85,247,0.1)', borderColor: 'rgba(168,85,247,0.3)', color: '#c084fc' }}
                    >
                      <Trash2 className="w-3 h-3" />
                      Team Analysis Data
                    </button>
                    <button
                      onClick={() => clearColumnData('parabolic')}
                      className="px-3 py-2 rounded-lg text-sm font-medium border flex items-center gap-2 hover:bg-opacity-30 transition-colors"
                      style={{ background: 'rgba(34,197,94,0.1)', borderColor: 'rgba(34,197,94,0.3)', color: '#4ade80' }}
                    >
                      <Trash2 className="w-3 h-3" />
                      Parabolic Data
                    </button>
                    <button
                      onClick={() => clearColumnData('valuation')}
                      className="px-3 py-2 rounded-lg text-sm font-medium border flex items-center gap-2 hover:bg-opacity-30 transition-colors"
                      style={{ background: 'rgba(14,165,233,0.1)', borderColor: 'rgba(14,165,233,0.3)', color: '#38bdf8' }}
                    >
                      <Trash2 className="w-3 h-3" />
                      Valuation Data
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
                  <div className="w-6 flex items-center justify-center">
                    <input 
                      type="checkbox"
                      checked={sorted.length > 0 && sorted.every(s => selectedStocks.has(s.ticker))}
                      onChange={(e) => {
                        e.stopPropagation();
                        if (e.target.checked) {
                          setSelectedStocks(new Set(sorted.map(s => s.ticker)));
                        } else {
                          setSelectedStocks(new Set());
                        }
                      }}
                      className="w-3.5 h-3.5 rounded cursor-pointer accent-indigo-500"
                      title="Select all / Deselect all"
                    />
                  </div>
                  <div className="w-10 text-center">Rank</div>
                  <div className="flex-1">Ticker / Name</div>
                  <div className="w-24 text-right">Price / MCap</div>
                  {colVisible.netCash && <div className="w-16 text-center">Net Cash</div>}
                  {colVisible.insider && (
                  <div 
                    className="w-20 text-center cursor-pointer hover:text-slate-300 transition-colors flex items-center justify-center gap-1"
                    onClick={() => setSortBy(sortBy === 'insiderDate' ? 'compositeScore' : 'insiderDate')}
                  >
                    Insider
                    {sortBy === 'insiderDate' && <span className="text-emerald-400">↓</span>}
                  </div>
                  )}
                  {colVisible.sg && (
                  <div 
                    className="w-10 text-center cursor-pointer hover:text-slate-300 transition-colors flex items-center justify-center gap-1"
                    onClick={() => setSortBy(sortBy === 'singularityScore' ? 'compositeScore' : 'singularityScore')}
                    title="Singularity Score"
                  >
                    Sg
                    {sortBy === 'singularityScore' && <span className="text-amber-400">↓</span>}
                  </div>
                  )}
                  {colVisible.vl && (
                  <div 
                    className="w-10 text-center cursor-pointer hover:text-slate-300 transition-colors flex items-center justify-center gap-1"
                    onClick={() => setSortBy(sortBy === 'valuationScore' ? 'compositeScore' : 'valuationScore')}
                    title="Valuation: Depressed + Catalyst Potential (higher = more coiled spring)"
                  >
                    Vl
                    {sortBy === 'valuationScore' && <span className="text-sky-400">↓</span>}
                  </div>
                  )}
                  {colVisible.cv && (
                  <div 
                    className="w-10 text-center cursor-pointer hover:text-slate-300 transition-colors flex items-center justify-center gap-1"
                    onClick={() => setSortBy(sortBy === 'insiderConviction' ? 'compositeScore' : 'insiderConviction')}
                    title="Insider Conviction"
                  >
                    Cv
                    {sortBy === 'insiderConviction' && <span className="text-emerald-400">↓</span>}
                  </div>
                  )}
                  {colVisible.ch && (
                  <div 
                    className="w-10 text-center cursor-pointer hover:text-slate-300 transition-colors flex items-center justify-center gap-1"
                    onClick={() => setSortBy(sortBy === 'cupHandleScore' ? 'compositeScore' : 'cupHandleScore')}
                    title="Cup & Handle Score"
                  >
                    CH
                    {sortBy === 'cupHandleScore' && <span className="text-emerald-400">↓</span>}
                  </div>
                  )}
                  {NEW_SCORE_COLS.filter(c => colVisible[c.key]).map(c => (
                    <div key={c.key} className="w-10 text-center cursor-pointer hover:text-slate-300 transition-colors flex items-center justify-center gap-1" onClick={() => setSortBy(sortBy === c.field ? 'compositeScore' : c.field)} title={c.title}>
                      {c.label}
                      {sortBy === c.field && <span style={{ color: c.color }}>↓</span>}
                    </div>
                  ))}
                  {colVisible.low52 && (
                  <div 
                    className="w-12 text-center cursor-pointer hover:text-slate-300 transition-colors flex items-center justify-center gap-1"
                    onClick={() => setSortBy(sortBy === 'fromLow' ? 'fromLowDesc' : 'fromLow')}
                    title="Sort by % from 52-week low (click to toggle ascending/descending)"
                  >
                    52wL
                    {sortBy === 'fromLow' && <span className="text-emerald-400">↑</span>}
                    {sortBy === 'fromLowDesc' && <span className="text-emerald-400">↓</span>}
                  </div>
                  )}
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
                  <div key={s.ticker} className="row cursor-pointer" onClick={() => setSelected(selected?.ticker === s.ticker ? null : s)} style={{ background: selectedStocks.has(s.ticker) ? 'rgba(99,102,241,0.06)' : undefined }}>
                    <div className="p-4">
                      <div className="flex items-center gap-4">
                        <div className="w-6 flex items-center justify-center" onClick={e => e.stopPropagation()}>
                          <input 
                            type="checkbox"
                            checked={selectedStocks.has(s.ticker)}
                            onChange={(e) => {
                              const next = new Set(selectedStocks);
                              if (e.target.checked) {
                                next.add(s.ticker);
                              } else {
                                next.delete(s.ticker);
                              }
                              setSelectedStocks(next);
                            }}
                            className="w-3.5 h-3.5 rounded cursor-pointer accent-indigo-500"
                          />
                        </div>
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center mono font-bold text-sm" style={{ background: i < 3 ? ['rgba(245,158,11,0.2)', 'rgba(148,163,184,0.2)', 'rgba(194,65,12,0.2)'][i] : 'rgba(30,41,59,0.5)', color: i < 3 ? ['#fbbf24', '#cbd5e1', '#fb923c'][i] : '#64748b' }}>#{i + 1}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <button onClick={(e) => { e.stopPropagation(); toggleWatch(s); }} className="text-sm leading-none" title={watchlist[s.ticker] ? `Watching (${watchlist[s.ticker].route}) - click to unwatch` : 'Add to watchlist (research team will monitor it)'} style={{ color: watchlist[s.ticker] ? '#fbbf24' : '#334155' }}>★</button>
                            <span className="mono font-bold text-lg text-slate-100">{s.ticker}</span>
                            <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: s.change >= 0 ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)', color: s.change >= 0 ? '#34d399' : '#f87171' }}>{s.change >= 0 ? '+' : ''}{s.change.toFixed(2)}%</span>
                            {(() => { const tr = s.tier || classifyTier(s).tier; return tr !== 'A' ? <span className="text-[9px] px-1.5 py-0.5 rounded-full border" title={s.tierReason || (tr === 'B' ? 'Watch-only tier: capped sector or outside cap/price/volume range - scouts and stars can still bring it in' : 'Skip tier: fund / SPAC / shell / illiquid')} style={{ borderColor: tr === 'B' ? 'rgba(245,158,11,0.4)' : 'rgba(100,116,139,0.4)', color: tr === 'B' ? '#fbbf24' : '#64748b' }}>{tr === 'B' ? 'watch-only' : 'skip'}</span> : null; })()}
                            {s.aiAnalysis && <Sparkles className="w-4 h-4 text-emerald-400" title={`Conviction: ${s.insiderConviction}%`} />}
                            {s.technicalAnalysis && <Activity className="w-4 h-4 text-indigo-400" title={`C&H: ${s.cupHandleScore}`} />}
                            {s.explosiveAnalysis && <Zap className="w-4 h-4 text-pink-400" title={`Explosive: ${s.explosiveScore}`} />}
                            {s.teamAnalysis && <Users className="w-4 h-4 text-purple-400" title={`Team: ${s.teamScore}`} />}
                            {s.parabolicAnalysis && <TrendingUp className="w-4 h-4 text-green-400" title={`Parabolic: ${s.parabolicScore}`} />}
                            {s.valuationAnalysis && <DollarSign className="w-4 h-4 text-sky-400" title={`Valuation: ${s.valuationScore} (${s.valuationScore >= 80 ? 'Coiled Spring!' : s.valuationScore >= 66 ? 'Depressed' : s.valuationScore >= 50 ? 'Fair' : 'Priced In'})`} />}
                            {s.singularityScore >= 70 && <Flame className="w-4 h-4 text-amber-400" title={`Singularity: ${s.singularityScore}`} />}
                            {/* Add to Session */}
                            {sessions.length > 1 && (
                              <div className="relative">
                                <button 
                                  onClick={(e) => { 
                                    e.stopPropagation(); 
                                    setShowStockPicker(showStockPicker === s.ticker ? null : s.ticker);
                                  }}
                                  className="p-1 rounded hover:bg-blue-500/20 text-slate-500 hover:text-blue-400 transition-colors"
                                  title="Add to another session"
                                >
                                  <Plus className="w-3 h-3" />
                                </button>
                                {showStockPicker === s.ticker && (
                                  <>
                                    <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setShowStockPicker(null); }} />
                                    <div className="absolute top-full left-0 mt-1 z-50 p-1 rounded-lg border shadow-xl" style={{ background: '#1e293b', borderColor: 'rgba(51,65,85,0.5)', minWidth: '160px' }}>
                                      <p className="px-2 py-1 text-[10px] text-slate-500 uppercase">Add to session:</p>
                                      {sessions.filter(sess => sess.id !== currentSessionId).map(sess => (
                                        <button
                                          key={sess.id}
                                          onClick={(e) => { 
                                            e.stopPropagation(); 
                                            addStockToSession(s, sess.id);
                                          }}
                                          className="w-full px-2 py-1.5 text-xs text-left rounded hover:bg-slate-700/50 flex items-center gap-2 text-slate-300"
                                        >
                                          <Database className="w-3 h-3 text-slate-500" />
                                          {sess.name}
                                          <span className="text-slate-600 ml-auto">({sess.stocks?.length || 0})</span>
                                        </button>
                                      ))}
                                    </div>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 truncate">{s.name}</p>
                        </div>
                        <div className="text-right w-24"><p className="mono text-sm font-semibold text-slate-200">${s.price?.toFixed(2)}</p><p className="text-xs text-indigo-400 mono">${s.marketCap}M</p></div>
                        {colVisible.netCash && <div className="w-16 text-center"><NetCashBadge amount={s.netCash} hasData={s.hasFinancials} /></div>}
                        {colVisible.insider && <div className="w-20 text-center"><InsiderBadge data={s.lastInsiderPurchase} /></div>}
                        {colVisible.sg && (<>
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
                        </>)}
                        {colVisible.vl && (<>
                        {/* Valuation Score */}
                        <div className="w-10 text-center">
                          {s.valuationScore !== null && s.valuationScore !== undefined ? (
                            <span 
                              className="text-[10px] font-bold mono px-1 py-0.5 rounded"
                              style={{ 
                                background: s.valuationScore >= 70 ? 'rgba(14,165,233,0.3)' : s.valuationScore >= 50 ? 'rgba(14,165,233,0.2)' : s.valuationScore >= 30 ? 'rgba(245,158,11,0.2)' : 'rgba(239,68,68,0.2)',
                                color: s.valuationScore >= 70 ? '#38bdf8' : s.valuationScore >= 50 ? '#7dd3fc' : s.valuationScore >= 30 ? '#fbbf24' : '#f87171'
                              }}
                              title={s.valuationScore >= 80 ? 'Coiled Spring!' : s.valuationScore >= 66 ? 'Depressed + Catalyst' : s.valuationScore >= 50 ? 'Fair' : 'Priced In / Overvalued'}
                            >
                              {s.valuationScore}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-600">—</span>
                          )}
                        </div>
                        </>)}
                        {colVisible.cv && (<>
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
                        </>)}
                        {colVisible.ch && (<>
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
                        </>)}
                        {NEW_SCORE_COLS.filter(c => colVisible[c.key]).map(c => (
                          <div key={c.key} className="w-10 text-center">
                            {s[c.field] !== null && s[c.field] !== undefined ? (
                              <span className="text-[10px] font-bold mono px-1 py-0.5 rounded" style={{ background: s[c.field] >= 70 ? c.color + '33' : s[c.field] >= 50 ? c.color + '22' : 'rgba(100,116,139,0.2)', color: s[c.field] >= 50 ? c.color : '#94a3b8' }}>{s[c.field]}</span>
                            ) : (
                              <span className="text-xs text-slate-600">—</span>
                            )}
                          </div>
                        ))}
                        {colVisible.low52 && (<>
                        <div className="w-12 text-center">
                          <div className="mono text-[10px] font-semibold" style={{ color: s.fromLow < 20 ? '#34d399' : s.fromLow < 50 ? '#fbbf24' : '#f87171' }}>{s.fromLow?.toFixed(1)}%</div>
                        </div>
                        </>)}
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
                          
                          {s.explosiveAnalysis && (
                            <div className="mb-4 p-4 rounded-xl border" style={{ background: 'rgba(236,72,153,0.08)', borderColor: 'rgba(236,72,153,0.3)' }}>
                              <h4 className="text-sm font-semibold text-pink-400 mb-2 flex items-center gap-2">
                                <Zap className="w-4 h-4" />
                                Explosive Growth Potential
                                {s.explosiveScore !== null && (
                                  <span className="ml-2 px-2 py-0.5 rounded text-xs font-bold" style={{ 
                                    background: s.explosiveScore >= 70 ? 'rgba(236,72,153,0.3)' : s.explosiveScore >= 50 ? 'rgba(236,72,153,0.2)' : 'rgba(100,116,139,0.2)', 
                                    color: s.explosiveScore >= 70 ? '#f472b6' : s.explosiveScore >= 50 ? '#f9a8d4' : '#94a3b8' 
                                  }}>
                                    {s.explosiveScore}/100
                                  </span>
                                )}
                              </h4>
                              <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">{s.explosiveAnalysis}</p>
                            </div>
                          )}
                          
                          {s.teamAnalysis && (
                            <div className="mb-4 p-4 rounded-xl border" style={{ background: 'rgba(168,85,247,0.08)', borderColor: 'rgba(168,85,247,0.3)' }}>
                              <h4 className="text-sm font-semibold text-purple-400 mb-2 flex items-center gap-2">
                                <Users className="w-4 h-4" />
                                Team & Management Analysis
                                {s.teamScore !== null && (
                                  <span className="ml-2 px-2 py-0.5 rounded text-xs font-bold" style={{ 
                                    background: s.teamScore >= 70 ? 'rgba(168,85,247,0.3)' : s.teamScore >= 50 ? 'rgba(168,85,247,0.2)' : 'rgba(100,116,139,0.2)', 
                                    color: s.teamScore >= 70 ? '#c084fc' : s.teamScore >= 50 ? '#d8b4fe' : '#94a3b8' 
                                  }}>
                                    {s.teamScore}/100
                                  </span>
                                )}
                              </h4>
                              <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">{s.teamAnalysis}</p>
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
                          
                          {s.parabolicAnalysis && (
                            <div className="mb-4 p-4 rounded-xl border" style={{ background: 'rgba(34,197,94,0.08)', borderColor: 'rgba(34,197,94,0.3)' }}>
                              <h4 className="text-sm font-semibold text-green-400 mb-2 flex items-center gap-2">
                                <TrendingUp className="w-4 h-4" />
                                Parabolic Continuation Analysis
                                {s.parabolicScore !== null && (
                                  <span className="ml-2 px-2 py-0.5 rounded text-xs font-bold" style={{ 
                                    background: s.parabolicScore >= 70 ? 'rgba(34,197,94,0.3)' : s.parabolicScore >= 50 ? 'rgba(34,197,94,0.2)' : s.parabolicScore >= 30 ? 'rgba(245,158,11,0.2)' : 'rgba(239,68,68,0.2)', 
                                    color: s.parabolicScore >= 70 ? '#4ade80' : s.parabolicScore >= 50 ? '#86efac' : s.parabolicScore >= 30 ? '#fbbf24' : '#f87171' 
                                  }}>
                                    {s.parabolicScore >= 70 ? 'ACCUMULATION' : s.parabolicScore >= 50 ? 'NEUTRAL' : s.parabolicScore >= 30 ? 'CAUTION' : 'HIGH RISK'} ({s.parabolicScore}/100)
                                  </span>
                                )}
                              </h4>
                              <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">{s.parabolicAnalysis}</p>
                            </div>
                          )}
                          
                          {s.valuationAnalysis && (
                            <div className="mb-4 p-4 rounded-xl border" style={{ background: 'rgba(14,165,233,0.08)', borderColor: 'rgba(14,165,233,0.3)' }}>
                              <h4 className="text-sm font-semibold text-sky-400 mb-2 flex items-center gap-2">
                                <DollarSign className="w-4 h-4" />
                                Valuation — Depressed / Coiled Spring Analysis
                                {s.valuationScore !== null && (
                                  <span className="ml-2 px-2 py-0.5 rounded text-xs font-bold" style={{ 
                                    background: s.valuationScore >= 70 ? 'rgba(14,165,233,0.3)' : s.valuationScore >= 50 ? 'rgba(14,165,233,0.2)' : s.valuationScore >= 30 ? 'rgba(245,158,11,0.2)' : 'rgba(239,68,68,0.2)', 
                                    color: s.valuationScore >= 70 ? '#38bdf8' : s.valuationScore >= 50 ? '#7dd3fc' : s.valuationScore >= 30 ? '#fbbf24' : '#f87171' 
                                  }}>
                                    {s.valuationScore >= 80 ? 'COILED SPRING 🔥' : s.valuationScore >= 66 ? 'UNDERVALUED' : s.valuationScore >= 50 ? 'FAIR VALUE' : s.valuationScore >= 35 ? 'PRICED IN' : 'OVERVALUED'} ({s.valuationScore}/100)
                                  </span>
                                )}
                              </h4>
                              <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">{s.valuationAnalysis}</p>
                            </div>
                          )}

                          {/* Momentum / Buyout / Leadership details */}
                          {[
                            { field: 'momentumAnalysis', scoreField: 'momentumScore', title: 'Momentum Analysis', color: '#fb923c', bg: 'rgba(251,146,60,', subs: [
                              { label: 'Chart', f: 'momentumChartScore' }, { label: 'Continuation', f: 'momentumContinuationScore' }, { label: 'Parabolic', f: 'momentumParabolicScore' },
                            ]},
                            { field: 'buyoutAnalysis', scoreField: 'buyoutScore', title: 'Buyout Likelihood Analysis', color: '#fbbf24', bg: 'rgba(251,191,36,', subs: [
                              { label: 'People', f: 'buyoutPeopleScore' }, { label: 'Intent', f: 'buyoutIntentScore' }, { label: 'Buzz', f: 'buyoutBuzzScore' }, { label: 'Fit', f: 'buyoutFitScore' },
                            ]},
                            { field: 'leadershipAnalysis', scoreField: 'leadershipScore', title: 'Leadership Analysis', color: '#f472b6', bg: 'rgba(244,114,182,', subs: [
                              { label: 'CEO', f: 'leadershipCeoScore' }, { label: 'Team', f: 'leadershipTeamScore' }, { label: 'Public', f: 'leadershipPublicScore' }, { label: 'Vibes', f: 'leadershipVibesScore' },
                            ]},
                          ].map(d => s[d.field] ? (
                            <div key={d.field} className="mb-4 p-4 rounded-xl border" style={{ background: `${d.bg}0.08)`, borderColor: `${d.bg}0.3)` }}>
                              <h4 className="text-sm font-semibold mb-2 flex items-center gap-2 flex-wrap" style={{ color: d.color }}>
                                <BarChart3 className="w-4 h-4" />
                                {d.title}
                                {s[d.scoreField] !== null && s[d.scoreField] !== undefined && (
                                  <span className="ml-2 px-2 py-0.5 rounded text-xs font-bold" style={{ background: `${d.bg}0.2)`, color: d.color }}>{s[d.scoreField]}/100</span>
                                )}
                                {d.subs.filter(sub => s[sub.f] !== null && s[sub.f] !== undefined).map(sub => (
                                  <span key={sub.f} className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800/70 text-slate-300">{sub.label} {s[sub.f]}</span>
                                ))}
                              </h4>
                              <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">{s[d.field]}</p>
                            </div>
                          ) : null)}

                          {/* Playbook match details */}
                          {s.playbookAnalysis && (
                            <div className="mb-4 p-4 rounded-xl border" style={{ background: 'rgba(167,139,250,0.08)', borderColor: 'rgba(167,139,250,0.3)' }}>
                              <h4 className="text-sm font-semibold mb-2 flex items-center gap-2 flex-wrap" style={{ color: '#a78bfa' }}>
                                <Target className="w-4 h-4" />
                                Playbook Match
                                {s.playbookScore !== null && s.playbookScore !== undefined && (
                                  <span className="ml-1 px-2 py-0.5 rounded text-xs font-bold" style={{ background: 'rgba(167,139,250,0.2)', color: '#a78bfa' }}>{s.playbookBest || 'Best'}: {s.playbookScore}/100</span>
                                )}
                                {s.playbookScores && Object.entries(s.playbookScores).map(([name, sc]) => sc !== null && sc !== undefined ? (
                                  <span key={name} className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800/70 text-slate-300">{name} {sc}</span>
                                ) : null)}
                              </h4>
                              <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">{s.playbookAnalysis}</p>
                            </div>
                          )}

                          {/* Technical Opinion (Barchart-style, computed) */}
                          {s.techSignals && (
                            <div className="mb-4 p-3 rounded-xl border" style={{ background: 'rgba(34,211,238,0.05)', borderColor: 'rgba(34,211,238,0.2)' }}>
                              <p className="text-xs font-semibold mb-2 flex items-center gap-2" style={{ color: '#22d3ee' }}>Technical Opinion <span className="px-2 py-0.5 rounded text-[11px] font-bold" style={{ background: s.techBuys > s.techSells ? 'rgba(16,185,129,0.2)' : s.techSells > s.techBuys ? 'rgba(239,68,68,0.2)' : 'rgba(100,116,139,0.2)', color: s.techBuys > s.techSells ? '#34d399' : s.techSells > s.techBuys ? '#f87171' : '#94a3b8' }}>{s.techOpinion}</span><span className="text-slate-500 font-normal">{s.techBuys}/13 indicators on Buy</span></p>
                              <div className="flex flex-wrap gap-1.5">
                                {s.techSignals.map(sig => (
                                  <span key={sig.name} className="px-2 py-0.5 rounded text-[10px]" style={{ background: sig.signal === 'buy' ? 'rgba(16,185,129,0.12)' : sig.signal === 'sell' ? 'rgba(239,68,68,0.12)' : 'rgba(100,116,139,0.12)', color: sig.signal === 'buy' ? '#34d399' : sig.signal === 'sell' ? '#f87171' : '#94a3b8' }}>{sig.name}: {sig.signal}</span>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Momentum / volatility computed metrics */}
                          {(s.rsScore !== undefined || s.realizedVol !== undefined) && (
                            <div className="mb-4 p-3 rounded-xl border flex flex-wrap gap-2 text-xs" style={{ background: 'rgba(34,211,238,0.05)', borderColor: 'rgba(34,211,238,0.2)' }}>
                              {s.rsScore !== undefined && s.rsScore !== null && <span className="px-2 py-1 rounded" style={{ background: 'rgba(251,146,60,0.15)', color: '#fb923c' }}>RS rank {s.rsScore}/100</span>}
                              {s.pct21d !== undefined && s.pct21d !== null && <span className="px-2 py-1 rounded bg-slate-800/60 text-slate-300">1mo {s.pct21d >= 0 ? '+' : ''}{s.pct21d.toFixed(1)}%</span>}
                              {s.pct63d !== undefined && s.pct63d !== null && <span className="px-2 py-1 rounded bg-slate-800/60 text-slate-300">3mo {s.pct63d >= 0 ? '+' : ''}{s.pct63d.toFixed(1)}%</span>}
                              {s.volumeSurge !== undefined && s.volumeSurge !== null && <span className="px-2 py-1 rounded" style={{ background: 'rgba(103,232,249,0.12)', color: '#67e8f9' }}>Vol {s.volumeSurge.toFixed(1)}x avg</span>}
                              {s.realizedVol !== undefined && s.realizedVol !== null && <span className="px-2 py-1 rounded bg-slate-800/60 text-slate-300">RVol {s.realizedVol.toFixed(0)}%</span>}
                              {s.atrPct !== undefined && s.atrPct !== null && <span className="px-2 py-1 rounded bg-slate-800/60 text-slate-300">ATR {s.atrPct.toFixed(1)}%/d</span>}
                              {s.volContraction !== undefined && s.volContraction !== null && <span className="px-2 py-1 rounded bg-slate-800/60 text-slate-300">{s.volContraction < 0.8 ? 'Vol contracting' : s.volContraction > 1.2 ? 'Vol expanding' : 'Vol stable'}</span>}
                            </div>
                          )}
                          
                          {!s.aiAnalysis && !s.explosiveAnalysis && !s.teamAnalysis && !s.technicalAnalysis && !s.parabolicAnalysis && !s.valuationAnalysis && i < 10 && (
                            <div className="mb-4 p-3 rounded-xl border" style={{ background: 'rgba(99,102,241,0.05)', borderColor: 'rgba(99,102,241,0.2)' }}>
                              <p className="text-sm text-slate-400 flex items-center gap-2"><Sparkles className="w-4 h-4 text-indigo-400" />Run AI scans (Conviction, C&H, Valuation, Momentum, Buyout, Leadership, Playbook) to analyze</p>
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
        
        {/* Floating Action Bar for Selected Stocks */}
        {selectedStocks.size > 0 && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl border shadow-2xl flex items-center gap-3" style={{ background: 'rgba(15,23,42,0.97)', borderColor: 'rgba(99,102,241,0.4)', backdropFilter: 'blur(12px)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
            <span className="text-sm font-medium text-indigo-400 mr-1">{selectedStocks.size} selected</span>
            <div className="w-px h-6 bg-slate-700" />
            <button
              onClick={() => {
                const sel = stocks.filter(s => selectedStocks.has(s.ticker));
                runGrokAnalysis(sel);
              }}
              disabled={isAnalyzingAI}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border flex items-center gap-1.5 hover:brightness-125 transition-all"
              style={{ background: 'rgba(16,185,129,0.15)', borderColor: 'rgba(16,185,129,0.3)', color: '#34d399' }}
            >
              {isAnalyzingAI ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              Conviction
            </button>
            <button
              onClick={() => {
                const sel = stocks.filter(s => selectedStocks.has(s.ticker));
                runTechnicalAnalysis(sel);
              }}
              disabled={isAnalyzingTechnical}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border flex items-center gap-1.5 hover:brightness-125 transition-all"
              style={{ background: 'rgba(99,102,241,0.15)', borderColor: 'rgba(99,102,241,0.3)', color: '#a5b4fc' }}
            >
              {isAnalyzingTechnical ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Activity className="w-3 h-3" />}
              C&H
            </button>
            <button
              onClick={() => {
                const sel = stocks.filter(s => selectedStocks.has(s.ticker));
                runExplosiveGrowthAnalysis(sel);
              }}
              disabled={isAnalyzingExplosive}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border flex items-center gap-1.5 hover:brightness-125 transition-all"
              style={{ background: 'rgba(236,72,153,0.15)', borderColor: 'rgba(236,72,153,0.3)', color: '#f472b6' }}
            >
              {isAnalyzingExplosive ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
              Explosive
            </button>
            <button
              onClick={() => {
                const sel = stocks.filter(s => selectedStocks.has(s.ticker));
                runTeamAnalysis(sel);
              }}
              disabled={isAnalyzingTeam}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border flex items-center gap-1.5 hover:brightness-125 transition-all"
              style={{ background: 'rgba(168,85,247,0.15)', borderColor: 'rgba(168,85,247,0.3)', color: '#c084fc' }}
            >
              {isAnalyzingTeam ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Users className="w-3 h-3" />}
              Team
            </button>
            <button
              onClick={() => {
                const sel = stocks.filter(s => selectedStocks.has(s.ticker));
                runParabolicAnalysis(sel);
              }}
              disabled={isAnalyzingParabolic}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border flex items-center gap-1.5 hover:brightness-125 transition-all"
              style={{ background: 'rgba(34,197,94,0.15)', borderColor: 'rgba(34,197,94,0.3)', color: '#4ade80' }}
            >
              {isAnalyzingParabolic ? <RefreshCw className="w-3 h-3 animate-spin" /> : <TrendingUp className="w-3 h-3" />}
              Parabolic
            </button>
            <button
              onClick={() => {
                const sel = stocks.filter(s => selectedStocks.has(s.ticker));
                runValuationAnalysis(sel);
              }}
              disabled={isAnalyzingValuation}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border flex items-center gap-1.5 hover:brightness-125 transition-all"
              style={{ background: 'rgba(14,165,233,0.15)', borderColor: 'rgba(14,165,233,0.3)', color: '#38bdf8' }}
            >
              {isAnalyzingValuation ? <RefreshCw className="w-3 h-3 animate-spin" /> : <DollarSign className="w-3 h-3" />}
              Valuation
            </button>
            <div className="w-px h-6 bg-slate-700" />
            <button
              onClick={() => setSelectedStocks(new Set())}
              className="p-1.5 rounded-lg hover:bg-slate-700/50 text-slate-500 hover:text-slate-300 transition-colors"
              title="Clear selection"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        
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
