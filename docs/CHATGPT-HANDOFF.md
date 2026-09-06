# ValueHunter — handoff brief for the ValueHunter side

You are taking over the **ValueHunter** side of this app (scanning, scores, table, filters, workspaces, settings). A separate agent (Claude) owns the **Always-Thinking** side. Read `thinking/CONTRACT.md` before touching anything the engine reads.

## Stack and deployment
- Next.js 16 (App Router), React 19, Tailwind 4, JavaScript/JSX. Repo: `michaelmadigan716/valuehunter-v2`, deployed on Vercel Pro at https://valuehunter-v2.vercel.app. `git push origin main` auto-deploys; the owner also deploys with `vercel --prod --yes`.
- Before pushing: `npx next build` must pass. A failed build can leave production on the old code, so check the build output for "Failed to compile" / "Error occurred" and do not push if it fails.
- State lives in Upstash Redis via REST (`app/api/_lib/kv.js`). No database beyond that.
- Secrets live only in `.env.local` and Vercel env (GROK_API_KEY, KV_REST_API_URL/TOKEN, CRON_SECRET, THINKING_SECRET, SITE_PASSWORD, public Polygon/Finnhub keys). Never put a secret in code or docs.

## Which AI is used where (this matters for billing)
- **ValueHunter scans use xAI Grok** through `app/api/grok/route.js` (server-side proxy; grok-4.3 = fast/cheap, grok-4.6 = smart). These cost the owner real prepaid xAI credits. Every automatic spend path is gated by ONE master switch: `settings.autoScans.enabled` (Settings → "Automatic AI scanning", default OFF). Honor it in any new cron or worker path. Do not add new automatic AI spend without the owner's explicit go.
- **The Always-Thinking engine uses the owner's Claude Max subscription, never the Anthropic API.** It runs as a Claude Code cloud routine (claude.ai/code → Routines) that fetches its instructions from the site (`public/thinking/HARNESS.md`) and reads/writes the site's `/api/thinking` endpoints with a bearer secret. The site itself never calls Anthropic. **Do not add the Anthropic API or SDK anywhere in this repo** — that would be billed separately on top of the subscription. If a ValueHunter feature ever needs Claude-level reasoning, use the same pattern: a routine that reads a data endpoint and writes results back to a board endpoint, with a secret in the routine prompt and the routine's cloud environment ("vh") set to Full network access.

## Architecture you are inheriting
- `app/page.jsx` (~4,500 lines) is the main app. Scan engines live in `lib/scanAgents.js` (7 single-call scans: conviction, technical, valuation, momentum, buyout, leadership, playbook; the last four use live web/X search and are the expensive ones). `lib/technicals.js` computes a Barchart-style technical opinion from price bars for free. `lib/tiers.js` classifies eligibility (Eligible = cap $20M–$15B, ≥$500K/day traded, not banks/REITs/insurers/utilities/funds/SPACs; share price is deliberately NOT a criterion).
- Two workspaces, Main and Test, isolated by Redis key prefix (`wsKey(ws, name)`): Test is a 100-stock sandbox on the fast model.
- Server jobs: `app/api/jobs` (queue) and `app/api/worker` (cron every minute, holds a Redis lock, processes 15 stocks concurrently, alternates Main/Test). Jobs survive page refreshes. Scheduled passes in `app/api/_lib/schedule.js` (weekly full pass on the fast model, daily targeted pass on the smart model), gated by `autoScans` and by per-schedule toggles.
- Staged scanning (`app/api/_lib/settings.js`): stage 0 free gate (singularity relevance ≥ 50, or insider buy ≤ 90 days, or technicals ≥ 85%), stage 1 cheap scans, stage 2 live-search scans only if earned; high scorers get escalated to the smart model. Singularity relevance is scored in batches of 20 via `scoreSingularityBatch` and stored in the hash `vh:singularity`.
- Other crons: `refresh` (universe/prices/enrichment, hourly), `scouts` (value/momentum/social leads), `research` (morning research on the watchlist). All gated by `autoScans`.

## Redis rules (learned the hard way — do not regress these)
1. Per-stock results are Redis **hash fields** (`vh:scanres`, `vh:singularity`), written with `kvHSetMany`. Never store per-stock results in one JSON blob that concurrent writers read-modify-write; 15 concurrent stocks clobbered each other and lost paid scans.
2. `vh:main` (the session) is rewritten whole by several writers. Never hold a long-lived copy and write it back; read fresh → modify → write immediately.
3. The worker must call `/api/grok` on the public production URL, not the request host (cron hosts sit behind Vercel deployment protection and return an auth page).
4. Any result whose text starts with "Error" must be rejected, not saved.

## Product rules from the owner
- Changes are additive: never remove or relocate existing stats, columns, features, or routes. The full app stays at the root; `/swing` is his trade-history app; `/thinking` is the engine dashboard.
- Insider buys are "extremely important" — never lose that data path.
- No thousands-of-scans daily batches; weekly full pass + daily targeted pass is the intended cadence.
- Keep the UI digestible; he reads it on a phone.

## Boundaries with the Always-Thinking side
- Owned by the other agent, do not edit: `app/thinking/**`, `app/api/thinking/**`, `lib/thinking.js`, `thinking/**`, `public/thinking/**`, the `prebuild` script, the "Always Thinking" header link.
- You may add fields to the stock objects freely, but do not rename or remove the fields and keys listed in `thinking/CONTRACT.md` (the engine's data window depends on them). If one must change, update `pick()`/`dataWindow()` in `app/api/thinking/route.js` in the same commit and say so in the commit message.
- The engine may leave `recommendedScans` on its board; wiring those into the scan queue (only when `autoScans` is on) is optional and yours.

## Working in the same repo as another agent
Commit in small coherent units with clear messages, pull before you start, and prefer a branch for anything large. Check `git status`/`git log` before assuming the tree is yours. Don't run destructive git commands.
