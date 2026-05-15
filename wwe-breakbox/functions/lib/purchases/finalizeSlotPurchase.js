"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.finalize = finalize;
const admin_1 = require("../utils/admin");
// ---------------------------------------------------------------------------
// Refund statuses that block finalize.
// `failed_will_retry` is intentionally OMITTED: that means a previous refund
// attempt failed transiently and has not actually moved money, so we are
// allowed to finalize over it (the recovery path).
// ---------------------------------------------------------------------------
const BLOCKING_REFUND_STATUSES = new Set([
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
async function finalize(tx, args) {
    var _a, _b, _c, _d;
    const purchaseRef = admin_1.db.collection('purchases').doc(args.captureId);
    const pendingRefundRef = admin_1.db
        .collection('pendingRefunds')
        .doc(args.captureId);
    const slotRef = admin_1.db
        .collection('events')
        .doc(args.eventId)
        .collection('slots')
        .doc(args.slotId);
    const eventRef = admin_1.db.collection('events').doc(args.eventId);
    const userRef = admin_1.db.collection('users').doc(args.userId);
    // -------------------------------------------------------------------------
    // [S10] Decision-lock: read the two "already-decided" markers first.
    // -------------------------------------------------------------------------
    const purchaseSnap = await tx.get(purchaseRef);
    if (purchaseSnap.exists) {
        return { status: 'already_finalized', purchaseId: args.captureId };
    }
    const pendingRefundSnap = await tx.get(pendingRefundRef);
    if (pendingRefundSnap.exists) {
        const refundData = pendingRefundSnap.data();
        const refundStatus = refundData === null || refundData === void 0 ? void 0 : refundData.status;
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
    const slot = slotSnap.data();
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
        const lockedUntil = (_b = (_a = slot.lockedUntil) === null || _a === void 0 ? void 0 : _a.toDate) === null || _b === void 0 ? void 0 : _b.call(_a);
        if (lockedUntil && lockedUntil.getTime() < Date.now()) {
            // Lock expired in-flight. Because we have a captured payment for this
            // user, we proceed with finalize anyway (the scheduler may have not
            // yet flipped the slot back to `available`). Falls through.
        }
    }
    else if (slot.status === 'available') {
        // Slot was reset to available by `releaseExpiredLocks`. We can only
        // proceed if this user previously owned the lock; otherwise another
        // user could grab it before us.
        if (slot.lockedBy && slot.lockedBy !== args.userId) {
            return { status: 'lock_expired' };
        }
        // `lockedBy` is either null or this user — proceed and treat as recovery.
    }
    else {
        // 'closed' or any unknown state.
        return { status: 'lock_expired' };
    }
    // -------------------------------------------------------------------------
    // Writes.
    // -------------------------------------------------------------------------
    const event = eventSnap.exists
        ? eventSnap.data()
        : {};
    const newSoldSlots = ((_c = event.soldSlots) !== null && _c !== void 0 ? _c : 0) + 1;
    // If `totalSlots` is missing from the event doc, never auto-close. Admin
    // can close manually. Previous behavior used a hardcoded 112 (the seed
    // event's slot count) which silently produced wrong close decisions for
    // any other event size.
    const isLastSlot = newSoldSlots >= ((_d = event.totalSlots) !== null && _d !== void 0 ? _d : Infinity);
    tx.update(slotRef, {
        status: 'sold',
        purchasedBy: args.userId,
        purchasedAt: admin_1.FieldValue.serverTimestamp(),
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
        purchasedAt: admin_1.FieldValue.serverTimestamp(),
        capturedAt: admin_1.FieldValue.serverTimestamp(),
        captureId: args.captureId,
        paypalOrderId: args.orderId,
        paypalEnv: args.paypalEnv,
        correlationId: args.correlationId,
        status: 'completed',
    });
    if (eventSnap.exists) {
        tx.update(eventRef, Object.assign({ soldSlots: admin_1.FieldValue.increment(1) }, (isLastSlot
            ? { status: 'closed', closesAt: admin_1.FieldValue.serverTimestamp() }
            : {})));
    }
    tx.update(userRef, {
        purchaseCount: admin_1.FieldValue.increment(1),
    });
    return { status: 'finalized', purchaseId: args.captureId };
}
//# sourceMappingURL=finalizeSlotPurchase.js.map