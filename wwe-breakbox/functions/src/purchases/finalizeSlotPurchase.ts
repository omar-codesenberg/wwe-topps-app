/**
 * [B1] Idempotent slot-purchase finalize helper.
 *
 * Extracted from `purchaseSlot.ts` so that the same Firestore writes
 * (mark slot sold, write purchase doc, increment counters, close event when
 * the last slot sells) can be driven from three callers:
 *   - The legacy `purchaseSlot` callable (no real PayPal capture yet).
 *   - The Wave 3 `captureOrder` callable (post-PayPal capture).
 *   - The Wave 3 `webhook` handler (PAYMENT.CAPTURE.COMPLETED).
 *
 * Contract guarantees (per integration plan §20–§22, change-log C15 + S10):
 *
 *   - [C15] This function does NOT start its own transaction. The caller owns
 *     the `Transaction` handle so that finalize can be composed with other
 *     reads/writes (e.g. webhook event-id de-dupe doc) atomically.
 *
 *   - [S10] Decision-lock invariant. The very first reads on the transaction
 *     are `purchases/{captureId}` AND `pendingRefunds/{captureId}`. If either
 *     signals "this capture is already decided", finalize is a no-op and
 *     returns a discriminator the caller can branch on. This prevents the
 *     classic race where one path finalizes while another path issues a
 *     refund for the same capture.
 *
 *   - The `captureId` is the document ID for `purchases/{captureId}`.
 *     This is the PayPal capture ID in real flows; the legacy callable
 *     synthesises one as `legacy:<uuid>` so the two namespaces don't collide.
 *
 *   - Per §27 / §28 we deliberately do NOT persist payer-supplied PII
 *     (email, name, address) on the purchase doc.
 */

import type { Transaction } from 'firebase-admin/firestore';
import { db, FieldValue } from '../utils/admin';

// ---------------------------------------------------------------------------
// Public types — locked contract for Wave 3 (P8 captureOrder, P10 webhook).
// Do NOT change shape without coordinating with those agents.
// ---------------------------------------------------------------------------

export interface FinalizeArgs {
  /** PayPal capture ID (or `legacy:<uuid>` from the legacy callable). */
  captureId: string;
  /** PayPal order ID. `'legacy'` from the legacy callable. */
  orderId: string;
  eventId: string;
  slotId: string;
  userId: string;
  /** Amount captured, in cents. Stored as `priceCents` on the purchase doc. */
  amountCents: number;
  /** [S16] Correlation ID for log threading across the capture pipeline. */
  correlationId: string;
  /** Audit-trail tag indicating which PayPal env captured the payment. */
  paypalEnv: 'sandbox' | 'live';
}

export type FinalizeStatus =
  /** Purchase doc written, slot flipped to sold. */
  | 'finalized'
  /** `purchases/{captureId}` already exists — idempotent no-op. */
  | 'already_finalized'
  /**
   * `pendingRefunds/{captureId}` signals a refund decision is in flight or
   * complete. Caller must NOT issue another refund AND must NOT finalize.
   */
  | 'refund_decided'
  /** Slot is sold to a different user — caller should issue a refund. */
  | 'already_sold_other'
  /**
   * Slot is `available` (lock expired and was reset) and the caller does
   * NOT own the prior lock. Caller may extend the lock and retry, OR
   * issue a refund. Distinct from `already_sold_other` so the caller can
   * differentiate between "race lost" and "lock cleanup lost the claim".
   */
  | 'lock_expired';

export interface FinalizeResult {
  status: FinalizeStatus;
  /** Set when `status === 'finalized'` (equals `args.captureId`). */
  purchaseId?: string;
}

// ---------------------------------------------------------------------------
// Refund statuses that block finalize.
// `failed_will_retry` is intentionally OMITTED: that means a previous refund
// attempt failed transiently and has not actually moved money, so we are
// allowed to finalize over it (the recovery path).
// ---------------------------------------------------------------------------

const BLOCKING_REFUND_STATUSES: ReadonlySet<string> = new Set<string>([
  'requested',
  'in_flight',
  'completed',
  'alert_required',
]);

/**
 * Run the finalize body inside a caller-owned Firestore transaction.
 *
 * Read order is fixed (Firestore requires all reads before any writes):
 *   1. purchases/{captureId}     — idempotency
 *   2. pendingRefunds/{captureId} — decision-lock (S10)
 *   3. events/{eventId}/slots/{slotId} — slot state validation
 *   4. events/{eventId}            — for soldSlots / totalSlots / title
 */
