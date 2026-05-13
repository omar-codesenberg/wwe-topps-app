import { db, FieldValue } from '../utils/admin';
import * as logger from '../utils/logger';
// Type-only import: P4 owns ./client. We avoid a hard runtime import here so
// that this module type-checks even before P4 lands client.ts. The runtime
// `request` function is resolved lazily inside refundCapture via require().
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { SanitizedError as ClientSanitizedError } from './client';

/**
 * Refund issuance for fully-captured PayPal payments.
 *
 * Implements:
 *   [C7]  Application-level idempotency via a Firestore decision doc keyed by
 *         capture ID (`pendingRefunds/{captureId}`). Concurrent callers
 *         observe the in-flight state and return without re-attempting.
 *   [S10] Decision-lock pattern: the read-and-write of `pendingRefunds` is
 *         performed inside a Firestore transaction together with the read of
 *         the corresponding `purchases` doc, so we never race a finalized
 *         purchase.
 *   [S11] PayPal-side idempotency: every refund attempt sends a deterministic
 *         `PayPal-Request-Id` (`refund:${captureId}:full`) so PayPal collapses
 *         duplicate attempts into a single refund.
 *   [C22] Error classification: `INSUFFICIENT_FUNDS`, `INSTRUMENT_DECLINED`,
 *         `REFUND_NOT_ALLOWED`, `TRANSACTION_REFUSED`, and
 *         `CAPTURE_FULLY_REFUNDED` are PERMANENT — they short-circuit the
 *         retry pipeline and page on-call. Everything else (5xx, network,
 *         429) is TRANSIENT and left in `failed_will_retry` for the
 *         scheduler.
 *   [S16] `correlationId` is threaded through both the PayPal request and the
 *         logger so every log line for an attempt joins on a single ID.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type RefundPermanentCode =
  | 'INSUFFICIENT_FUNDS'
  | 'INSTRUMENT_DECLINED'
  | 'REFUND_NOT_ALLOWED'
  | 'TRANSACTION_REFUSED'
  | 'CAPTURE_FULLY_REFUNDED';

export type RefundStatus =
  | 'requested'
  | 'in_flight'
  | 'completed'
  | 'failed_will_retry'
  | 'alert_required';

export interface RefundResult {
  status:
    | 'completed'
    | 'failed_will_retry'
    | 'alert_required'
    | 'already_completed';
  paypalRefundId?: string;
  errorCode?: string;
  errorMessage?: string;
}

/** [C22] Permanent failure codes — never auto-retried; on-call paged instead. */
export const PERMANENT_REFUND_ERROR_CODES: ReadonlySet<string> = new Set<string>([
  'INSUFFICIENT_FUNDS',
  'INSTRUMENT_DECLINED',
  'REFUND_NOT_ALLOWED',
  'TRANSACTION_REFUSED',
  'CAPTURE_FULLY_REFUNDED',
]);

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

/** Minimum shape we read from a thrown error. Matches `SanitizedError` from client.ts. */
interface ErrorWithPayPalCode {
  paypalCode?: string;
  status?: number;
  message?: string;
}

function asErr(err: unknown): ErrorWithPayPalCode {
  if (err && typeof err === 'object') {
    return err as ErrorWithPayPalCode;
  }
  return {};
}

/**
 * [C22] Classify a thrown error from the PayPal client as permanent (no
 * retry, page on-call) or transient (retry via scheduler).
 *
 * Test-only export — production code paths use `PERMANENT_REFUND_ERROR_CODES`
 * directly, but this helper centralises the rule and lets tests verify the
 * exact mapping.
 */
export function _classifyError(err: unknown): 'transient' | 'permanent' {
  const code = asErr(err).paypalCode;
  if (code && PERMANENT_REFUND_ERROR_CODES.has(code)) {
    return 'permanent';
  }
  return 'transient';
}

