import { createHmac, createHash, randomUUID, timingSafeEqual } from 'node:crypto';
export const ISSUER = 'https://valuehunter-v2.vercel.app';
export const RESOURCE = `${ISSUER}/api/codex-beta/mcp`;
export const SCOPE = 'beta:research';
const CALLBACK = 'https://chatgpt.com/connector_platform_oauth_redirect';
const COOKIE = 'vh_beta_oauth';
const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
const json = (body, status = 200) => Response.json(body, { status, headers });
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
function key() { const k = process.env.CODEX_BETA_CLOUD_SECRET; if (!k || k.length < 32) throw new Error('Cloud authentication not configured'); return k; }
export function sign(payload, kind, seconds) {
  const body = Buffer.from(JSON.stringify({ ...payload, kind, iss: ISSUER, exp: Date.now() + seconds * 1000 })).toString('base64url');
  return `${body}.${createHmac('sha256', key()).update(body).digest('base64url')}`;
}
export function verify(token, kind) {
  try {
    if (typeof token !== 'string' || token.length > 12000) return null;
    const [body, sig, extra] = token.split('.');
    if (extra || !equal(sig, createHmac('sha256', key()).update(body).digest('base64url'))) return null;
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.kind === kind && p.iss === ISSUER && p.exp > Date.now() ? p : null;
  } catch { return null; }
}
export function oauthAuthorized(request) {
  const p = verify((request.headers.get('authorization') || '').replace(/^Bearer /, ''), 'access');
  return !!p && p.aud === RESOURCE && p.scope === SCOPE;
}
async function redis(...args) {
  const r = await fetch(process.env.KV_REST_API_URL, { method: 'POST', cache: 'no-store', headers: {
    Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`, 'Content-Type': 'application/json',
  }, body: JSON.stringify(args) });
  const d = await r.json(); if (!r.ok || d.error) throw new Error('Auth storage unavailable'); return d.result;
}
const hash = text => createHash('sha256').update(text).digest('hex');
function validFlow(p) {
  const client = verify(p.client_id, 'client');
  return client && client.redirect === CALLBACK && p.redirect_uri === CALLBACK &&
    p.response_type === 'code' && p.resource === RESOURCE && p.scope === SCOPE &&
    p.code_challenge_method === 'S256' && /^[A-Za-z0-9_-]{43}$/.test(p.code_challenge || '') &&
    typeof p.state === 'string' && p.state.length <= 2000;
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function browserNonce(request) {
  const value = (request.headers.get('cookie') || '').split(';').map(v => v.trim()).find(v => v.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  return /^[0-9a-f-]{36}$/.test(value || '') ? value : null;
}
function authPage({ flow, nonce, message = '', status = 200 }) {
  const styleNonce = randomUUID();
  const form = flow ? `<form method="post" action="/api/codex-beta/oauth/authorize"><input type="hidden" name="flow" value="${esc(flow)}"><label for="password">Your ValueHunter trade-record password</label><input id="password" type="password" name="password" required autocomplete="current-password" autofocus><button type="submit">Connect to ChatGPT</button></form>` : '<a class="button" href="https://chatgpt.com/plugins">Return to ChatGPT Plugins</a><p>Open ValueHunter ChatGPT Beta and choose Connect to start a fresh sign-in.</p>';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect ValueHunter</title><style nonce="${styleNonce}">*{box-sizing:border-box}body{margin:0;background:#0b1120;color:#e2e8f0;font:16px/1.6 system-ui,sans-serif;min-height:100vh;display:grid;place-items:center;padding:24px}main{width:100%;max-width:480px;background:#121c2e;border:1px solid #2b3a52;border-radius:20px;padding:32px}small{color:#67e8f9;font-weight:700;letter-spacing:.06em}h1{font-size:28px;line-height:1.2;margin:12px 0 18px}p{color:#b8c5d8}label{display:block;font-weight:600;margin:24px 0 8px}input{width:100%;padding:13px;background:#0b1120;color:white;border:1px solid #51617a;border-radius:8px;font:inherit}button,.button{display:block;width:100%;padding:13px;margin-top:16px;border:0;border-radius:8px;background:#67e8f9;color:#082f49;font:600 16px system-ui;text-align:center;text-decoration:none;cursor:pointer}.notice{padding:12px;border:1px solid #fbbf24;border-radius:8px;color:#fde68a}footer{font-size:13px;color:#94a3b8;margin-top:24px}</style></head><body><main><small>VALUEHUNTER · CHATGPT BETA</small><h1>${flow ? 'Connect your research' : 'Start a fresh sign-in'}</h1><p>Let ChatGPT research stocks you queue and save its separate beta assessments.</p>${message ? `<p class="notice" role="alert">${esc(message)}</p>` : ''}${form}<footer>This connection cannot trade, start paid Grok scans, change settings, or edit Claude research. Your password stays with ValueHunter.</footer></main></body></html>`;
  return new Response(html, { status, headers: { ...headers, 'Referrer-Policy': 'same-origin', 'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': `default-src 'none'; style-src 'nonce-${styleNonce}'; form-action 'self' https://chatgpt.com/connector_platform_oauth_redirect; frame-ancestors 'none'; base-uri 'none'`,
    ...(nonce ? { 'Set-Cookie': `${COOKIE}=${nonce}; Path=/api/codex-beta/oauth; HttpOnly; Secure; SameSite=Lax; Max-Age=600` } : {}) } });
}
export const oauthMetadata = () => ({ issuer: ISSUER, authorization_response_iss_parameter_supported: true,
  authorization_endpoint: `${ISSUER}/api/codex-beta/oauth/authorize`, token_endpoint: `${ISSUER}/api/codex-beta/oauth/token`,
  registration_endpoint: `${ISSUER}/api/codex-beta/oauth/register`, response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'], token_endpoint_auth_methods_supported: ['none'],
  code_challenge_methods_supported: ['S256'], scopes_supported: [SCOPE] });
export const resourceMetadata = () => ({ resource: RESOURCE, authorization_servers: [ISSUER], scopes_supported: [SCOPE] });

export async function oauthRequest(request, action) {
  try {
    key();
    if (action === 'register' && request.method === 'POST') {
      const raw = await request.text(); if (raw.length > 10000) return json({ error: 'invalid_client_metadata' }, 400);
      const p = JSON.parse(raw);
      if (!Array.isArray(p.redirect_uris) || p.redirect_uris.length !== 1 || p.redirect_uris[0] !== CALLBACK ||
          (p.token_endpoint_auth_method && p.token_endpoint_auth_method !== 'none')) return json({ error: 'invalid_client_metadata' }, 400);
      const client_id = sign({ redirect: CALLBACK, id: randomUUID() }, 'client', 10 * 365 * 86400);
      return json({ client_id, redirect_uris: [CALLBACK], token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }, 201);
    }
    if (action === 'authorize' && request.method === 'GET') {
      const p = Object.fromEntries(new URL(request.url).searchParams);
      if (!validFlow(p)) return authPage({ message: 'This connection link is invalid or has expired.', status: 400 });
      const nonce = browserNonce(request) || randomUUID(), flow = sign({ p, nonce }, 'flow', 600);
      return authPage({ flow, nonce });
    }
    if (action === 'authorize' && request.method === 'POST') {
      if (request.headers.get('origin') !== ISSUER) return authPage({ message: 'The browser could not verify this sign-in. Start a fresh connection from ChatGPT.', status: 403 });
      const raw = await request.text(); if (raw.length > 18000) return authPage({ message: 'The sign-in request was not valid.', status: 400 });
      const f = new URLSearchParams(raw), flow = verify(f.get('flow'), 'flow');
      const nonce = browserNonce(request);
      if (!flow || !equal(nonce, flow.nonce) || !validFlow(flow.p)) return authPage({ message: 'This sign-in has expired or its browser cookie is missing. Please reconnect from ChatGPT.', status: 400 });
      const attempts = await redis('EVAL', "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n", 1, 'vh:codex-beta:auth:attempts');
      if (attempts > 5) return authPage({ flow: f.get('flow'), nonce, message: 'Too many attempts. Please wait one minute before trying again.', status: 429 });
      if (!process.env.SITE_PASSWORD || !equal(f.get('password'), process.env.SITE_PASSWORD)) return authPage({ flow: f.get('flow'), nonce, message: 'That password was not recognized. Use your ValueHunter trade-record password.', status: 401 });
      const code = randomUUID() + randomUUID();
      await redis('SET', `vh:codex-beta:auth:code:${hash(code)}`, JSON.stringify(flow.p), 'EX', 300);
      const redirect = new URL(CALLBACK); redirect.searchParams.set('code', code); redirect.searchParams.set('state', flow.p.state); redirect.searchParams.set('iss', ISSUER);
      return new Response(null, { status: 303, headers: { ...headers, Location: redirect.href,
        'Set-Cookie': `${COOKIE}=; Path=/api/codex-beta/oauth; HttpOnly; Secure; SameSite=Lax; Max-Age=0` } });
    }
    if (action === 'token' && request.method === 'POST') {
      const raw = await request.text(); if (raw.length > 18000) return json({ error: 'invalid_request' }, 400);
      const p = Object.fromEntries(new URLSearchParams(raw));
      if (!verify(p.client_id, 'client') || p.resource !== RESOURCE) return json({ error: 'invalid_client' }, 400);
      if (p.grant_type === 'authorization_code') {
        const k = `vh:codex-beta:auth:code:${hash(p.code || '')}`;
        const stored = await redis('GET', k), c = stored ? JSON.parse(stored) : null;
        if (!c || c.client_id !== p.client_id || c.redirect_uri !== p.redirect_uri || !/^[A-Za-z0-9._~-]{43,128}$/.test(p.code_verifier || '') ||
          createHash('sha256').update(p.code_verifier).digest('base64url') !== c.code_challenge) return json({ error: 'invalid_grant' }, 400);
        const consumed = await redis('EVAL', "if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end; redis.call('DEL',KEYS[1]); return 1", 1, k, stored);
        if (!consumed) return json({ error: 'invalid_grant' }, 400);
      } else if (p.grant_type === 'refresh_token') {
        const r = verify(p.refresh_token, 'refresh');
        if (!r || r.client_id !== p.client_id || r.aud !== RESOURCE || r.scope !== SCOPE) return json({ error: 'invalid_grant' }, 400);
        const unused = await redis('SET', `vh:codex-beta:auth:refresh:${hash(p.refresh_token)}`, 'used', 'NX', 'PX', Math.max(1, r.exp - Date.now()));
        if (!unused) return json({ error: 'invalid_grant' }, 400);
      } else return json({ error: 'unsupported_grant_type' }, 400);
      const claims = { aud: RESOURCE, scope: SCOPE, client_id: p.client_id, jti: randomUUID() };
      return json({ access_token: sign(claims, 'access', 3600), refresh_token: sign(claims, 'refresh', 30 * 86400),
        token_type: 'Bearer', expires_in: 3600, scope: SCOPE });
    }
    return json({ error: 'Not found' }, 404);
  } catch { return action === 'authorize' ? authPage({ message: 'Sign-in is temporarily unavailable. Please try again shortly.', status: 503 }) : json({ error: 'Authentication unavailable' }, 503); }
}
