import { Brand } from '../constants/brands';
export type SlotStatus = 'available' | 'locked' | 'sold' | 'closed';
export type Tier = 'Gold' | 'Silver' | 'Bronze';
export interface SlotSeedItem {
  wrestlerName: string;
  members: string[];
  /** Slot price in integer cents (e.g., 2500 = $25.00). */
  priceCents: number;
  brand: Brand;
}
export interface Slot {
  id: string;
  wrestlerName: string;
  members: string[];
  brand: Brand;
  /** Slot price in integer cents (e.g., 2500 = $25.00). */
  priceCents: number;
  tier: Tier;
  status: SlotStatus;
  lockedBy: string | null;
  lockedAt: Date | null;
  lockedUntil: Date | null;
  purchasedBy: string | null;
  purchasedAt: Date | null;
  imageUrl: string | null;
}
