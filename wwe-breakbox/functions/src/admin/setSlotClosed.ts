import * as functions from 'firebase-functions';
import { db } from '../utils/admin';
import { requireAdmin } from '../utils/requireAdmin';

interface Input {
  eventId: string;
  slotId: string;
  closed: boolean;
}

export const setSlotClosed = functions
  .runWith({ minInstances: 0 })
  .https.onCall(async (data: Input, context) => {
    requireAdmin(context);
    const { eventId, slotId, closed } = data || ({} as Input);
    if (!eventId || !slotId || typeof closed !== 'boolean') {
      throw new functions.https.HttpsError('invalid-argument', 'eventId, slotId, closed required');
    }

    const slotRef = db.collection('events').doc(eventId).collection('slots').doc(slotId);

    return db.runTransaction(async (tx) => {
      const slotDoc = await tx.get(slotRef);
      if (!slotDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'Slot not found');
      }
      const slot = slotDoc.data()!;
      if (closed) {
        if (slot.status === 'sold') {
          throw new functions.https.HttpsError('failed-precondition', 'Cannot close a sold slot');
        }
        if (slot.status === 'locked') {
          // Closing while locked: clear the lock and mark closed.
          tx.update(slotRef, {
            status: 'closed',
            lockedBy: null,
            lockedAt: null,
            lockedUntil: null,
          });
        } else {
          tx.update(slotRef, { status: 'closed' });
        }
      } else {
        if (slot.status !== 'closed') {
          throw new functions.https.HttpsError('failed-precondition', 'Slot is not closed');
        }
        tx.update(slotRef, { status: 'available' });
      }
      return { success: true };
    });
  });
