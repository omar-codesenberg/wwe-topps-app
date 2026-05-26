import { httpsCallable } from 'firebase/functions';
import { firebaseFunctions } from '../config/firebase';

export const lockSlot = httpsCallable(firebaseFunctions, 'lockSlot');
export const purchaseSlot = httpsCallable(firebaseFunctions, 'purchaseSlot');

type ActiveLockSlot = {
  id: string;
  wrestlerName: string;
  members: string[];
  brand: string;
  priceCents: number;
  tier: string;
  status: 'locked';
  lockedBy: string;
  lockedAt: string | null;
  lockedUntil: string;
  purchasedBy: null;
  purchasedAt: null;
  imageUrl: string | null;
};

export type GetMyActiveLockResponse =
  | { active: false }
  | {
      active: true;
      eventId: string;
      slotId: string;
      lockedUntil: string;
      slot: ActiveLockSlot;
    };

export const getMyActiveLock = httpsCallable<undefined, GetMyActiveLockResponse>(
  firebaseFunctions,
  'getMyActiveLock'
);
export const releaseSlotOnCancel = httpsCallable<
  { eventId: string; slotId: string; orderId?: string },
  unknown
>(firebaseFunctions, 'releaseSlotOnCancel');

export const createPayPalOrder = httpsCallable<
  { eventId: string; slotId: string },
  { orderId: string; approveUrl: string; correlationId: string; alreadyOpen?: boolean }
>(firebaseFunctions, 'createPayPalOrder');

export const capturePayPalOrder = httpsCallable<
  { orderId: string },
  {
    success: boolean;
    purchaseId?: string;
    reason?: string;
    refundStatus?: { status: string; paypalRefundId?: string };
  }
>(firebaseFunctions, 'capturePayPalOrder');

export const getPayPalOrderStatus = httpsCallable<
  { orderId: string },
  { orderId: string; status: string; paypalStatus: string; voided: boolean }
>(firebaseFunctions, 'getPayPalOrderStatus');
