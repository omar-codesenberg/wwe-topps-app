import { Tier } from '../types/slot.types';
export function deriveTier(price: number): Tier {
  if (price >= 5000) return 'Gold';
  if (price >= 1000) return 'Silver';
  return 'Bronze';
}
