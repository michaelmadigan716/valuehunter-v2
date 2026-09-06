# Integration contract: ValueHunter app <-> Always-Thinking engine

Two people work on this repo: the ValueHunter side (scanning, scores, table, workspaces) and the Always-Thinking side (`/thinking`, `/api/thinking`, `thinking/`, `lib/thinking.js`). Keep them decoupled by honoring this contract.

## What the thinking side READS from the ValueHunter side (Redis, via app/api/thinking/route.js -> dataWindow)
- `vh:main` (Main session): `stocks[]` with `ticker, name, sector, price, marketCap (in $M), netCash, positionIn52Week, lastInsiderPurchase {date, shares, name}, techScore, techOpinion, tier ('A'|'B'|'C'), compositeScore`
- `vh:scanres` (hash, ticker -> scan results): `insiderConviction, valuationScore, cupHandleScore, momentumScore, buyoutScore, leadershipScore, playbookScore, playbookBest, scannedAt`
- `vh:singularity` (hash, ticker -> `{singularityScore}`)
- `vh:watchlist` (object ticker -> {note, addedAt}), `vh:scouts:latest`, `vh:research:feed`
- `DEFAULT_PLAYBOOKS` from `lib/scanAgents.js`
- `vh:settings.autoScans.enabled` (whether Grok scans may run)

**Rule:** the ValueHunter side may add fields freely but must not rename or remove the ones above without updating `pick()` / `dataWindow()` in `app/api/thinking/route.js`. If a key must move, keep a shim.

## What the thinking side WRITES (never touched by the ValueHunter side)
- `vh:thinking:config`, `vh:thinking:<category>`, `vh:thinking:<category>:inbox`, `vh:thinking:<category>:dismissed`, `vh:signals:wsb`

## What the thinking side may ASK of the ValueHunter side
- `state.recommendedScans` on the board: tickers the engine wants deep-scanned. Wiring those into the scan queue (only when `autoScans.enabled`) is the ValueHunter side's call; the engine never spends xAI credits itself.

## Files owned by the thinking side
`app/thinking/**`, `app/api/thinking/**`, `lib/thinking.js`, `thinking/**` (harness + briefs; copied to `public/thinking/` by the `prebuild` script), the "Always Thinking" header link in `app/page.jsx`, and the cloud routine (claude.ai/code/routines).

## Runtime contract with the cloud routine
- Routine fetches `GET /thinking/HARNESS.md` and `GET /thinking/categories/<id>.md` from the site (no repo access).
- `GET /api/thinking?category=<id>&data=1` returns config + state + inbox + data window.
- `POST /api/thinking` with `Authorization: Bearer THINKING_SECRET` for `run_start | update | run_end`; same-origin UI actions `ask | config | dismiss`.
- Secret lives in Vercel env `THINKING_SECRET` and in the routine prompt; rotate both together.
