import { httpsCallable } from 'firebase/functions';
import { firebaseFunctions } from '../config/firebase';

export const lockSlot = httpsCallable(firebaseFunctions, 'lockSlot');
export const purchaseSlot = httpsCallable(firebaseFunctions, 'purchaseSlot');
export const releaseSlotOnCancel = httpsCallable(firebaseFunctions, 'releaseSlotOnCancel');
