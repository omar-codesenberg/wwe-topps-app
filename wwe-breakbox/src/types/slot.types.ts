import { Brand } from '../constants/brands';
export type SlotStatus = 'available' | 'locked' | 'sold';
export type Tier = 'Gold' | 'Silver' | 'Bronze';
export interface SlotSeedItem {
  wrestlerName: string;
  members: string[];
  price: number;
  brand: Brand;
}
export interface Slot {
  id: string;
  wrestlerName: string;
  members: string[];
  brand: Brand;
  price: number;
  tier: Tier;
  status: SlotStatus;
  lockedBy: string | null;
  lockedAt: Date | null;
  lockedUntil: Date | null;
  purchasedBy: string | null;
  purchasedAt: Date | null;
  imageUrl: string | null;
}
