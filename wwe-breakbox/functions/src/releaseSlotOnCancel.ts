import * as functions from 'firebase-functions';
import { db, FieldValue } from './utils/admin';
import * as logger from './utils/logger';
import {
  PAYPAL_CLIENT_ID,
  PAYPAL_CLIENT_SECRET,
} from './paypal/config';

// v1 `runWith({ secrets: [...] })` accepts string resource ids; surface the
// `.name` from each defineSecret reference so the per-environment naming
// stays centralised in `paypal/config.ts`.
const PAYPAL_SECRET_NAMES: string[] = [
  (PAYPAL_CLIENT_ID as unknown as { name: string }).name,
  (PAYPAL_CLIENT_SECRET as unknown as { name: string }).name,
];

/**
 * Release a slot lock when the user cancels checkout.
 *
 * Original behavior preserved: a user who holds the slot lock can release it,
 * making the slot available again. Calls without a held lock are no-ops
 * (returned as `{ success: true }` to keep the client UX simple).
 *
 * Extension (Wave 3 — [C5] + [S14]):
 *   1. Optional `orderId` parameter so the client can name the specific
 *      `paypalOrders/{orderId}` doc to void on cancel.
 *   2. [S14] CRITICAL: every Firestore lookup of `paypalOrders` is filtered on
 *      `userId == uid AND slotId == slotId AND status == 'created'`. Filtering
 *      on slotId alone would let user B void user A's open order by guessing
 *      (or observing) the slotId.
 *   3. Each matched open order doc is marked `status = 'voided_by_user'` with
 *      `voidedAt = serverTimestamp()`, then a best-effort PayPal POST
 *      `/v2/checkout/orders/{orderId}/void` is issued. PayPal failures are
 *      logged via `logger.warn('paypal_void_failed', ...)` and swallowed —
 *      PayPal will time the order out anyway, and the local `voided_by_user`
 *      state is the authoritative signal for our flow.
 *   4. The pre-existing slot-release logic runs after the void step, so a
 *      user who has cancelled but doesn't actually hold the lock still gets a
 *      consistent response (and their order is still marked voided).
 */

// Lazy-resolved client.request — keeps this module independently type-checkable
// even before P4's client.ts lands and lets tests `jest.mock('./paypal/client')`
// short-circuit cleanly.
type RequestFn = <TProjected>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  opts?: {
    requestId?: string;
    project: (resp: unknown) => TProjected;
    correlationId?: string;
  },
) => Promise<TProjected>;

function getRequest(): RequestFn {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('./paypal/client') as { request: RequestFn };
  return mod.request;
}

interface PayPalOrderDoc {
  userId?: string;
  slotId?: string;
  status?: string;
}

/**
 * Mark a single `paypalOrders` doc as voided_by_user (Firestore) and best-effort
 * void it on PayPal's side. Caller MUST have already verified ownership.
 */
async function voidOpenOrder(
  orderId: string,
  correlationId: string,
): Promise<void> {
  const orderRef = db.collection('paypalOrders').doc(orderId);
  try {
    await orderRef.update({
      status: 'voided_by_user',
      voidedAt: FieldValue.serverTimestamp(),
    });
  } catch (writeErr) {
    logger.warn('paypal_void_firestore_write_failed', {
      orderId,
      correlationId,
      error:
        writeErr instanceof Error ? writeErr.message : String(writeErr),
    });
    // Don't return — still attempt the PayPal-side void so we don't leave a
    // half-cancelled order in PayPal if our local write hit a transient issue.
  }

  // Best-effort PayPal-side void. PayPal will time the order out on its own
  // schedule even if this fails, so we never throw.
  try {
    const request = getRequest();
    await request<Record<string, unknown>>(
      'POST',
      `/v2/checkout/orders/${orderId}/void`,
      undefined,
      {
        // No projection needed for a void (204 No Content) — return empty obj.
        project: () => ({}),
        correlationId,
      },
    );
  } catch (err) {
    logger.warn('paypal_void_failed', {
      orderId,
      correlationId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Resolve the set of open `paypalOrders` doc IDs to void.
 *
 * If the client passed `orderId`, look up that specific doc and (defense in
 * depth, [S14]) re-assert ownership; only proceed if the doc belongs to this
 * user, references this slot, and is still in `status == 'created'`.
 *
 * Otherwise, query for `userId == uid AND slotId == slotId AND
 * status == 'created'` — the userId filter is what blocks user B from voiding
 * user A's order.
 */
async function findOpenOrderIds(
  uid: string,
  slotId: string,
  orderId: string | null,
  correlationId: string,
): Promise<string[]> {
  if (orderId) {
    try {
      const snap = await db.collection('paypalOrders').doc(orderId).get();
      if (!snap.exists) return [];
      const doc = (snap.data() ?? {}) as PayPalOrderDoc;
      // [S14] Defense-in-depth: triple-check userId, slotId, and status before
      // attributing the void. We do NOT trust `orderId` alone.
      if (
        doc.userId !== uid ||
        doc.slotId !== slotId ||
        doc.status !== 'created'
      ) {
        logger.warn('paypal_void_ownership_mismatch', {
          orderId,
          callerUid: uid,
          slotId,
          correlationId,
        });
        return [];
      }
      return [orderId];
    } catch (err) {
      logger.warn('paypal_void_lookup_failed', {
        orderId,
        correlationId,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  // [S14] No orderId given — query by the (uid, slotId, status) triple. NEVER
  // by slotId alone.
  try {
    const snapshot = await db
      .collection('paypalOrders')
      .where('userId', '==', uid)
      .where('slotId', '==', slotId)
      .where('status', '==', 'created')
      .get();
    const ids: string[] = [];
    snapshot.forEach((d) => ids.push(d.id));
    return ids;
  } catch (err) {
    logger.warn('paypal_void_query_failed', {
      callerUid: uid,
      slotId,
      correlationId,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

export const releaseSlotOnCancel = functions
  .runWith({ secrets: PAYPAL_SECRET_NAMES })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'Must be authenticated',
      );
    }
    const { eventId, slotId, orderId } = (data ?? {}) as {
      eventId?: string;
      slotId?: string;
      orderId?: string;
    };
    if (!eventId || !slotId) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'eventId and slotId required',
      );
    }
    const uid = context.auth.uid;
    const correlationId = `releaseSlotOnCancel:${eventId}:${slotId}:${uid}`;

    // ---- [C5] + [S14]: void any open paypalOrders for (uid, slotId) --------
    const orderIds = await findOpenOrderIds(
      uid,
      slotId,
      typeof orderId === 'string' && orderId.length > 0 ? orderId : null,
      correlationId,
    );
    for (const id of orderIds) {
      await voidOpenOrder(id, correlationId);
    }

    // ---- Existing slot-release logic (unchanged behavior) ------------------
    const slotRef = db.collection('events').doc(eventId).collection('slots').doc(slotId);
    try {
      await db.runTransaction(async (transaction) => {
        const slotDoc = await transaction.get(slotRef);
        if (!slotDoc.exists) return;
        const slot = slotDoc.data()!;
        if (slot.status !== 'locked' || slot.lockedBy !== uid) return;
        transaction.update(slotRef, {
          status: 'available',
          lockedBy: null,
          lockedAt: null,
          lockedUntil: null,
        });
      });
      return { success: true };
    } catch (error) {
      console.error('releaseSlotOnCancel error:', error);
      return { success: true };
    }
  });
