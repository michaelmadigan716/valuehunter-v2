'use client';
// Shared bits for the Stock Explainers pages.
export const C = { up: '#34d399', down: '#f87171', warn: '#fbbf24', cyan: '#22d3ee', mute: '#64748b', text: '#cbd5e1' };
export const BRAND = 'Stock Explainers';

export const ago = (ts) => { if (!ts) return ''; const m = Math.round((Date.now() - ts) / 60000); if (m < 60) return `${Math.max(1, m)}m ago`; const h = Math.round(m / 60); if (h < 48) return `${h}h ago`; return `${Math.round(h / 24)}d ago`; };
export const cleanTicker = (t) => String(t || '').trim().toUpperCase().replace(/^\$/, '').replace(/[^A-Z0-9.\-]/g, '').slice(0, 10);
export const verdictColor = (v) => /bull|buy|cheap|strong/i.test(v || '') ? C.up : /bear|avoid|expensive|weak/i.test(v || '') ? C.down : C.warn;
export const levelLabel = (l) => l === 'film' ? 'Full film' : l === 'deep' ? 'Deep research' : 'Brief';

export const Shell = ({ children }) => (
  <div className="min-h-screen text-slate-200" style={{ background: 'radial-gradient(1200px 600px at 20% -10%, rgba(34,211,238,0.08), transparent), #020617' }}>
    <div className="max-w-5xl mx-auto px-4 py-6">
      <header className="flex items-center justify-between mb-6">
        <a href="/explain" className="text-lg font-semibold tracking-tight text-slate-100">{BRAND}</a>
        <nav className="flex gap-3 text-xs text-slate-400">
          <a href="/explain" className="hover:text-cyan-400">All stocks</a>
          <a href="/thinking" className="hover:text-cyan-400">Boards</a>
          <a href="/" className="hover:text-cyan-400">Screener</a>
        </nav>
      </header>
      {children}
      <footer className="mt-10 pt-4 border-t border-slate-800 text-[11px] leading-relaxed text-slate-500">
        Education only. Nothing here is financial, investment or tax advice. Every page shows the date its figures were last checked; prices and facts change. Scenarios are illustrations, not predictions or price targets.
      </footer>
    </div>
  </div>
);

export const Box = ({ title, right, children, className = '' }) => (
  <div className={`rounded-2xl border p-4 ${className}`} style={{ background: 'rgba(15,23,42,0.6)', borderColor: 'rgba(51,65,85,0.5)' }}>
    {(title || right) && <div className="flex items-center justify-between mb-2"><h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h3>{right}</div>}
    {children}
  </div>
);

export const Tag = ({ children, color = C.mute }) => (
  <span className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full border whitespace-nowrap" style={{ color, borderColor: `${color}66`, background: `${color}14` }}>{children}</span>
);

export function SearchBox({ initial = '', autoFocus }) {
  const go = (e) => { e.preventDefault(); const t = cleanTicker(new FormData(e.currentTarget).get('t')); if (t) window.location.href = `/explain/${t}`; };
  return (
    <form onSubmit={go} className="flex gap-2">
      <input name="t" defaultValue={initial} autoFocus={autoFocus} placeholder="Type a ticker, e.g. MOD" autoCapitalize="characters" autoComplete="off"
        className="flex-1 rounded-xl border px-4 py-3 text-base bg-slate-900/70 border-slate-700 text-slate-100 placeholder:text-slate-500 outline-none focus:border-cyan-500" />
      <button className="rounded-xl px-5 py-3 text-sm font-semibold" style={{ background: C.cyan, color: '#02202a' }}>Look up</button>
    </form>
  );
}
