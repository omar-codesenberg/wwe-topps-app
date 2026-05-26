import * as functions from 'firebase-functions';
import { db } from './utils/admin';

/**
 * Returns the caller's currently-held, non-expired slot lock so the client
 * can resume Checkout after an app reopen. Returns `{ active: false }` when
 * there is no live lock.
 *
 * Uses a collectionGroup query on (lockedBy, status) — see the matching
 * COLLECTION_GROUP index in firestore.indexes.json — and filters expiry in
 * code so the function returns the live, non-expired lock if one exists.
 */
export const getMyActiveLock = functions
  .runWith({ minInstances: 0 })
  .https.onCall(async (_data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Must be authenticated');
    }
    const uid = context.auth.uid;

    const snap = await db
      .collectionGroup('slots')
      .where('lockedBy', '==', uid)
      .where('status', '==', 'locked')
      .get();

    const now = Date.now();
    for (const doc of snap.docs) {
      const slot = doc.data();
      const lockedUntil = slot.lockedUntil?.toDate?.() ?? null;
      if (!lockedUntil || lockedUntil.getTime() <= now) continue;

      const eventRef = doc.ref.parent.parent;
      if (!eventRef) continue;
      const eventId = eventRef.id;
      const eventSnap = await eventRef.get();
      if (!eventSnap.exists) continue;
      const event = eventSnap.data()!;
      // If the event is no longer live (closed mid-reservation), don't
      // resume — Checkout would fail at purchase time anyway.
      if (event.status !== 'live') continue;

      return {
        active: true,
        eventId,
        slotId: doc.id,
        lockedUntil: lockedUntil.toISOString(),
        slot: {
          id: doc.id,
          wrestlerName: slot.wrestlerName,
          members: slot.members ?? [],
          brand: slot.brand,
          priceCents:
            typeof slot.priceCents === 'number'
              ? slot.priceCents
              : typeof slot.price === 'number'
                ? Math.round(slot.price * 100)
                : 0,
          tier: slot.tier,
          status: 'locked',
          lockedBy: uid,
          lockedAt: slot.lockedAt?.toDate?.()?.toISOString() ?? null,
          lockedUntil: lockedUntil.toISOString(),
          purchasedBy: null,
          purchasedAt: null,
          imageUrl: slot.imageUrl ?? null,
        },
      };
    }

    return { active: false };
  });
