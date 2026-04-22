import { httpsCallable } from 'firebase/functions';
import { firebaseFunctions } from './firebase';
import type { Brand, SlotDraft } from './types';

interface CreateEventInput {
  title: string;
  opensAt: number;
  description?: string;
  slots: SlotDraft[];
}

export const createEventWithSlots = httpsCallable<
  CreateEventInput,
  { eventId: string; slotCount: number }
>(firebaseFunctions, 'createEventWithSlots');

export const startEvent = httpsCallable<
  { eventId: string },
  { success: true }
>(firebaseFunctions, 'startEvent');

export const closeEvent = httpsCallable<
  { eventId: string },
  { success: true }
>(firebaseFunctions, 'closeEvent');

export const setSlotClosed = httpsCallable<
  { eventId: string; slotId: string; closed: boolean },
  { success: true }
>(firebaseFunctions, 'setSlotClosed');

export const setSlotBrand = httpsCallable<
  { eventId: string; slotId: string; brand: Brand },
  { success: true }
>(firebaseFunctions, 'setSlotBrand');

export const setUserLegacy = httpsCallable<
  { uid: string; legacyUser: boolean },
  { success: true }
>(firebaseFunctions, 'setUserLegacy');
