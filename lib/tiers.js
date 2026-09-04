// Scan-eligibility tiers: where routine AI spend goes (A), what only enters
// via a scout signal or a manual star (B), and dead weight (C).
// Price per share is NOT an eligibility criterion (MU at $618 and AGL at
// $0.38 were both huge winners). Market cap and liquidity are the real gates.
export const TIER_RULES = {
  minMarketCapM: 20,
  maxMarketCapM: 15000,
  minDollarVolume: 500_000,
  skipDollarVolume: 100_000,
  shellPrice: 0.2, // only combined with illiquidity
  // SIC ranges whose stocks rarely have 3-5x capacity (routine scans skip them;
  // scouts and manual stars still bring them in)
  cappedSic: [
    [6020, 6099, 'Banks'], [6111, 6199, 'Lenders'], [6311, 6399, 'Insurance'], [6411, 6411, 'Insurance agents'],
    [6798, 6798, 'REIT'], [4911, 4941, 'Utilities'], [4950, 4959, 'Utilities'],
  ],
  skipSic: [[6770, 6770, 'Blank check / SPAC'], [6722, 6726, 'Fund'], [6792, 6795, 'Trust'], [6799, 6799, 'Investment trust']],
};

const inRange = (code, ranges) => ranges.find(([lo, hi]) => code >= lo && code <= hi);

export function classifyTier(rec) {
  const price = rec.price ?? null;
  const mcap = rec.marketCap ?? null;
  const dollarVol = rec.avgDollarVolume ?? rec.dollarVolume ?? null;
  const sic = rec.sicCode ? parseInt(rec.sicCode) : null;
  const name = (rec.name || '').toLowerCase();
  const reasons = [];

  if (sic && inRange(sic, TIER_RULES.skipSic)) return { tier: 'C', reason: inRange(sic, TIER_RULES.skipSic)[2] };
  if (/acquisition corp|acquisition co\b|blank check|\bspac\b|\btrust\b|\bfund\b|\betf\b/.test(name) && !/bank/.test(name)) return { tier: 'C', reason: 'Fund / SPAC / trust' };
  if (dollarVol !== null && dollarVol < TIER_RULES.skipDollarVolume) {
    return { tier: 'C', reason: price !== null && price < TIER_RULES.shellPrice ? 'Sub-$0.20 illiquid shell' : 'Illiquid (<$100K/day)' };
  }

  if (sic && inRange(sic, TIER_RULES.cappedSic)) reasons.push(inRange(sic, TIER_RULES.cappedSic)[2]);
  if (mcap !== null && mcap > TIER_RULES.maxMarketCapM) reasons.push(`Cap > $${TIER_RULES.maxMarketCapM / 1000}B`);
  if (mcap !== null && mcap < TIER_RULES.minMarketCapM) reasons.push(`Cap < $${TIER_RULES.minMarketCapM}M`);
  if (dollarVol !== null && dollarVol < TIER_RULES.minDollarVolume) reasons.push('Thin volume (<$500K/day)');
  if (reasons.length) return { tier: 'B', reason: reasons.join(', ') };
  return { tier: 'A', reason: 'Hunt-eligible' };
}
