// Minimal Upstash Redis REST helpers (server-side only)
const URL_ = process.env.KV_REST_API_URL;
const TOKEN = process.env.KV_REST_API_TOKEN;

async function cmd(...args) {
  const res = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`KV error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).result;
}

export async function kvGetJSON(key) {
  const raw = await cmd('GET', key);
  if (raw === null || raw === undefined) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function kvSetJSON(key, value) {
  return cmd('SET', key, JSON.stringify(value));
}

export async function kvDel(key) {
  return cmd('DEL', key);
}

// Distributed lock: returns true if acquired
export async function kvLock(key, ttlMs) {
  const r = await cmd('SET', key, '1', 'NX', 'PX', String(ttlMs));
  return r === 'OK';
}

export function kvConfigured() {
  return Boolean(URL_ && TOKEN);
}

// Workspace-scoped keys. 'main' keeps the legacy unprefixed keys.
export function wsKey(ws, name) {
  return ws && ws !== 'main' ? `vh:${ws}:${name}` : `vh:${name}`;
}
export function wsFrom(request, body) {
  const q = new URL(request.url).searchParams.get('ws');
  const w = (body && body.ws) || q || 'main';
  return w === 'test' ? 'test' : 'main';
}
