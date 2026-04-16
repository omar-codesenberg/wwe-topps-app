import * as functions from 'firebase-functions';
import { v4 as uuidv4 } from 'uuid';
import { db, FieldValue } from './utils/admin';

export const purchaseSlot = functions
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
        if (!slotDoc.exists || !eventDoc.exists) return { success: false, reason: 'NOT_FOUND' };
        const slot = slotDoc.data()!;
        const event = eventDoc.data()!;
        if (slot.status !== 'locked') return { success: false, reason: 'SLOT_NOT_LOCKED' };
        if (slot.lockedBy !== uid) return { success: false, reason: 'NOT_YOUR_LOCK' };
        const lockedUntil = slot.lockedUntil?.toDate();
        if (lockedUntil && lockedUntil < new Date()) return { success: false, reason: 'LOCK_EXPIRED' };
        const purchaseId = uuidv4();
        const purchaseRef = db.collection('purchases').doc(purchaseId);
        const userRef = db.collection('users').doc(uid);
        const newSoldSlots = (event.soldSlots || 0) + 1;
        const isLastSlot = newSoldSlots >= (event.totalSlots || 112);
        transaction.update(slotRef, {
          status: 'sold',
          purchasedBy: uid,
          purchasedAt: FieldValue.serverTimestamp(),
          lockedBy: null,
          lockedAt: null,
          lockedUntil: null,
        });
        transaction.set(purchaseRef, {
          id: purchaseId,
          userId: uid,
          eventId,
          slotId,
          wrestlerName: slot.wrestlerName,
          eventTitle: event.title,
          brand: slot.brand,
          tier: slot.tier,
          price: slot.price,
          purchasedAt: FieldValue.serverTimestamp(),
          transactionId: uuidv4(), // TODO: Replace with PayPal transaction ID
          status: 'completed',
        });
        transaction.update(eventRef, {
          soldSlots: FieldValue.increment(1),
          ...(isLastSlot ? { status: 'closed', closesAt: FieldValue.serverTimestamp() } : {}),
        });
        transaction.update(userRef, {
          purchaseCount: FieldValue.increment(1),
        });
        return { success: true, purchaseId };
      });
      return result;
    } catch (error) {
      console.error('purchaseSlot error:', error);
      throw new functions.https.HttpsError('internal', 'Failed to purchase slot');
    }
  });
