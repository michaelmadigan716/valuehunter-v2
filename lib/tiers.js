// Scan-eligibility tiers: where routine AI spend goes (A), what only enters
// via a scout signal or a manual star (B), and dead weight (C).
export const TIER_RULES = {
  minMarketCapM: 20,
  maxMarketCapM: 15000,
  minPrice: 0.5,
  maxPrice: 100,
  minDollarVolume: 500_000,
  skipDollarVolume: 100_000,
  skipPrice: 0.2,
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
  if (price !== null && price < TIER_RULES.skipPrice) return { tier: 'C', reason: 'Sub-$0.20 shell' };
  if (dollarVol !== null && dollarVol < TIER_RULES.skipDollarVolume) return { tier: 'C', reason: 'Illiquid (<$100K/day)' };

  if (sic && inRange(sic, TIER_RULES.cappedSic)) reasons.push(inRange(sic, TIER_RULES.cappedSic)[2]);
  if (mcap !== null && mcap > TIER_RULES.maxMarketCapM) reasons.push(`Cap > $${TIER_RULES.maxMarketCapM / 1000}B`);
  if (mcap !== null && mcap < TIER_RULES.minMarketCapM) reasons.push(`Cap < $${TIER_RULES.minMarketCapM}M`);
  if (price !== null && price > TIER_RULES.maxPrice) reasons.push(`Price > $${TIER_RULES.maxPrice}`);
  if (price !== null && price < TIER_RULES.minPrice) reasons.push(`Price < $${TIER_RULES.minPrice}`);
  if (dollarVol !== null && dollarVol < TIER_RULES.minDollarVolume) reasons.push('Thin volume (<$500K/day)');
  if (reasons.length) return { tier: 'B', reason: reasons.join(', ') };
  return { tier: 'A', reason: 'Hunt-eligible' };
}
