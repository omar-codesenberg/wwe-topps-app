import * as functions from 'firebase-functions';
import { db } from '../utils/admin';
import { requireAdmin } from '../utils/requireAdmin';

type Brand = 'RAW' | 'SMACKDOWN' | 'NXT' | 'LEGENDS';
const VALID_BRANDS: Brand[] = ['RAW', 'SMACKDOWN', 'NXT', 'LEGENDS'];

interface Input {
  eventId: string;
  slotId: string;
  brand: Brand;
}

export const setSlotBrand = functions
  .runWith({ minInstances: 0 })
  .https.onCall(async (data: Input, context) => {
    requireAdmin(context);
    const { eventId, slotId, brand } = data || ({} as Input);
    if (!eventId || !slotId) {
      throw new functions.https.HttpsError('invalid-argument', 'eventId, slotId required');
    }
    if (!VALID_BRANDS.includes(brand)) {
      throw new functions.https.HttpsError('invalid-argument', 'invalid brand');
    }
    const slotRef = db.collection('events').doc(eventId).collection('slots').doc(slotId);
    const slotDoc = await slotRef.get();
    if (!slotDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'Slot not found');
    }
    await slotRef.update({ brand });
    return { success: true };
  });
