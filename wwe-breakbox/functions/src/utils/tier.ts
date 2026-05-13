// Mirror of wwe-breakbox/src/utils/tier.utils.ts. Duplicated here so the
// functions tsconfig (rootDir: "src") doesn't need to reach into the mobile app.
export type Tier = 'Gold' | 'Silver' | 'Bronze';

/**
 * Derive a tier from a price expressed in integer cents.
 * Gold = $5,000+ (>= 500_000 cents)
 * Silver = $1,000+ (>= 100_000 cents)
 * Bronze = below $1,000.
 */
export function deriveTier(priceCents: number): Tier {
  if (priceCents >= 500000) return 'Gold';
  if (priceCents >= 100000) return 'Silver';
  return 'Bronze';
}
