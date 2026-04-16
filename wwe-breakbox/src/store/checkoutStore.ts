import { create } from 'zustand';
import { Slot } from '../types/slot.types';

interface LockData {
  slotId: string;
  eventId: string;
  lockedUntil: Date;
}

interface CheckoutState {
  selectedSlot: Slot | null;
  lockData: LockData | null;
  set: (slot: Slot, lockData: LockData) => void;
  clear: () => void;
}

export const useCheckoutStore = create<CheckoutState>((set) => ({
  selectedSlot: null,
  lockData: null,
  set: (slot, lockData) => set({ selectedSlot: slot, lockData }),
  clear: () => set({ selectedSlot: null, lockData: null }),
}));
