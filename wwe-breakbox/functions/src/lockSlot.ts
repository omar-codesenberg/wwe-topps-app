import * as functions from 'firebase-functions';
import { db, FieldValue, Timestamp } from './utils/admin';

export const lockSlot = functions
  .runWith({ minInstances: 0 })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Must be authenticated');
    }
    const { eventId, slotId } = data;
    if (!eventId || !slotId) {
      throw new functions.https.HttpsError('invalid-argument', 'eventId and slotId required');
    }
    const uid = context.auth.uid;
    const slotRef = db.collection('events').doc(eventId).collection('slots').doc(slotId);
    const eventRef = db.collection('events').doc(eventId);

    try {
      const result = await db.runTransaction(async (transaction) => {
        const [slotDoc, eventDoc] = await Promise.all([
          transaction.get(slotRef),
          transaction.get(eventRef),
        ]);
        if (!slotDoc.exists) return { success: false, reason: 'SLOT_NOT_FOUND' };
        if (!eventDoc.exists) return { success: false, reason: 'EVENT_NOT_FOUND' };
        const slot = slotDoc.data()!;
        const event = eventDoc.data()!;
        if (event.status !== 'live') return { success: false, reason: 'EVENT_NOT_LIVE' };
        if (slot.status === 'locked') return { success: false, reason: 'SLOT_LOCKED' };
        if (slot.status === 'sold') return { success: false, reason: 'SLOT_SOLD' };
        if (slot.status === 'closed') return { success: false, reason: 'SLOT_CLOSED' };
        const lockedUntil = new Date(Date.now() + 10000);
        transaction.update(slotRef, {
          status: 'locked',
          lockedBy: uid,
          lockedAt: FieldValue.serverTimestamp(),
          lockedUntil: Timestamp.fromDate(lockedUntil),
        });
        return { success: true, lockedUntil: lockedUntil.toISOString() };
      });
      return result;
    } catch (error) {
      console.error('lockSlot error:', error);
      throw new functions.https.HttpsError('internal', 'Failed to lock slot');
    }
  });
