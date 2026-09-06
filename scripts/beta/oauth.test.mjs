import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { oauthRequest, oauthAuthorized, sign, RESOURCE, ISSUER, SCOPE } from '../../lib/codexBetaOAuth.mjs';
import { mcpRequest } from '../../lib/codexBetaMcp.mjs';
test('OAuth binds code to owner login, redirect, audience and PKCE; rejects replay and unlinked tool writes', async () => {
  const names = ['CODEX_BETA_CLOUD_SECRET', 'SITE_PASSWORD', 'KV_REST_API_URL', 'KV_REST_API_TOKEN'];
  const old = Object.fromEntries(names.map(n => [n, process.env[n]])), oldFetch = globalThis.fetch, db = new Map();
  process.env.CODEX_BETA_CLOUD_SECRET = 'x'.repeat(48); process.env.SITE_PASSWORD = 'fixture';
  process.env.KV_REST_API_URL = 'https://test.invalid'; process.env.KV_REST_API_TOKEN = 'fixture';
  globalThis.fetch = async (_u, opts) => {
    const [op, ...a] = JSON.parse(opts.body); let result;
    if (op === 'GET') result = db.get(a[0]) || null;
    else if (op === 'SET') { if (a.includes('NX') && db.has(a[0])) result = null; else { db.set(a[0], a[1]); result = 'OK'; } }
    else if (op === 'EVAL' && a[0].includes('INCR')) result = 1;
    else if (op === 'EVAL') { result = db.get(a[2]) === a[3] ? 1 : 0; if (result) db.delete(a[2]); }
    else throw new Error('Unexpected storage access');
    return { ok: true, json: async () => ({ result }) };
  };
  const post = (action, body, headers = {}) => oauthRequest(new Request(`${ISSUER}/api/codex-beta/oauth/${action}`, { method: 'POST', headers, body }), action);
  try {
    assert.equal((await post('register', JSON.stringify({ redirect_uris: ['https://evil.example'] }))).status, 400);
    const callback = 'https://chatgpt.com/connector_platform_oauth_redirect';
    const client = await (await post('register', JSON.stringify({ redirect_uris: [callback], token_endpoint_auth_method: 'none' }))).json();
    const verifier = 'v'.repeat(43);
    const params = new URLSearchParams({ client_id: client.client_id, redirect_uri: callback, response_type: 'code', scope: SCOPE, resource: RESOURCE,
      code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url'), state: 'fixture-state' });
    const page = await oauthRequest(new Request(`${ISSUER}/api/codex-beta/oauth/authorize?${params}`), 'authorize');
    assert.equal(page.status, 200);
    assert.ok(page.headers.get('content-security-policy').includes(`form-action 'self' ${callback};`));
    const cookie = page.headers.get('set-cookie').split(';')[0];
    const flow = (await page.text()).match(/name="flow" value="([^"]+)"/)[1];
    assert.equal((await post('authorize', new URLSearchParams({ flow, password: 'fixture' }), { origin: 'https://evil.example', cookie })).status, 403);
    const accepted = await post('authorize', new URLSearchParams({ flow, password: 'fixture' }), { origin: ISSUER, cookie });
    assert.equal(accepted.status, 303);
    const code = new URL(accepted.headers.get('location')).searchParams.get('code');
    const tokenParams = { grant_type: 'authorization_code', code, client_id: client.client_id, redirect_uri: callback, resource: RESOURCE, code_verifier: verifier };
    assert.equal((await post('token', new URLSearchParams({ ...tokenParams, code_verifier: 'bad' }))).status, 400);
    const tokens = await (await post('token', new URLSearchParams(tokenParams))).json();
    assert.ok(tokens.access_token);
    assert.equal((await post('token', new URLSearchParams(tokenParams))).status, 400);
    assert.equal(oauthAuthorized(new Request(RESOURCE, { headers: { authorization: `Bearer ${tokens.access_token}` } })), true);
    assert.equal(oauthAuthorized(new Request(RESOURCE, { headers: { authorization: `Bearer ${sign({ aud: 'wrong', scope: SCOPE }, 'access', 60)}` } })), false);
    const refresh = new URLSearchParams({ grant_type: 'refresh_token', client_id: client.client_id, resource: RESOURCE, refresh_token: tokens.refresh_token });
    assert.equal((await post('token', refresh)).status, 200);
    assert.equal((await post('token', refresh)).status, 400);
    const reply = await (await mcpRequest(new Request(RESOURCE, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'beta_claim_next' } }) }))).json();
    assert.equal(reply.result.isError, true); assert.ok(reply.result._meta['mcp/www_authenticate']);
  } finally { globalThis.fetch = oldFetch; for (const n of names) if (old[n] === undefined) delete process.env[n]; else process.env[n] = old[n]; }
});
