// Barchart-style "Technical Opinion": 13 standard indicators, each voting
// buy / sell / hold. Opinion % = net buy votes over 13 (like "88% Buy").
// Inputs: daily bars [{c, h, l}] oldest -> newest, ideally 200+ days.

function sma(vals, n) {
  if (vals.length < n) return null;
  let s = 0;
  for (let i = vals.length - n; i < vals.length; i++) s += vals[i];
  return s / n;
}
function ema(vals, n) {
  if (vals.length < n) return null;
  const k = 2 / (n + 1);
  let e = sma(vals.slice(0, n), n);
  for (let i = n; i < vals.length; i++) e = vals[i] * k + e * (1 - k);
  return e;
}
function rsi(closes, n = 14) {
  if (closes.length < n + 1) return null;
  let gains = 0, losses = 0;
  for (let i = closes.length - n; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  if (losses === 0) return 100;
  const rs = (gains / n) / (losses / n);
  return 100 - 100 / (1 + rs);
}
function cci(bars, n = 40) {
  if (bars.length < n) return null;
  const tp = bars.slice(-n).map(b => (b.h + b.l + b.c) / 3);
  const mean = tp.reduce((a, b) => a + b, 0) / n;
  const dev = tp.reduce((a, b) => a + Math.abs(b - mean), 0) / n;
  return dev === 0 ? 0 : (tp[tp.length - 1] - mean) / (0.015 * dev);
}

export function computeTechnicalOpinion(bars) {
  if (!bars || bars.length < 60) return null;
  const closes = bars.map(b => b.c);
  const price = closes[closes.length - 1];
  const vote = (name, cond, available = true) => ({ name, signal: !available ? 'hold' : cond === null ? 'hold' : cond ? 'buy' : 'sell' });
  const ma = { 20: sma(closes, 20), 50: sma(closes, 50), 100: sma(closes, 100), 200: sma(closes, 200) };
  const em = { 20: ema(closes, 20), 50: ema(closes, 50), 100: ema(closes, 100), 150: ema(closes, 150), 200: ema(closes, 200) };
  const macd = (a, b) => (em[a] !== null && em[b] !== null ? em[a] - em[b] > 0 : null);
  const bb = (() => {
    if (closes.length < 20) return null;
    const m = ma[20]; const sd = Math.sqrt(closes.slice(-20).reduce((s, c) => s + (c - m) ** 2, 0) / 20);
    return sd === 0 ? null : (price - m) / (2 * sd); // >0 upper half of band
  })();
  const c40 = cci(bars, 40);
  const r14 = rsi(closes, 14);

  const signals = [
    vote('Price vs 20-day MA', ma[20] !== null ? price > ma[20] : null),
    vote('20-50 day MACD', macd(20, 50)),
    vote('20-100 day MACD', macd(20, 100)),
    vote('20-200 day MACD', macd(20, 200)),
    vote('Price vs 50-day MA', ma[50] !== null ? price > ma[50] : null),
    vote('20-50 day MA crossover', ma[20] !== null && ma[50] !== null ? ma[20] > ma[50] : null),
    vote('50-100 day MACD', macd(50, 100)),
    vote('50-150 day MACD', macd(50, 150)),
    vote('50-200 day MACD', macd(50, 200)),
    vote('Price vs 100-day MA', ma[100] !== null ? price > ma[100] : null),
    vote('100-200 day MACD', macd(100, 200)),
    vote('Price vs 200-day MA', ma[200] !== null ? price > ma[200] : null),
    vote('20-day Bollinger / 40-day CCI / RSI', bb !== null && c40 !== null && r14 !== null ? (bb > 0 ? 1 : 0) + (c40 > 0 ? 1 : 0) + (r14 > 50 ? 1 : 0) >= 2 : null),
  ];
  const buys = signals.filter(s => s.signal === 'buy').length;
  const sells = signals.filter(s => s.signal === 'sell').length;
  const net = buys - sells;
  const pct = Math.round(Math.abs(net) / 13 * 100);
  const opinion = net === 0 ? 'Hold' : `${pct}% ${net > 0 ? 'Buy' : 'Sell'}`;
  return {
    techScore: Math.round((buys / 13) * 100),
    techOpinion: opinion,
    techBuys: buys, techSells: sells,
    techSignals: signals,
  };
}
