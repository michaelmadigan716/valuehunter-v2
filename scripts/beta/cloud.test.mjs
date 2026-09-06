import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudRequest } from '../../lib/codexBetaCloud.mjs';

test('cloud connection fails closed and cannot start jobs or accept browser cookies', async () => {
  const old = process.env.CODEX_BETA_CLOUD_SECRET;
  const req = (headers = {}, body = { action: 'start' }) => new Request('https://example.com/api/codex-beta/cloud', {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  try {
    delete process.env.CODEX_BETA_CLOUD_SECRET;
    assert.equal((await cloudRequest(req())).status, 401);
    process.env.CODEX_BETA_CLOUD_SECRET = 'x'.repeat(48);
    assert.equal((await cloudRequest(req({ cookie: 'vh_beta_control=anything' }))).status, 401);
    assert.equal((await cloudRequest(req({ authorization: 'Bearer wrong' }))).status, 401);
    const headers = { authorization: `Bearer ${process.env.CODEX_BETA_CLOUD_SECRET}` };
    for (const action of ['start', 'resume', 'cancel', 'redis', 'grok']) {
      assert.equal((await cloudRequest(req(headers, { action }))).status, 400);
    }
    assert.equal((await cloudRequest(req(headers, { action: 'complete', data: 'x'.repeat(100001) }))).status, 413);
  } finally {
    if (old === undefined) delete process.env.CODEX_BETA_CLOUD_SECRET;
    else process.env.CODEX_BETA_CLOUD_SECRET = old;
  }
});