export async function finalize(
  tx: Transaction,
  args: FinalizeArgs,
): Promise<FinalizeResult> {
  const purchaseRef = db.collection('purchases').doc(args.captureId);
  const pendingRefundRef = db
    .collection('pendingRefunds')
    .doc(args.captureId);
  const slotRef = db
    .collection('events')
    .doc(args.eventId)
    .collection('slots')
    .doc(args.slotId);
  const eventRef = db.collection('events').doc(args.eventId);
  const userRef = db.collection('users').doc(args.userId);

  // -------------------------------------------------------------------------
  // [S10] Decision-lock: read the two "already-decided" markers first.
  // -------------------------------------------------------------------------
  const purchaseSnap = await tx.get(purchaseRef);
  if (purchaseSnap.exists) {
    return { status: 'already_finalized', purchaseId: args.captureId };
  }

  const pendingRefundSnap = await tx.get(pendingRefundRef);
  if (pendingRefundSnap.exists) {
    const refundData = pendingRefundSnap.data() as { status?: string } | undefined;
    const refundStatus = refundData?.status;
    if (refundStatus && BLOCKING_REFUND_STATUSES.has(refundStatus)) {
      return { status: 'refund_decided' };
    }
    // status === 'failed_will_retry' (or unrecognised/missing) → fall through
    // and attempt to finalize. This is the recoverable case.
  }

  // -------------------------------------------------------------------------
  // Slot + event reads.
  // -------------------------------------------------------------------------
  const slotSnap = await tx.get(slotRef);
  const eventSnap = await tx.get(eventRef);

  if (!slotSnap.exists) {
    // Treat a missing slot as "lock expired with no claim" — caller decides.
    return { status: 'lock_expired' };
  }

  const slot = slotSnap.data() as {
    status?: string;
    lockedBy?: string | null;
    lockedUntil?: { toDate: () => Date } | null;
    purchasedBy?: string | null;
    wrestlerName?: string;
    brand?: string;
    tier?: string;
    priceCents?: number;
  };

  // Already-sold cases.
  if (slot.status === 'sold') {
    if (slot.purchasedBy === args.userId) {
      // Sold to this user but no purchase doc with this captureId. The most
      // likely cause is a prior finalize used a different captureId (e.g. the
      // legacy uuid path). We cannot safely re-finalize because we'd
      // double-credit the event counter. Treat as already_finalized so the
      // caller no-ops the capture.
      return { status: 'already_finalized', purchaseId: args.captureId };
    }
    return { status: 'already_sold_other' };
  }

  // Slot is `locked`: validate it belongs to this user and hasn't expired.
  if (slot.status === 'locked') {
    if (slot.lockedBy !== args.userId) {
      return { status: 'already_sold_other' };
    }
    const lockedUntil = slot.lockedUntil?.toDate?.();
    if (lockedUntil && lockedUntil.getTime() < Date.now()) {
      // Lock expired in-flight. Because we have a captured payment for this
      // user, we proceed with finalize anyway (the scheduler may have not
      // yet flipped the slot back to `available`). Falls through.
    }
  } else if (slot.status === 'available') {
    // Slot was reset to available by `releaseExpiredLocks`. We can only
    // proceed if this user previously owned the lock; otherwise another
    // user could grab it before us.
    if (slot.lockedBy && slot.lockedBy !== args.userId) {
      return { status: 'lock_expired' };
    }
    // `lockedBy` is either null or this user — proceed and treat as recovery.
  } else {
    // 'closed' or any unknown state.
    return { status: 'lock_expired' };
  }

  // -------------------------------------------------------------------------
  // Writes.
  // -------------------------------------------------------------------------
  const event = eventSnap.exists
    ? (eventSnap.data() as {
        title?: string;
        soldSlots?: number;
        totalSlots?: number;
      })
    : {};
  const newSoldSlots = (event.soldSlots ?? 0) + 1;
  const isLastSlot = newSoldSlots >= (event.totalSlots ?? 112);

  tx.update(slotRef, {
    status: 'sold',
    purchasedBy: args.userId,
    purchasedAt: FieldValue.serverTimestamp(),
    lockedBy: null,
    lockedAt: null,
    lockedUntil: null,
  });

  tx.set(purchaseRef, {
    id: args.captureId,
    userId: args.userId,
    eventId: args.eventId,
    slotId: args.slotId,
    wrestlerName: slot.wrestlerName,
    eventTitle: event.title,
    brand: slot.brand,
    tier: slot.tier,
    priceCents: args.amountCents,
    purchasedAt: FieldValue.serverTimestamp(),
    capturedAt: FieldValue.serverTimestamp(),
    captureId: args.captureId,
    paypalOrderId: args.orderId,
    paypalEnv: args.paypalEnv,
    correlationId: args.correlationId,
    status: 'completed',
  });

  if (eventSnap.exists) {
    tx.update(eventRef, {
      soldSlots: FieldValue.increment(1),
      ...(isLastSlot
        ? { status: 'closed', closesAt: FieldValue.serverTimestamp() }
        : {}),
    });
  }

  tx.update(userRef, {
    purchaseCount: FieldValue.increment(1),
  });

  return { status: 'finalized', purchaseId: args.captureId };
}
