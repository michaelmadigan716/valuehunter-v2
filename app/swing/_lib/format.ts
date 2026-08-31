const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function money(n: number | null | undefined, cents = false): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return (cents ? usd2 : usd0).format(n);
}
/** Signed money: +$1,234 / −$1,234 */
export function pnl(n: number | null | undefined, cents = false): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const s = (cents ? usd2 : usd0).format(Math.abs(n));
  return n < 0 ? `−${s}` : `+${s}`;
}
export function compact(n: number): string {
  const a = Math.abs(n);
  const s = a >= 1e6 ? `$${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M` : a >= 1e3 ? `$${(a / 1e3).toFixed(0)}K` : `$${a.toFixed(0)}`;
  return n < 0 ? `−${s}` : s;
}
export function pct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const s = `${Math.abs(n).toFixed(digits)}%`;
  return n < 0 ? `−${s}` : `+${s}`;
}
export function shares(n: number): string {
  return num.format(Math.abs(n));
}
export function price(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return usd2.format(n);
}
export function days(n: number): string {
  if (n < 1) return "same day";
  if (n === 1) return "1 day";
  if (n < 60) return `${n} days`;
  if (n < 365) return `${(n / 30.4).toFixed(1)} mo`;
  return `${(n / 365).toFixed(1)} yr`;
}
export function pnlClass(n: number | null | undefined): string {
  if (n === null || n === undefined) return "text-muted";
  return n > 0 ? "text-gain" : n < 0 ? "text-loss" : "text-muted";
}
