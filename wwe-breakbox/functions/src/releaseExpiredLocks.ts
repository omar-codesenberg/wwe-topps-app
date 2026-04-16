import * as functions from 'firebase-functions';
import { db, Timestamp } from './utils/admin';

export const releaseExpiredLocks = functions.pubsub
  .schedule('every 1 minutes')
  .onRun(async () => {
    const now = Timestamp.now();
    const expiredLocks = await db
      .collectionGroup('slots')
      .where('status', '==', 'locked')
      .where('lockedUntil', '<', now)
      .get();
    if (expiredLocks.empty) {
      console.log('No expired locks found');
      return null;
    }
    const batch = db.batch();
    expiredLocks.docs.forEach((doc) => {
      batch.update(doc.ref, {
        status: 'available',
        lockedBy: null,
        lockedAt: null,
        lockedUntil: null,
      });
    });
    await batch.commit();
    console.log(`Released ${expiredLocks.docs.length} expired locks`);
    return null;
  });