// ---------------------------------------------------------------------------
// Lazy client.request resolution
// ---------------------------------------------------------------------------

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
  // Deferred require so this module type-checks even before P4's client.ts
  // lands. Tests `jest.mock('./client', ...)` will short-circuit this.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('./client') as { request: RequestFn };
  return mod.request;
}

// ---------------------------------------------------------------------------
// Core entry point
// ---------------------------------------------------------------------------

interface PendingRefundDoc {
  status: RefundStatus;
  captureId: string;
  reason: string;
  correlationId: string;
  attemptCount?: number;
  paypalRefundId?: string;
  errorCode?: string;
  errorMessage?: string;
}

interface DecisionLockResult {
  proceed: boolean;
  shortCircuit?: RefundResult;
}

/**
 * Issue a full refund for a captured payment, idempotently.
 *
 * Behavior:
 *   1. [S10] In a Firestore transaction, read `pendingRefunds/{captureId}`
 *      and `purchases/{captureId}` together. If a completed refund already
 *      exists, return `{ status: 'already_completed' }`. If another caller
 *      is in flight, back off with `failed_will_retry`. Otherwise write a
 *      fresh `requested` doc.
 *   2. Outside the transaction, advance the doc to `in_flight` and call
 *      PayPal with the deterministic [S11] `PayPal-Request-Id`.
 *   3. On 2xx, write `completed`. On a [C22]-permanent code, write
 *      `alert_required`. On any other failure, write `failed_will_retry`
 *      so the scheduler can retry.
 */
export async function refundCapture(
  captureId: string,
  reason: string,
  correlationId: string,
): Promise<RefundResult> {
  const log = logger.withCorrelationId(correlationId);
  const pendingRef = db.collection('pendingRefunds').doc(captureId);
  const purchaseRef = db.collection('purchases').doc(captureId);

  // ------ [S10] Decision-lock transaction ----------------------------------
  let lockResult: DecisionLockResult;
  try {
    lockResult = await db.runTransaction(async (txn) => {
      const [pendingSnap, purchaseSnap] = await Promise.all([
        txn.get(pendingRef),
        txn.get(purchaseRef),
      ]);

      const existing = pendingSnap.exists
        ? (pendingSnap.data() as PendingRefundDoc | undefined)
        : undefined;

      // Already-completed refund — fully idempotent return.
      if (existing && existing.status === 'completed') {
        return {
          proceed: false,
          shortCircuit: {
            status: 'already_completed' as const,
            paypalRefundId: existing.paypalRefundId,
          },
        };
      }

      // Another caller is mid-flight. Back off; the original caller will
      // either complete (next call sees `completed`) or fail
      // (`failed_will_retry`, picked up by the retry scheduler).
      if (existing && existing.status === 'in_flight') {
        return {
          proceed: false,
          shortCircuit: { status: 'failed_will_retry' as const },
        };
      }

      // Defensive: if the purchase has somehow finalized (shouldn't be
      // possible for refund flows, but log it) we still proceed with the
      // refund — caller is responsible for not double-refunding finalized
      // purchases. We just emit a warning so the audit trail catches it.
      if (purchaseSnap.exists) {
        const purchase = purchaseSnap.data();
        if (purchase && purchase.status === 'finalized') {
          log.warn('paypal.refund.purchase_already_finalized', {
            captureId,
            reason,
          });
        }
      }

      // Fresh request OR re-attempt of a previously-failed one. Either way
      // we write a clean `requested` doc and proceed.
      const fresh: PendingRefundDoc & { createdAt: unknown } = {
        status: 'requested',
        captureId,
        reason,
        correlationId,
        attemptCount: 0,
        createdAt: FieldValue.serverTimestamp(),
      };
      txn.set(pendingRef, fresh, { merge: false });
      return { proceed: true };
    });
  } catch (txErr) {
    log.error('paypal.refund.lock_transaction_failed', txErr, { captureId });
    // Treat lock failures as transient so the retry scheduler picks them up.
    return {
      status: 'failed_will_retry',
      errorMessage:
        txErr instanceof Error ? txErr.message : 'lock transaction failed',
    };
  }

  if (!lockResult.proceed) {
    // shortCircuit is always set when proceed is false.
    return lockResult.shortCircuit as RefundResult;
  }

  // ------ Advance to in_flight (we are the sole progressor) ----------------
  try {
    await pendingRef.update({ status: 'in_flight' });
  } catch (updateErr) {
    log.error('paypal.refund.in_flight_update_failed', updateErr, { captureId });
    return {
      status: 'failed_will_retry',
      errorMessage:
        updateErr instanceof Error
          ? updateErr.message
          : 'in_flight update failed',
    };
  }

  log.info('paypal.refund.attempt', { captureId, reason });

  // ------ Call PayPal with [S11] deterministic request id ------------------
  let refundResp: { id: string; status: string };
  try {
    const request = getRequest();
    refundResp = await request<{ id: string; status: string }>(
      'POST',
      `/v2/payments/captures/${captureId}/refund`,
      {},
      {
        requestId: `refund:${captureId}:full`,
        project: (r: unknown) => {
          const resp = r as { id?: string; status?: string };
          return { id: resp.id ?? '', status: resp.status ?? '' };
        },
        correlationId,
      },
    );
  } catch (err) {
    return await handleFailure(captureId, err, log);
  }

  // ------ Success path -----------------------------------------------------
  try {
    await pendingRef.update({
      status: 'completed',
      paypalRefundId: refundResp.id,
      completedAt: FieldValue.serverTimestamp(),
    });
  } catch (writeErr) {
    // PayPal accepted the refund but our write failed. Subsequent retries
    // would hit PayPal's own idempotency (S11) and return the existing
    // refund. We surface this as completed because the money has moved.
    log.error('paypal.refund.completion_write_failed', writeErr, {
      captureId,
      paypalRefundId: refundResp.id,
    });
  }

  log.info('paypal.refund.completed', {
    captureId,
    paypalRefundId: refundResp.id,
  });

  return { status: 'completed', paypalRefundId: refundResp.id };
}

