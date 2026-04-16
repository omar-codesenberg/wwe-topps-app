import * as functions from 'firebase-functions';
import { db } from './utils/admin';

export const releaseSlotOnCancel = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be authenticated');
  }
  const { eventId, slotId } = data;
  if (!eventId || !slotId) {
    throw new functions.https.HttpsError('invalid-argument', 'eventId and slotId required');
  }
  const uid = context.auth.uid;
  const slotRef = db.collection('events').doc(eventId).collection('slots').doc(slotId);
  try {
    await db.runTransaction(async (transaction) => {
      const slotDoc = await transaction.get(slotRef);
      if (!slotDoc.exists) return;
      const slot = slotDoc.data()!;
      if (slot.status !== 'locked' || slot.lockedBy !== uid) return;
      transaction.update(slotRef, {
        status: 'available',
        lockedBy: null,
        lockedAt: null,
        lockedUntil: null,
      });
    });
    return { success: true };
  } catch (error) {
    console.error('releaseSlotOnCancel error:', error);
    return { success: true };
  }
});
