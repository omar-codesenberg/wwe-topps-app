// Mirror of wwe-breakbox/src/utils/tier.utils.ts. Duplicated here so the
// functions tsconfig (rootDir: "src") doesn't need to reach into the mobile app.
export type Tier = 'Gold' | 'Silver' | 'Bronze';

export function deriveTier(price: number): Tier {
  if (price >= 5000) return 'Gold';
  if (price >= 1000) return 'Silver';
  return 'Bronze';
}