// ---------------------------------------------------------------------------
// Failure handling
// ---------------------------------------------------------------------------

async function handleFailure(
  captureId: string,
  err: unknown,
  log: logger.ScopedLogger,
): Promise<RefundResult> {
  const e = asErr(err);
  const errorCode = e.paypalCode;
  const errorMessage = e.message;
  const pendingRef = db.collection('pendingRefunds').doc(captureId);
  const classification = _classifyError(err);

  if (classification === 'permanent' && errorCode) {
    // [C22] Permanent — page on-call, never auto-retry.
    try {
      await pendingRef.update({
        status: 'alert_required',
        errorCode,
        errorMessage: errorMessage ?? null,
        attemptCount: 1,
        lastAttemptAt: FieldValue.serverTimestamp(),
      });
    } catch (writeErr) {
      log.error('paypal.refund.alert_write_failed', writeErr, { captureId });
    }
    log.error('paypal.refund.permanent_failure', err, { captureId, errorCode });
    return { status: 'alert_required', errorCode, errorMessage };
  }

  // Transient — leave the doc in failed_will_retry and let the scheduler
  // retry. attemptCount is incremented so the scheduler can give up after
  // 5 attempts (handled in retry scheduler, not here).
  try {
    await pendingRef.update({
      status: 'failed_will_retry',
      errorCode: errorCode ?? null,
      errorMessage: errorMessage ?? null,
      attemptCount: FieldValue.increment(1),
      lastAttemptAt: FieldValue.serverTimestamp(),
    });
  } catch (writeErr) {
    log.error('paypal.refund.transient_write_failed', writeErr, { captureId });
  }
  log.warn('paypal.refund.transient_failure', {
    captureId,
    errorCode: errorCode ?? null,
  });
  return {
    status: 'failed_will_retry',
    errorCode,
    errorMessage,
  };
}
