import * as functions from 'firebase-functions';
import { db, FieldValue, Timestamp } from '../utils/admin';
import { deriveTier } from '../utils/tier';
import { requireAdmin } from '../utils/requireAdmin';

type Brand = 'RAW' | 'SMACKDOWN' | 'NXT' | 'LEGENDS';

interface SlotInput {
  wrestlerName: string;
  members?: string[];
  price: number;
  brand: Brand;
}

interface Input {
  title: string;
  opensAt: number; // ms epoch
  description?: string;
  slots: SlotInput[];
}

const VALID_BRANDS: Brand[] = ['RAW', 'SMACKDOWN', 'NXT', 'LEGENDS'];

export const createEventWithSlots = functions
  .runWith({ minInstances: 0, timeoutSeconds: 120 })
  .https.onCall(async (data: Input, context) => {
    requireAdmin(context);
    const { title, opensAt, description, slots } = data || ({} as Input);

    if (!title || typeof title !== 'string') {
      throw new functions.https.HttpsError('invalid-argument', 'title is required');
    }
    if (!opensAt || typeof opensAt !== 'number') {
      throw new functions.https.HttpsError('invalid-argument', 'opensAt (ms epoch) is required');
    }
    if (!Array.isArray(slots) || slots.length === 0) {
      throw new functions.https.HttpsError('invalid-argument', 'slots array is required');
    }
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (!s.wrestlerName || typeof s.wrestlerName !== 'string') {
        throw new functions.https.HttpsError('invalid-argument', `slots[${i}].wrestlerName invalid`);
      }
      if (typeof s.price !== 'number' || s.price < 0) {
        throw new functions.https.HttpsError('invalid-argument', `slots[${i}].price invalid`);
      }
      if (!VALID_BRANDS.includes(s.brand)) {
        throw new functions.https.HttpsError('invalid-argument', `slots[${i}].brand invalid`);
      }
    }

    const eventRef = db.collection('events').doc();
    const eventId = eventRef.id;

    // Firestore batched writes (transaction not required — new doc IDs only).
    // Chunked into batches of 400 (under 500-write hard limit).
    const slotIds: string[] = [];
    const BATCH_SIZE = 400;

    // First batch creates the event itself + first chunk of slots.
    let firstBatch = db.batch();
    firstBatch.set(eventRef, {
      title,
      description: description ?? '',
      status: 'upcoming',
      opensAt: Timestamp.fromMillis(opensAt),
      closesAt: null,
      imageUrl: null,
      totalSlots: slots.length,
      soldSlots: 0,
      featuredSlotIds: [],
      createdAt: FieldValue.serverTimestamp(),
      createdBy: context.auth!.uid,
    });

    const firstChunk = slots.slice(0, BATCH_SIZE - 1);
    for (const s of firstChunk) {
      const slotRef = eventRef.collection('slots').doc();
      slotIds.push(slotRef.id);
      firstBatch.set(slotRef, {
        wrestlerName: s.wrestlerName,
        members: s.members ?? [],
        brand: s.brand,
        price: s.price,
        tier: deriveTier(s.price),
        status: 'available',
        lockedBy: null,
        lockedAt: null,
        lockedUntil: null,
        purchasedBy: null,
        purchasedAt: null,
        imageUrl: null,
      });
    }
    await firstBatch.commit();

    // Remaining slots in subsequent batches.
    for (let i = BATCH_SIZE - 1; i < slots.length; i += BATCH_SIZE) {
      const batch = db.batch();
      const chunk = slots.slice(i, i + BATCH_SIZE);
      for (const s of chunk) {
        const slotRef = eventRef.collection('slots').doc();
        slotIds.push(slotRef.id);
        batch.set(slotRef, {
          wrestlerName: s.wrestlerName,
          members: s.members ?? [],
          brand: s.brand,
          price: s.price,
          tier: deriveTier(s.price),
          status: 'available',
          lockedBy: null,
          lockedAt: null,
          lockedUntil: null,
          purchasedBy: null,
          purchasedAt: null,
          imageUrl: null,
        });
      }
      await batch.commit();
    }

    return { eventId, slotCount: slotIds.length };
  });
