/**
 * [Wave 3, file #4] PayPal capture-order callable.
 *
 * Implements:
 *   [C2]  Server-side amount/currency assertion: the captured PayPal amount
 *         MUST equal the `expectedAmount` we stamped on `paypalOrders/{orderId}`
 *         at create-order time, AND the currency MUST be CAD. On any mismatch
 *         we IMMEDIATELY refund the capture and refuse to finalize.
 *   [S1]  Strict string equality on the amount (no float compare). PayPal
 *         normalises trailing-zero forms ("10.10" vs "10.1") and a float
 *         compare would silently treat those as equal, masking a real
 *         mismatch in the wire format.
 *   [S9]  Mismatch logger event `paypal_amount_mismatch` so SRE can dashboard
 *         /  alert on the rate. Includes orderId, captureId, expected, actual,
 *         correlationId.
 *   [S10] Decision-lock at finalize time: `finalize()` reads
 *         `purchases/{captureId}` and `pendingRefunds/{captureId}` first and
 *         short-circuits if the capture is already decided. We branch on its
 *         result rather than re-checking ourselves.
 *   [S11] PayPal-side idempotency: capture call uses request-id
 *         `capture:${orderId}`; the refund call (delegated to
 *         `refundCapture()`) uses `refund:${captureId}:full` internally.
 *   [S16] `correlationId` is sourced from `paypalOrders.correlationId` (set at
 *         create-order time) and threaded through PayPal calls and logs.
 *   [C9]  Authorization: only the user who created the order can capture it.
 *         A different uid trying to capture a stranger's order is rejected
 *         with `permission-denied` BEFORE any PayPal call.
 */
import * as functions from 'firebase-functions';
import { db, FieldValue } from '../utils/admin';
import { request, SanitizedError } from './client';
import { refundCapture } from './refund';
import { finalize } from '../purchases/finalizeSlotPurchase';
import * as logger from '../utils/logger';
import {
  PAYPAL_CLIENT_ID,
  PAYPAL_CLIENT_SECRET,
  PAYPAL_ENV,
} from './config';

// ---------------------------------------------------------------------------
// Types — shape we project the PayPal capture response down to (S8).
// ---------------------------------------------------------------------------

interface ProjectedCapture {
  id: string;
  status: string;
  amount: { value: string; currency_code: string };
  custom_id?: string;
}

interface ProjectedCaptureResponse {
  id: string;
  status: string;
  purchase_units: Array<{
    payments: {
      captures: ProjectedCapture[];
    };
  }>;
}

interface PaypalOrderDoc {
  userId: string;
  status: string;
  expectedAmount: string;
  currency?: string;
  eventId: string;
  slotId: string;
  correlationId: string;
}

interface CaptureRequest {
  orderId?: unknown;
}

// ---------------------------------------------------------------------------
// Projector for the capture HTTP response.
// ---------------------------------------------------------------------------

function projectCapture(resp: unknown): ProjectedCaptureResponse {
  const r = (resp ?? {}) as Record<string, unknown>;
  const id = typeof r.id === 'string' ? r.id : '';
  const status = typeof r.status === 'string' ? r.status : '';
  const rawUnits = Array.isArray(r.purchase_units) ? r.purchase_units : [];
  const purchase_units = rawUnits.map((u) => {
    const unit = (u ?? {}) as Record<string, unknown>;
    const payments = (unit.payments ?? {}) as Record<string, unknown>;
    const rawCaps = Array.isArray(payments.captures) ? payments.captures : [];
    const captures: ProjectedCapture[] = rawCaps.map((c) => {
      const cap = (c ?? {}) as Record<string, unknown>;
      const amt = (cap.amount ?? {}) as Record<string, unknown>;
      return {
        id: typeof cap.id === 'string' ? cap.id : '',
        status: typeof cap.status === 'string' ? cap.status : '',
        amount: {
          value: typeof amt.value === 'string' ? amt.value : '',
          currency_code:
            typeof amt.currency_code === 'string' ? amt.currency_code : '',
        },
        custom_id:
          typeof cap.custom_id === 'string' ? cap.custom_id : undefined,
      };
    });
    return { payments: { captures } };
  });
  return { id, status, purchase_units };
}

