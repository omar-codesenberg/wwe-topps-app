import { Brand } from '../constants/brands';
import { Tier } from './slot.types';
export interface Purchase {
  id: string;
  userId: string;
  eventId: string;
  slotId: string;
  wrestlerName: string;
  eventTitle: string;
  brand: Brand;
  tier: Tier;
  /** Purchase price in integer cents (e.g., 2500 = $25.00). */
  priceCents: number;
  purchasedAt: Date;
  transactionId: string;
  status: 'completed';
}
