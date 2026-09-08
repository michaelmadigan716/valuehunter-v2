# Margin snapshot and scenarios

The margin panel reads app/swing/_data/margin.json (broker-reported call status, debit and timestamp) and Brokerage open holdings from trades.json. Retirement holdings are excluded. This is an authenticated page displaying a dated snapshot, not a background monitoring service. No trades, account settings, scanning jobs or paid APIs are invoked.

For future refreshes, update margin.json from the Vanguard Available funds drawer alongside holdings. Do not interpret buying power or margin cash available as maintenance excess. The drawer did not supply per-security house requirements, so those remain explicit assumptions with optional UI overrides. Never replace unknown actual rates with a claim of confirmed rates.

Long-stock model: equity = market value - debit; required equity = max(2000, sum(min(position value, max(3 * shares, position value * rate)))). Rate starts at 35%, increases to at least 50% at 40% concentration, and honors higher scenario overrides. Requirements are recalculated after each shock. This does not model short positions, options, or undisclosed broker/sector add-ons. Crossing search finds the first shortfall along the selected decline path. Deposited cash reduces debit; no hypothetical stock sale is assumed.

Source rules reviewed 2026-09-08: https://www.vanguard.com/pdf/margin.pdf and https://investor.vanguard.com/client-benefits/margin-disclosure-statement.

Gain chart ranges zoom the original cumulative series rather than rebasing returns. End date is the latest observed performance date. The monthly import cannot support an intraday line; 1D explicitly reports missing intraday observations instead of synthesizing data.

Validation: node --test scripts/swing/margin.test.mjs (Node with TypeScript stripping), npx next build, browser range and scenario controls.
