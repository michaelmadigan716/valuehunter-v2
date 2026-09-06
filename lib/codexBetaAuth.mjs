import { createHmac, timingSafeEqual } from 'node:crypto';
const COOKIE = 'vh_beta_control';
function equal(a, b) { const aa = Buffer.from(a), bb = Buffer.from(b); return aa.length === bb.length && timingSafeEqual(aa, bb); }
function signature(expiry) { return createHmac('sha256', process.env.SITE_PASSWORD).update(`codex-beta:${expiry}`).digest('hex'); }
export function authorized(request) {
  if (!process.env.SITE_PASSWORD) return false;
  const value = (request.headers.get('cookie') || '').split(';').map(s => s.trim()).find(s => s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) || '';
  const [expiry, sig] = value.split('.');
  return /^\d+$/.test(expiry || '') && Number(expiry) > Date.now() && equal(sig || '', signature(expiry));
}
export function login(request, password) {
  if (!process.env.SITE_PASSWORD || typeof password !== 'string' || !equal(password, process.env.SITE_PASSWORD)) return null;
  const expiry = String(Date.now() + 30 * 864e5);
  return `${COOKIE}=${expiry}.${signature(expiry)}; HttpOnly; SameSite=Strict; Path=/api/codex-beta; Max-Age=2592000${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}
