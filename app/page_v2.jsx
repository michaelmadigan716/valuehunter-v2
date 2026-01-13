'use client';

import React, { useState, useEffect } from 'react';
import { Search, Brain, Zap, RefreshCw, ChevronDown, ChevronUp, X, Plus, Trash2, Play, Building2, Factory, Sparkles, AlertCircle, Edit3, Save } from 'lucide-react';

// ============================================
// API CONFIGURATION
// ============================================
const POLYGON_KEY = process.env.NEXT_PUBLIC_POLYGON_KEY || '';
const SESSIONS_KEY = 'singularity_finder_v2_sessions';

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
async function getStockData(ticker) {
  try {
    const [detailsRes, prevRes, weekRes] = await Promise.all([
      fetch(`https://api.polygon.io/v3/reference/tickers/${ticker}?apiKey=${POLYGON_KEY}`),
      fetch(`https://api.polygon.io/v2/aggs/ticker/${ticker}/prev?adjusted=true&apiKey=${POLYGON_KEY}`),
      fetch(`https://api.polygon.io/v2/aggs/ticker/${ticker}/range/1/day/${new Date(Date.now() - 365*24*60*60*1000).toISOString().split('T')[0]}/${new Date().toISOString().split('T')[0]}?adjusted=true&sort=desc&limit=260&apiKey=${POLYGON_KEY}`)
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

// ============================================
// GROK AI FUNCTIONS
// ============================================
async function callGrokAI(prompt, model = 'grok-3-mini') {
  const response = await fetch("/api/grok", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, model })
  });
  if (!response.ok) throw new Error((await response.json()).error || response.status);
  return (await response.json()).analysis || '';
}

async function findSupplierCandidates(megaStock) {
  const prompt = `Find 10-15 small/mid-cap companies (under $10B) that supply to or could supply to ${megaStock.ticker} (${megaStock.name} - ${megaStock.category}).

Focus on: ${megaStock.category === 'AI Compute' ? 'Semiconductor equipment, memory, cooling, power, PCB' : 
megaStock.category === 'Robotics/Energy' ? 'Motors, actuators, sensors, batteries, rare earths, magnets' :
megaStock.category === 'AI Platform' ? 'Data center infrastructure, networking, storage, security' :
megaStock.category === 'Chip Equipment' ? 'Optics, precision motion, vacuum systems, chemicals' :
megaStock.category === 'Chip Manufacturing' ? 'Materials, gases, chemicals, test equipment' :
megaStock.category === 'AI Networking' ? 'Optical components, connectors, cables, switch chips' :
'Servers, storage, cooling, power, robotics'}

RESPOND WITH ONLY JSON: [{"ticker":"XXXX","reason":"why they supply","confidence":"high/medium/low","category":"direct/potential/pickShovel/secondOrder"}]`;

  try {
    const response = await callGrokAI(prompt);
    const match = response.match(/\[[\s\S]*\]/);
    return match ? JSON.parse(match[0]) : [];
  } catch (e) {
    console.error(`Failed for ${megaStock.ticker}:`, e);
    return [];
  }
}

async function validateSuppliers(candidates, megaStocks) {
  const tickers = [...new Set(candidates.map(c => c.ticker))].slice(0, 30).join(', ');
  const megas = megaStocks.map(m => m.ticker).join(', ');
  
  const prompt = `Validate these supplier stocks: ${tickers}
For mega stocks: ${megas}

RESPOND WITH ONLY JSON: [{"ticker":"XXXX","name":"Company Name","business":"What they do","singularityScore":85,"category":"direct/potential/pickShovel/secondOrder","suppliesTo":["NVDA"],"confidence":"high/medium/low"}]

Only include real, relevant stocks.`;

  try {
    const response = await callGrokAI(prompt);
    const match = response.match(/\[[\s\S]*\]/);
    return match ? JSON.parse(match[0]) : [];
  } catch (e) {
    console.error('Validation failed:', e);
    return [];
  }
}

async function deepAnalyzeCandidate(stock) {
  const prompt = `Deep analysis of ${stock.ticker} (${stock.name}) as singularity play.
Business: ${stock.business || 'Unknown'}
Category: ${stock.category || 'Unknown'}

RESPOND WITH JSON: {"ticker":"${stock.ticker}","convictionScore":85,"targetUpside":"+150%","timeframe":"6-12 months","thesis":"2-3 sentence thesis"}`;

  try {
    const response = await callGrokAI(prompt);
    const match = response.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  } catch (e) {
    return null;
  }
}

async function getConvictionAnalysis(stock) {
  const prompt = `Analyze ${stock.ticker} (${stock.name}).
Price: $${stock.price?.toFixed(2)} | MCap: $${stock.marketCap}M
52W: $${stock.low52?.toFixed(2)} - $${stock.high52?.toFixed(2)}
+${stock.fromLow?.toFixed(1)}% from low | -${stock.fromHigh?.toFixed(1)}% from high

What's the investment case? Rate conviction 0-100.
End with: CONVICTION_SCORE: [0-100]`;

  try {
    const response = await callGrokAI(prompt);
    const match = response.match(/CONVICTION_SCORE[:\s]*(\d+)/i);
    const score = match ? Math.min(100, Math.max(0, parseInt(match[1]))) : null;
    return { analysis: response.replace(/CONVICTION_SCORE[:\s]*\d+/gi, '').trim(), convictionScore: score };
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
  const [researchTicker, setResearchTicker] = useState('');
  const [researchResults, setResearchResults] = useState([]);
  const [isResearching, setIsResearching] = useState(false);
  const [expandedStock, setExpandedStock] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(SESSIONS_KEY);
      if (saved) {
        const data = JSON.parse(saved);
        if (data.megaStocks) setMegaStocks(data.megaStocks);
        if (data.foundStocks) setFoundStocks(data.foundStocks);
        if (data.researchResults) setResearchResults(data.researchResults);
      }
    } catch (e) {}
  }, []);

  useEffect(() => {
    if (foundStocks.length > 0 || researchResults.length > 0) {
      localStorage.setItem(SESSIONS_KEY, JSON.stringify({ megaStocks, foundStocks, researchResults, timestamp: Date.now() }));
    }
  }, [megaStocks, foundStocks, researchResults]);

  const runSupplierScan = async () => {
    if (isScanning) return;
    setIsScanning(true);
    setError(null);
    setFoundStocks([]);
    setScanIteration(0);

    try {
      // Round 1: Find candidates
      setScanStatus({ phase: 'round1', message: 'Round 1: Finding supplier candidates...', progress: 0 });
      let allCandidates = [];
      for (let i = 0; i < megaStocks.length; i++) {
        setScanStatus({ phase: 'round1', message: `Round 1: ${megaStocks[i].ticker}...`, progress: (i / megaStocks.length) * 25 });
        const candidates = await findSupplierCandidates(megaStocks[i]);
        allCandidates.push(...candidates.map(c => ({ ...c, sourceMega: megaStocks[i].ticker })));
        await new Promise(r => setTimeout(r, 1000));
      }
      setScanIteration(1);

      // Round 2: Validate
      setScanStatus({ phase: 'round2', message: 'Round 2: Validating...', progress: 25 });
      const validated = await validateSuppliers(allCandidates, megaStocks);
      setScanIteration(2);

      // Round 3: Deep analysis
      setScanStatus({ phase: 'round3', message: 'Round 3: Deep analysis...', progress: 50 });
      const stocksWithData = [];
      const top = validated.sort((a, b) => (b.singularityScore || 0) - (a.singularityScore || 0)).slice(0, 20);
      
      for (let i = 0; i < top.length; i++) {
        setScanStatus({ phase: 'round3', message: `Round 3: ${top[i].ticker}...`, progress: 50 + (i / top.length) * 30 });
        const stockData = await getStockData(top[i].ticker);
        if (stockData) {
          const deep = await deepAnalyzeCandidate({ ...top[i], ...stockData });
          stocksWithData.push({ ...stockData, ...top[i], deepAnalysis: deep, convictionScore: deep?.convictionScore || top[i].singularityScore || 50 });
        }
        await new Promise(r => setTimeout(r, 500));
      }
      setScanIteration(3);

      // Round 4: Final scoring
      setScanStatus({ phase: 'round4', message: 'Round 4: Final scoring...', progress: 85 });
      const final = stocksWithData
        .map(s => ({ ...s, finalScore: Math.round((s.convictionScore || 50) * 0.4 + (s.singularityScore || 50) * 0.3 + (s.confidence === 'high' ? 100 : s.confidence === 'medium' ? 70 : 40) * 0.3) }))
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
      const conviction = await getConvictionAnalysis(stockData);
      setResearchResults(prev => [{ ...stockData, ...conviction, timestamp: Date.now() }, ...prev.filter(r => r.ticker !== ticker)].slice(0, 20));
      setResearchTicker('');
    } catch (e) {
      setError(`Research failed: ${e.message}`);
    } finally {
      setIsResearching(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      <header className="border-b border-slate-800/50 bg-slate-900/50 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
              <Zap className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent">Singularity Finder</h1>
              <p className="text-xs text-slate-500">Find the picks & shovels of the AI revolution</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setActiveSection('finder')} className={`px-4 py-2 rounded-lg text-sm font-medium ${activeSection === 'finder' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}>
              <Search className="w-4 h-4 inline mr-2" />Stock Finder
            </button>
            <button onClick={() => setActiveSection('research')} className={`px-4 py-2 rounded-lg text-sm font-medium ${activeSection === 'research' ? 'bg-violet-500/20 text-violet-400 border border-violet-500/30' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}>
              <Brain className="w-4 h-4 inline mr-2" />Deep Research
            </button>
          </div>
        </div>
      </header>

      {error && (
        <div className="max-w-7xl mx-auto px-6 mt-4">
          <div className="p-4 rounded-xl border bg-red-500/10 border-red-500/30 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-400" />
            <p className="text-sm text-red-300 flex-1">{error}</p>
            <button onClick={() => setError(null)} className="text-red-400"><X className="w-4 h-4" /></button>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-6 py-6">
        {activeSection === 'finder' && (
          <div className="space-y-6">
            {/* Mega Stocks */}
            <div className="rounded-2xl border border-slate-800/50 bg-slate-900/30 overflow-hidden">
              <div className="p-4 border-b border-slate-800/50 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center"><Building2 className="w-4 h-4 text-amber-400" /></div>
                  <div><h2 className="font-semibold text-white">Mega Stocks</h2><p className="text-xs text-slate-500">Core singularity companies</p></div>
                </div>
                <button onClick={() => setEditingMega(!editingMega)} className="px-3 py-1.5 rounded-lg text-sm border border-slate-700/50 text-slate-400 hover:bg-slate-800">
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
              <div className="flex items-center justify-between">
                <div><h3 className="font-semibold text-white">Multi-Iteration Supplier Scan</h3><p className="text-xs text-slate-500">4-round AI analysis</p></div>
                <button onClick={runSupplierScan} disabled={isScanning} className="px-6 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2" style={{ background: isScanning ? 'rgba(245,158,11,0.2)' : 'linear-gradient(90deg, #f59e0b, #f97316)', color: isScanning ? '#fcd34d' : 'white' }}>
                  {isScanning ? <><RefreshCw className="w-4 h-4 animate-spin" />Scanning...</> : <><Play className="w-4 h-4" />Run Scan</>}
                </button>
              </div>
              {isScanning && (
                <div className="mt-4">
                  <div className="flex justify-between text-sm mb-2"><span className="text-slate-400">{scanStatus.message}</span><span className="text-amber-400 font-mono">Round {scanIteration}/4</span></div>
                  <div className="h-2 rounded-full bg-slate-800 overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all" style={{ width: `${scanStatus.progress}%` }} /></div>
                </div>
              )}
            </div>

            {/* Results */}
            {foundStocks.length > 0 && (
              <div className="rounded-2xl border border-slate-800/50 bg-slate-900/30 overflow-hidden">
                <div className="p-4 border-b border-slate-800/50 flex items-center justify-between">
                  <div className="flex items-center gap-3"><div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center"><Factory className="w-4 h-4 text-emerald-400" /></div><div><h2 className="font-semibold text-white">Found Suppliers</h2><p className="text-xs text-slate-500">{foundStocks.length} stocks</p></div></div>
                  <button onClick={() => setFoundStocks([])} className="p-2 rounded-lg text-slate-500 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
                </div>
                <div className="divide-y divide-slate-800/50">
                  {foundStocks.map((stock, i) => (
                    <div key={stock.ticker} className="p-4 hover:bg-slate-800/20">
                      <div className="flex items-center justify-between cursor-pointer" onClick={() => setExpandedStock(expandedStock === stock.ticker ? null : stock.ticker)}>
                        <div className="flex items-center gap-4">
                          <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center text-sm font-bold text-slate-400">{i + 1}</div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-white">{stock.ticker}</span>
                              <span className="px-2 py-0.5 rounded text-xs font-medium" style={{ background: SUPPLIER_CATEGORIES[stock.category]?.color + '20', color: SUPPLIER_CATEGORIES[stock.category]?.color }}>{stock.category}</span>
                            </div>
                            <p className="text-sm text-slate-400">{stock.name}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          {stock.price && <div className="text-right"><p className="font-mono text-white">${stock.price.toFixed(2)}</p><p className="text-xs text-slate-500">${stock.marketCap}M</p></div>}
                          <div className="text-right"><p className="text-2xl font-bold text-emerald-400">{stock.finalScore}</p><p className="text-xs text-slate-500">Score</p></div>
                          {expandedStock === stock.ticker ? <ChevronUp className="w-5 h-5 text-slate-500" /> : <ChevronDown className="w-5 h-5 text-slate-500" />}
                        </div>
                      </div>
                      {expandedStock === stock.ticker && (
                        <div className="mt-4 pt-4 border-t border-slate-800/50 space-y-3">
                          <div className="grid grid-cols-3 gap-4">
                            <div className="p-3 rounded-lg bg-slate-800/50"><p className="text-xs text-slate-500 mb-1">Singularity</p><p className="text-lg font-bold text-amber-400">{stock.singularityScore || 'N/A'}</p></div>
                            <div className="p-3 rounded-lg bg-slate-800/50"><p className="text-xs text-slate-500 mb-1">Conviction</p><p className="text-lg font-bold text-violet-400">{stock.convictionScore || 'N/A'}</p></div>
                            <div className="p-3 rounded-lg bg-slate-800/50"><p className="text-xs text-slate-500 mb-1">Confidence</p><p className="text-lg font-bold capitalize" style={{ color: stock.confidence === 'high' ? '#10B981' : stock.confidence === 'medium' ? '#F59E0B' : '#94a3b8' }}>{stock.confidence || 'N/A'}</p></div>
                          </div>
                          {stock.business && <div className="p-3 rounded-lg bg-slate-800/50"><p className="text-xs text-slate-500 mb-1">Business</p><p className="text-sm text-slate-300">{stock.business}</p></div>}
                          {stock.suppliesTo?.length > 0 && <div className="p-3 rounded-lg bg-slate-800/50"><p className="text-xs text-slate-500 mb-2">Supplies To</p><div className="flex flex-wrap gap-2">{stock.suppliesTo.map(t => <span key={t} className="px-2 py-1 rounded bg-amber-500/20 text-amber-400 text-xs font-mono">{t}</span>)}</div></div>}
                          {stock.deepAnalysis && <div className="p-3 rounded-lg bg-slate-800/50"><p className="text-xs text-slate-500 mb-2">Thesis</p><p className="text-sm text-slate-300">{stock.deepAnalysis.thesis}</p>{stock.deepAnalysis.targetUpside && <p className="mt-2 text-emerald-400 font-semibold">Target: {stock.deepAnalysis.targetUpside} in {stock.deepAnalysis.timeframe}</p>}</div>}
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
              <div className="flex items-center gap-3 mb-4"><div className="w-8 h-8 rounded-lg bg-violet-500/20 flex items-center justify-center"><Brain className="w-4 h-4 text-violet-400" /></div><div><h2 className="font-semibold text-white">Conviction Analysis</h2><p className="text-xs text-slate-500">Deep AI analysis</p></div></div>
              <div className="flex gap-3">
                <input type="text" value={researchTicker} onChange={e => setResearchTicker(e.target.value.toUpperCase())} placeholder="Enter ticker (e.g., NVDA)" className="flex-1 px-4 py-3 rounded-xl text-sm border bg-slate-800/50 border-slate-700/50 outline-none" onKeyDown={e => e.key === 'Enter' && runDeepResearch()} />
                <button onClick={runDeepResearch} disabled={isResearching || !researchTicker.trim()} className="px-6 py-3 rounded-xl text-sm font-semibold flex items-center gap-2" style={{ background: isResearching ? 'rgba(139,92,246,0.2)' : 'linear-gradient(90deg, #8b5cf6, #7c3aed)', color: isResearching ? '#a78bfa' : 'white', opacity: !researchTicker.trim() ? 0.5 : 1 }}>
                  {isResearching ? <><RefreshCw className="w-4 h-4 animate-spin" />Analyzing...</> : <><Brain className="w-4 h-4" />Analyze</>}
                </button>
              </div>
            </div>
            {researchResults.length > 0 && (
              <div className="rounded-2xl border border-slate-800/50 bg-slate-900/30 overflow-hidden">
                <div className="p-4 border-b border-slate-800/50 flex items-center justify-between">
                  <div className="flex items-center gap-3"><div className="w-8 h-8 rounded-lg bg-violet-500/20 flex items-center justify-center"><Sparkles className="w-4 h-4 text-violet-400" /></div><div><h2 className="font-semibold text-white">Research Results</h2><p className="text-xs text-slate-500">{researchResults.length} analyzed</p></div></div>
                  <button onClick={() => setResearchResults([])} className="p-2 rounded-lg text-slate-500 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
                </div>
                <div className="divide-y divide-slate-800/50">
                  {researchResults.map(r => (
                    <div key={r.ticker} className="p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3"><span className="font-mono font-bold text-xl text-white">{r.ticker}</span><span className="text-sm text-slate-400">{r.name}</span></div>
                        <div className="flex items-center gap-4">
                          {r.price && <div className="text-right"><p className="font-mono text-white">${r.price.toFixed(2)}</p><p className="text-xs text-slate-500">${r.marketCap}M</p></div>}
                          {r.convictionScore !== null && <div className="text-right"><p className={`text-2xl font-bold ${r.convictionScore >= 70 ? 'text-emerald-400' : r.convictionScore >= 50 ? 'text-amber-400' : 'text-red-400'}`}>{r.convictionScore}</p><p className="text-xs text-slate-500">Conviction</p></div>}
                        </div>
                      </div>
                      {r.analysis && <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/50"><p className="text-sm text-slate-300 whitespace-pre-wrap">{r.analysis}</p></div>}
                      <div className="mt-3 flex items-center gap-4 text-xs text-slate-500">
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
