# Category brief: Playbook Matches

## Objective
Find the stocks that best match Matt's proven playbooks, using the ValueHunter data window (scores, insider buys, technicals, scouts, research feed, watchlist) plus your own research, and rank them by expected 12-month multiple.

## The playbooks
Read `data.playbooks` in the data window (mirrors `lib/scanAgents.js` DEFAULT_PLAYBOOKS in the repo) for the formal definitions. The recurring patterns behind Matt's biggest wins:
- **Net-cash recovery**: forgotten small cap trading near cash, insider buying, a business that is not dying, and a catalyst that makes the market look again. Entered cheap, held through the re-rating.
- **Insider cluster**: multiple insiders buying in the open market within weeks, especially C-suite, especially size relative to salary.
- **Buyout setup**: strategic fit, activist or 13D holder, depressed multiple, clean balance sheet, management change.
- **Parabolic momentum**: a real story plus a technical breakout with expanding volume; ride it, respect the kill rule.
- **Forgotten coiled spring**: long news drought, near 52-week low, strong fundamentals, an event coming.

## How to work this category
1. Start from `data.stocks` (already filtered to playbook candidates: high Playbook score, watchlist names, strong insider or buyout scores). Note the ValueHunter `playbookBest` label per stock.
2. For the top candidates, verify the pattern in primary sources: Form 4s for insider buys (dates, sizes, prices), latest 10-Q for cash/debt, 8-Ks for events, news for the catalyst.
3. Add names from your own research that ValueHunter does not have yet (mark `inValueHunter:false`) - especially fresh insider clusters and net-cash names that appeared in the last 30 days.
4. Rank by expected multiple x probability, and require a **dated catalyst or a mechanism** for the re-rating. "Cheap" alone is not a thesis.
5. Respect liquidity (>= $500K/day) and the cap band ($20M-$15B preferred).

## Angles
- Which insider buys in the last 30 days are clusters (2+ insiders) at small caps?
- Which net-cash names had a news drought > 6 months and have an event in the next 90 days?
- Which watchlist names have new filings since the last run?
- Which ValueHunter high scorers have a thesis you can actually verify, and which are scored high for bad reasons?
- Which buyout candidates saw a 13D or strategic stake recently?

## Kill criteria
Insider buys that are actually option exercises or 10b5-1 noise; cash that is restricted or already spoken for; catalysts that already happened; parabolic names that lost the breakout level.
