// Mirrors of the mobile app's Firestore document shapes. Defined here so the
// admin app stays decoupled from the Expo project (no react-native imports).

export type Brand = 'RAW' | 'SMACKDOWN' | 'NXT' | 'LEGENDS';
export const BRANDS: Brand[] = ['RAW', 'SMACKDOWN', 'NXT', 'LEGENDS'];

export type Tier = 'Gold' | 'Silver' | 'Bronze';
export type SlotStatus = 'available' | 'locked' | 'sold' | 'closed';
export type EventStatus = 'upcoming' | 'live' | 'closed';

export interface BreakEvent {
  id: string;
  title: string;
  description: string;
  status: EventStatus;
  opensAt: Date;
  closesAt: Date | null;
  imageUrl: string | null;
  totalSlots: number;
  soldSlots: number;
  featuredSlotIds: string[];
  createdAt: Date;
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

export interface Purchase {
  id: string;
  userId: string;
  eventId: string;
  slotId: string;
  wrestlerName: string;
  eventTitle: string;
  brand: Brand;
  tier: Tier;
  price: number;
  purchasedAt: Date;
  transactionId: string;
  status: 'completed';
}

export interface ShippingAddress {
  line1: string;
  line2?: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
}

export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string;
  firstName: string;
  lastName: string;
  username: string;
  shippingAddress: ShippingAddress | null;
  wantBaseCards: boolean;
  legacyUser: boolean;
  balance: number;
  purchaseCount: number;
  fcmToken: string | null;
  createdAt: Date | null;
}

// Slot row prepared by the admin's sheet uploader before submitting an event.
export interface SlotDraft {
  wrestlerName: string;
  members: string[];
  price: number;
  brand: Brand;
}
