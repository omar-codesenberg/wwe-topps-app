// TODO(paypal-cutover): remove this callable once PayPal flow is verified in production. See plan file #14.
//
// Legacy purchaseSlot callable. Kept around so the existing mobile app keeps
// working through the PayPal cutover. The body now delegates to the shared
// `finalize()` helper that the new PayPal capture / webhook handlers also use,
// with a synthetic `legacy:<uuid>` captureId so legacy and PayPal-issued
// captures live in disjoint ID spaces inside `purchases/`.
import * as functions from 'firebase-functions';
import { v4 as uuidv4 } from 'uuid';
import { db } from './utils/admin';
import { finalize } from './purchases/finalizeSlotPurchase';

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

    try {
      // Read the slot once outside the transaction just to get `priceCents`
      // for the finalize amount. (The transaction inside `finalize` re-reads
      // the slot atomically and validates state.)
      const slotDoc = await slotRef.get();
      if (!slotDoc.exists) {
        return { success: false, reason: 'NOT_FOUND' };
      }
      const slot = slotDoc.data()!;
      const amountCents: number = slot.priceCents ?? 0;

      const captureId = `legacy:${uuidv4()}`;

      const result = await db.runTransaction((tx) =>
        finalize(tx, {
          captureId,
          orderId: 'legacy',
          eventId,
          slotId,
          userId: uid,
          amountCents,
          correlationId: 'legacy',
          paypalEnv: 'sandbox',
        }),
      );

      // Preserve the legacy callable response shape so existing mobile clients
      // continue to work without redeploying the app.
      switch (result.status) {
        case 'finalized':
          return { success: true, purchaseId: result.purchaseId };
        case 'already_finalized':
          // Extremely unlikely with a fresh uuid; treat as success for the client.
          return { success: true, purchaseId: result.purchaseId };
        case 'already_sold_other':
          // Mirrors the prior NOT_YOUR_LOCK / SLOT_NOT_LOCKED branches.
          return { success: false, reason: 'SLOT_NOT_LOCKED' };
        case 'lock_expired':
          return { success: false, reason: 'LOCK_EXPIRED' };
        case 'refund_decided':
          // Cannot occur on the legacy path (no real PayPal refund pipeline),
          // but surface a stable reason if it ever does.
          return { success: false, reason: 'REFUND_DECIDED' };
        default:
          return { success: false, reason: 'UNKNOWN' };
      }
    } catch (error) {
      console.error('purchaseSlot error:', error);
      throw new functions.https.HttpsError('internal', 'Failed to purchase slot');
    }
  });
