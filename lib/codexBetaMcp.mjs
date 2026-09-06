import { oauthAuthorized, ISSUER, SCOPE } from './codexBetaOAuth.mjs';
import { betaState, claim, complete } from './codexBetaStore.mjs';
import harness from './codexBetaHarness.json' with { type: 'json' };
const empty = { type: 'object', properties: {}, additionalProperties: false };
const spec = (name, description, readOnlyHint, inputSchema = empty) => ({ name, description,
  inputSchema, annotations: { readOnlyHint, destructiveHint: false, openWorldHint: false, idempotentHint: readOnlyHint },
  securitySchemes: [{ type: 'oauth2', scopes: [SCOPE] }] });
const tools = [
  spec('beta_status', 'Read the owner-queued ValueHunter ChatGPT Beta batch status. Includes the combined stock research instructions. Never starts scans or spends API credits.', true),
  spec('beta_claim_next', 'Claim one next stock from an already running owner-approved beta batch. Returns stock context and a private 30-minute claim token. Returns idle when paused, busy or complete. No AI API calls.', false),
  spec('beta_save_assessment', 'Save the eight-dimensional combined stock assessment for an owned beta claim. Requires all eight assessments, evidence sources and honest nulls for missing data. Writes only ChatGPT Beta results, not Grok or trading data.', false, {
    type: 'object', properties: { runId: { type: 'string' }, token: { type: 'string' }, model: { type: 'string' }, result: { type: 'object', additionalProperties: true } }, required: ['runId', 'token', 'model', 'result'], additionalProperties: false,
  }),
];
export async function mcpRequest(request) {
  const headers = { 'Cache-Control': 'no-store' };
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { ...headers, Allow: 'POST' } });
  let msg;
  try { const raw = await request.text(); if (Buffer.byteLength(raw) > 100000) return new Response(null, { status: 413 }); msg = JSON.parse(raw); }
  catch { return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON' } }, { status: 400, headers }); }
  const reply = result => Response.json({ jsonrpc: '2.0', id: msg.id ?? null, result }, { headers });
  const error = (code, message) => Response.json({ jsonrpc: '2.0', id: msg.id ?? null, error: { code, message } }, { headers });
  if (msg?.jsonrpc !== '2.0' || typeof msg.method !== 'string') return error(-32600, 'Invalid request');
  if (msg.method === 'initialize') return reply({ protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'valuehunter-beta', version: '1.0.0' } });
  if (msg.method.startsWith('notifications/')) return new Response(null, { status: 202, headers });
  if (msg.method === 'ping') return reply({});
  if (msg.method === 'tools/list') return reply({ tools });
  if (msg.method !== 'tools/call') return error(-32601, 'Method not found');
  if (!tools.some(t => t.name === msg.params?.name)) return error(-32602, 'Unknown tool');
  if (!oauthAuthorized(request)) return reply({ isError: true, content: [{ type: 'text', text: 'Connect your ValueHunter account to use beta research.' }],
    _meta: { 'mcp/www_authenticate': [`Bearer resource_metadata="${ISSUER}/.well-known/oauth-protected-resource", error="invalid_token", error_description="Connect ValueHunter beta research"`] } });
  try {
    let data;
    if (msg.params.name === 'beta_status') {
      const { run } = await betaState();
      data = { run: run ? { id: run.id, ws: run.ws, status: run.status, completed: run.completed.length, total: run.targets.length, currentTicker: run.claim?.ticker || null } : null, harness };
    } else if (msg.params.name === 'beta_claim_next') data = await claim();
    else data = await complete(msg.params.arguments || {});
    return reply({ content: [{ type: 'text', text: JSON.stringify(data) }] });
  } catch { return reply({ isError: true, content: [{ type: 'text', text: 'Could not complete request. Check the active claim and result schema; do not repeat research or override cancelled/expired work.' }] }); }
}
