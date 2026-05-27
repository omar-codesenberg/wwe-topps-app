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
        const existingLocksQuery = db
          .collectionGroup('slots')
          .where('lockedBy', '==', uid)
          .where('status', '==', 'locked');
        const [slotDoc, eventDoc, existingLocksSnap] = await Promise.all([
          transaction.get(slotRef),
          transaction.get(eventRef),
          transaction.get(existingLocksQuery),
        ]);
        if (!slotDoc.exists) return { success: false, reason: 'SLOT_NOT_FOUND' };
        if (!eventDoc.exists) return { success: false, reason: 'EVENT_NOT_FOUND' };
        const slot = slotDoc.data()!;
        const event = eventDoc.data()!;
        if (event.status !== 'live') return { success: false, reason: 'EVENT_NOT_LIVE' };

        const now = Date.now();
        // Enforce: a user may hold at most one non-expired lock at a time.
        // A lock on the same slot is a resume and falls through to the block below.
        for (const doc of existingLocksSnap.docs) {
          if (doc.ref.path === slotRef.path) continue;
          const otherLockedUntil = doc.data().lockedUntil?.toDate?.() ?? null;
          if (otherLockedUntil && otherLockedUntil.getTime() > now) {
            return { success: false, reason: 'ALREADY_HAS_ACTIVE_LOCK' };
          }
        }

        if (slot.status === 'locked') {
          // Re-lock by the same user on a non-expired lock is a no-op resume.
          // The original lockedUntil is preserved so users cannot extend a
          // reservation indefinitely by re-opening the app.
          const existingLockedUntil = slot.lockedUntil?.toDate?.() ?? null;
          const stillValid = existingLockedUntil && existingLockedUntil.getTime() > now;
          if (slot.lockedBy === uid && stillValid) {
            return { success: true, lockedUntil: existingLockedUntil.toISOString() };
          }
          return { success: false, reason: 'SLOT_LOCKED' };
        }
        if (slot.status === 'sold') return { success: false, reason: 'SLOT_SOLD' };
        if (slot.status === 'closed') return { success: false, reason: 'SLOT_CLOSED' };
        const lockedUntil = new Date(now + 5 * 60 * 1000);
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
