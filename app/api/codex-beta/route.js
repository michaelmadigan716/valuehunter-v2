import { betaState, control } from '../../../lib/codexBetaStore.mjs';
import { authorized, login } from '../../../lib/codexBetaAuth.mjs';
export const dynamic = 'force-dynamic';
export async function GET(request) {
  try {
    const { run, results } = await betaState();
    return Response.json({ canControl: authorized(request), run: run ? { ...run, claim: run.claim ? { ticker: run.claim.ticker, expiresAt: run.claim.expiresAt } : null } : null, results });
  } catch { return Response.json({ error: 'Beta storage unavailable' }, { status: 503 }); }
}
export async function POST(request) {
  // Controls only; this route cannot write scores or invoke any model/API.
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin) return Response.json({ error: 'Forbidden' }, { status: 403 });
  try {
    const body = await request.json();
    if (body.action === 'login') {
      const cookie = login(request, body.password);
      return cookie ? Response.json({ ok: true }, { headers: { 'Set-Cookie': cookie } }) : Response.json({ error: 'Incorrect site password' }, { status: 401 });
    }
    if (!authorized(request)) return Response.json({ error: 'Unlock beta controls with your existing trade-record site password' }, { status: 401 });
    if (!['start', 'pause', 'resume', 'cancel'].includes(body.action)) return Response.json({ error: 'Unknown action' }, { status: 400 });
    const run = await control(body.action, body);
    return Response.json({ ok: true, run: { ...run, claim: run.claim ? { ticker: run.claim.ticker, expiresAt: run.claim.expiresAt } : null } });
  } catch (e) { return Response.json({ error: e.message }, { status: 409 }); }
}
