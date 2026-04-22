import * as functions from 'firebase-functions';
import { db, FieldValue } from '../utils/admin';
import { requireAdmin } from '../utils/requireAdmin';

interface Input {
  eventId: string;
}

export const closeEvent = functions
  .runWith({ minInstances: 0 })
  .https.onCall(async (data: Input, context) => {
    requireAdmin(context);
    const { eventId } = data || ({} as Input);
    if (!eventId || typeof eventId !== 'string') {
      throw new functions.https.HttpsError('invalid-argument', 'eventId is required');
    }

    const eventRef = db.collection('events').doc(eventId);

    return db.runTransaction(async (tx) => {
      const eventDoc = await tx.get(eventRef);
      if (!eventDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'Event not found');
      }
      const event = eventDoc.data()!;
      if (event.status === 'closed') {
        throw new functions.https.HttpsError('failed-precondition', 'Event is already closed');
      }
      if (event.status === 'upcoming') {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Event has not started yet — cannot close an upcoming event'
        );
      }
      tx.update(eventRef, {
        status: 'closed',
        closesAt: FieldValue.serverTimestamp(),
      });
      return { success: true };
    });
  });
