# ChatGPT Beta

A separate scan-results provider inside the existing ValueHunter table. One
signed-in Codex research pass per eligible stock produces eight assessments.
The app queues work and displays saved results; it never calls an OpenAI API.
Grok settings, results and Claude's Always Thinking engine are independent.

The runner is a Codex task on the owner's computer, with subscription sign-in.
It reads `beta/HARNESS.md` and uses `scripts/beta/bridge.mjs`. It needs the app's
existing `.env.local` storage credentials in this trusted local working copy.
Do not expose these credentials or a Codex execution endpoint to the website.
The app itself does not launch Codex. If no task is running/available, the queue
waits; closing the browser never clears it. Limits on Codex usage still apply.

Queue controls: default 10 stocks, choices 3/10/25/100; Main or Test source.
Only existing eligible stocks, no fresh scans or market-data API calls. Skip
beta results less than seven days old. One batch active at a time, one owned
claim at a time; pause stops new claims; cancel rejects late completions.
Run metadata is atomic CAS and result+completion commit is one Redis transaction.
Claims expire after 30 minutes to recover from an interrupted task.

Results are stored at `vh:codex-beta:results`, hash field `<workspace>:<ticker>`.
GET `/api/codex-beta` exposes assessments (same visibility as the existing stock
table), not claim tokens. Browser controls only queue/pause/resume/cancel work;
they cannot submit scores. POST checks Origin and an HttpOnly signed cookie, unlocked with the existing
trade-record SITE_PASSWORD. Missing SITE_PASSWORD fails closed. Results and claim
tokens can only be written/read by the trusted local runner, never browser input.

Tests: `node --test scripts/beta/beta.test.mjs`; build: `npx next build`.

## Cloud connection preparation

`/api/codex-beta/cloud` is a restricted HTTP adapter, disabled unless
`CODEX_BETA_CLOUD_SECRET` (at least 32 characters) is configured. It accepts
that dedicated bearer credential only; neither the site-password cookie nor
Grok/Claude credentials grant access. Authenticated GET returns minimal batch
status; POST accepts only `claim` or `complete` (the existing result envelope
plus action). Existing claim ownership, pause/cancel and validation still apply.
It cannot create batches, alter settings, call AI APIs, or execute arbitrary
Redis commands. Never give a remote researcher the Redis administration token.

This adapter alone does NOT enable cloud research. The initial ChatGPT Work
cloud capability check found a domain network restriction. A supported scoped
connector and a successful cloud read/write test are required before scheduling.
The MCP adapter at `/api/codex-beta/mcp` exposes beta_status, beta_claim_next and beta_save_assessment with OAuth. Login uses the existing owner password on the site; ChatGPT receives scoped access/refresh tokens, never that password or database credentials. Registration accepts only the documented stable ChatGPT callback. Codes are single-use, PKCE-bound and expire after five minutes; access tokens last an hour, refresh tokens rotate and last 30 days. Rotating CODEX_BETA_CLOUD_SECRET revokes all connector tokens. Auth state uses only vh:codex-beta:auth:* keys. A successful cloud read/write test and schedule verification remain required.
The local automation remains the only configured runner until that test passes.