// ---------------------------------------------------------------------------
// Callable — v1 onCall with secrets bound (no webhook id needed here).
// ---------------------------------------------------------------------------

export const capturePayPalOrder = functions
  .runWith({
    minInstances: 0,
    secrets: [PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET],
  })
  .https.onCall(async (data: CaptureRequest, context) => {
    // ---- Auth ------------------------------------------------------------
    if (!context.auth) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'Must be authenticated',
      );
    }
    const uid = context.auth.uid;

    const orderId = typeof data?.orderId === 'string' ? data.orderId : '';
    if (!orderId) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'orderId is required',
      );
    }

    // ---- Load the order doc ---------------------------------------------
    const orderRef = db.collection('paypalOrders').doc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Order not found');
    }
    const order = orderSnap.data() as PaypalOrderDoc | undefined;
    if (!order) {
      throw new functions.https.HttpsError('not-found', 'Order not found');
    }

    // ---- [C9] Authorization check ---------------------------------------
    if (order.userId !== uid) {
      throw new functions.https.HttpsError(
        'permission-denied',
        'You do not own this order',
      );
    }

    const correlationId = order.correlationId;
    const log = logger.withCorrelationId(correlationId);

    // ---- Status gating ---------------------------------------------------
    if (order.status === 'voided_by_user') {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Order has been voided',
        { code: 'ORDER_VOIDED' },
      );
    }
    if (order.status === 'captured') {
      // Capture already happened on a prior call; surface the existing
      // purchase doc rather than re-calling PayPal.
      // The purchase doc id == captureId; we don't have captureId on the
      // order doc directly so we look it up via the
      // `paypalOrders.captureId` field if present, else search.
      const orderData = order as PaypalOrderDoc & { captureId?: string };
      if (orderData.captureId) {
        return { success: true, purchaseId: orderData.captureId };
      }
      // Fall back: no captureId persisted (shouldn't happen, but degrade
      // gracefully) — return success without a purchaseId.
      return { success: true };
    }

    // ---- PayPal capture call --------------------------------------------
    // Negative-testing hook: in sandbox only, if
    // `PAYPAL_SANDBOX_MOCK_APPLICATION_CODE` is set (e.g. `INSTRUMENT_DECLINED`,
    // `PAYER_ACCOUNT_RESTRICTED`, `TRANSACTION_REFUSED`), PayPal's sandbox
    // returns a simulated failure with that application code so we can
    // validate decline paths without manipulating buyer balances. See
    // docs/payments-runbook.md §4 "Negative testing".
    const mockApplicationCode =
      PAYPAL_ENV === 'sandbox'
        ? process.env.PAYPAL_SANDBOX_MOCK_APPLICATION_CODE
        : undefined;
    const mockResponse =
      mockApplicationCode && mockApplicationCode.length > 0
        ? { mockApplicationCodes: mockApplicationCode }
        : undefined;

    let response: ProjectedCaptureResponse;
    try {
      response = await request<ProjectedCaptureResponse>(
        'POST',
        `/v2/checkout/orders/${orderId}/capture`,
        {},
        {
          requestId: `capture:${orderId}`,
          project: projectCapture,
          correlationId,
          mockResponse,
        },
      );
    } catch (err) {
      // SanitizedError from client.ts. Surface as internal — callers can
      // safely retry: the deterministic request-id makes PayPal idempotent.
      const sErr = err as SanitizedError;
      log.error('paypal_capture_failed', sErr, { orderId });
      throw new functions.https.HttpsError(
        'internal',
        sErr.message || 'PayPal capture failed',
      );
    }

    const cap =
      response.purchase_units[0]?.payments?.captures?.[0] ?? undefined;
    if (!cap || !cap.id) {
      log.error('paypal_capture_missing_capture', null, {
        orderId,
        responseId: response.id,
      });
      throw new functions.https.HttpsError(
        'internal',
        'PayPal capture response missing capture id',
      );
    }

    // ---- [C2 + S1 + S9] Amount / currency assertion ---------------------
    const amountMismatch = cap.amount.value !== order.expectedAmount;
    const currencyMismatch = cap.amount.currency_code !== 'CAD';
    if (amountMismatch || currencyMismatch) {
      log.error('paypal_amount_mismatch', null, {
        orderId,
        captureId: cap.id,
        expected: order.expectedAmount,
        actual: cap.amount.value,
        expectedCurrency: 'CAD',
        actualCurrency: cap.amount.currency_code,
        correlationId,
      });
      // Issue a refund — do NOT finalize. Best-effort; if the refund fails
      // transiently the scheduler picks it up.
      try {
        await refundCapture(cap.id, 'amount_mismatch', correlationId);
      } catch (refundErr) {
        log.error('paypal_amount_mismatch_refund_failed', refundErr, {
          captureId: cap.id,
        });
      }
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Captured amount or currency does not match the order',
        { code: 'AMOUNT_MISMATCH' },
      );
    }

    // ---- [S10] Finalize via decision-lock transaction --------------------
    // Convert "10.10" → 1010 cents via Math.round on parseFloat * 100. We
    // already know the string equals expectedAmount, so either source is
    // fine — use expectedAmount for clarity.
    const amountCents = Math.round(parseFloat(order.expectedAmount) * 100);

    let finalizeResult: Awaited<ReturnType<typeof finalize>>;
    try {
      finalizeResult = await db.runTransaction((tx) =>
        finalize(tx, {
          captureId: cap.id,
          orderId,
          eventId: order.eventId,
          slotId: order.slotId,
          userId: uid,
          amountCents,
          correlationId,
          paypalEnv: PAYPAL_ENV,
        }),
      );
    } catch (txErr) {
      log.error('paypal_finalize_transaction_failed', txErr, {
        orderId,
        captureId: cap.id,
      });
      // Money has been captured but our finalize failed for an unknown
      // reason. Throw internal — operator pages on this; do NOT auto-refund
      // because the next call will hit `purchases/{captureId}` (if it
      // somehow committed) or the slot is still locked for retry.
      throw new functions.https.HttpsError(
        'internal',
        'Failed to finalize purchase',
      );
    }

    switch (finalizeResult.status) {
      case 'finalized':
      case 'already_finalized': {
        // Stamp the order as captured and persist the captureId for
        // subsequent idempotent calls.
        try {
          await orderRef.update({
            status: 'captured',
            captureId: cap.id,
            capturedAt: FieldValue.serverTimestamp(),
          });
        } catch (updErr) {
          log.error('paypal_order_status_update_failed', updErr, {
            orderId,
            captureId: cap.id,
          });
        }
        log.info('paypal_capture_finalized', {
          orderId,
          captureId: cap.id,
          status: finalizeResult.status,
        });
        return { success: true, purchaseId: finalizeResult.purchaseId };
      }
      case 'refund_decided': {
        // A pending refund decision is already in flight. Do NOT issue a
        // second refund — the existing pendingRefunds doc is the source of
        // truth.
        log.warn('paypal_capture_refund_decided', {
          orderId,
          captureId: cap.id,
        });
        return { success: false, reason: 'REFUND_DECIDED' };
      }
      case 'already_sold_other': {
        const refundStatus = await refundCapture(
          cap.id,
          'slot_sold_to_other',
          correlationId,
        );
        log.warn('paypal_capture_slot_sold_other', {
          orderId,
          captureId: cap.id,
          refundStatus: refundStatus.status,
        });
        return {
          success: false,
          reason: 'SLOT_SOLD_OTHER',
          refundStatus,
        };
      }
      case 'lock_expired': {
        const refundStatus = await refundCapture(
          cap.id,
          'lock_expired',
          correlationId,
        );
        log.warn('paypal_capture_lock_expired', {
          orderId,
          captureId: cap.id,
          refundStatus: refundStatus.status,
        });
        return {
          success: false,
          reason: 'LOCK_EXPIRED',
          refundStatus,
        };
      }
      default: {
        // Defensive — finalize() shouldn't return anything else.
        log.error('paypal_finalize_unknown_status', null, {
          orderId,
          captureId: cap.id,
          status: (finalizeResult as { status: string }).status,
        });
        throw new functions.https.HttpsError(
          'internal',
          'Unknown finalize status',
        );
      }
    }
  });
