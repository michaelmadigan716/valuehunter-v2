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
      if (!validFlow(p)) return json({ error: 'invalid_request' }, 400);
      const nonce = randomUUID(), flow = sign({ p, nonce }, 'flow', 600);
      const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect ValueHunter</title></head><body><main><h1>Connect ValueHunter ChatGPT Beta</h1><p>Allow ChatGPT to read queued stock context, claim one stock at a time, and save beta assessments. This does not grant access to trading, Grok scans, settings, or Claude research.</p><form method="post"><input type="hidden" name="flow" value="${esc(flow)}"><label>ValueHunter trade-record password <input type="password" name="password" required autocomplete="current-password"></label><button type="submit">Authorize beta research</button></form></main></body></html>`;
      return new Response(html, { headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "default-src 'none'; form-action 'self' https://chatgpt.com/connector_platform_oauth_redirect; frame-ancestors 'none'; base-uri 'none'",
        'Set-Cookie': `${COOKIE}=${nonce}; Path=/api/codex-beta/oauth; HttpOnly; Secure; SameSite=Lax; Max-Age=600` } });
    }
    if (action === 'authorize' && request.method === 'POST') {
      if (request.headers.get('origin') !== ISSUER) return json({ error: 'invalid_request' }, 403);
      const raw = await request.text(); if (raw.length > 18000) return json({ error: 'invalid_request' }, 400);
      const f = new URLSearchParams(raw), flow = verify(f.get('flow'), 'flow');
      const nonce = (request.headers.get('cookie') || '').split(';').map(v => v.trim()).find(v => v.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
      if (!flow || !equal(nonce, flow.nonce) || !validFlow(flow.p)) return json({ error: 'invalid_request' }, 400);
      const attempts = await redis('EVAL', "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n", 1, 'vh:codex-beta:auth:attempts');
      if (attempts > 5) return json({ error: 'Try again in one minute' }, 429);
      if (!process.env.SITE_PASSWORD || !equal(f.get('password'), process.env.SITE_PASSWORD)) return json({ error: 'Incorrect site password; go back to retry' }, 401);
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
  } catch { return json({ error: 'Authentication unavailable' }, 503); }
}
