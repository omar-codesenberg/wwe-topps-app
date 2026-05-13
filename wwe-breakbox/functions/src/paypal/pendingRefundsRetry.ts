/**
 * pendingRefundsRetry — scheduled (every 15 min) refund retry pump.
 *
 * Implements (per integration plan §22, §26 + change-log):
 *   [C12] Bounded automatic retry of `pendingRefunds` documents stuck in
 *         `failed_will_retry`. After 5 attempts the doc is left for on-call.
 *   [C22] Circuit breaker. (a) BEFORE the run, if
 *         `systemState/refundQueueHalted` exists, the run is skipped. (b)
 *         AFTER the run, if the same permanent `errorCode` has tripped
 *         `alert_required` ≥ 3 times in the past hour, the breaker is set so
 *         subsequent runs no-op until a human resets it.
 *   [S12] Each retry attempt threads its own correlationId so the log lines
 *         from one attempt are joinable.
 */

import * as functions from 'firebase-functions';
import { v4 as uuidv4 } from 'uuid';
import { db, FieldValue, Timestamp } from '../utils/admin';
// `refundCapture` is loaded lazily so jest.mock('./refund', ...) in tests
// transparently intercepts.
import type { refundCapture as RefundCaptureFn } from './refund';
import * as logger from '../utils/logger';
import {
  PAYPAL_CLIENT_ID,
  PAYPAL_CLIENT_SECRET,
} from './config';

// `defineSecret(...)` references carry their resource id as `.name`. v1
// `runWith({ secrets: [...] })` accepts string resource ids, mirroring the
// pattern in `createOrder.ts` / `webhook.ts`.
const PAYPAL_SECRET_NAMES: string[] = [
  (PAYPAL_CLIENT_ID as unknown as { name: string }).name,
  (PAYPAL_CLIENT_SECRET as unknown as { name: string }).name,
];

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_BATCH = 50;
const MAX_ATTEMPTS = 5; // [C12]
const CIRCUIT_BREAKER_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const CIRCUIT_BREAKER_THRESHOLD = 3; // [C22]

// ---------------------------------------------------------------------------
// Lazy refund resolution.
// ---------------------------------------------------------------------------

function getRefundCapture(): typeof RefundCaptureFn {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('./refund') as { refundCapture: typeof RefundCaptureFn };
  return mod.refundCapture;
}

// ---------------------------------------------------------------------------
// Pending-refund doc projection.
// ---------------------------------------------------------------------------

interface PendingRefundDocProjection {
  status?: string;
  captureId?: string;
  reason?: string;
  attemptCount?: number;
  errorCode?: string | null;
  lastAttemptAt?: { toDate?: () => Date } | null;
}

// ---------------------------------------------------------------------------
// Core handler — exported for tests.
// ---------------------------------------------------------------------------

export async function _pendingRefundsRetryImpl(): Promise<void> {
  // 1) [C22] Circuit-breaker pre-check.
  const haltedRef = db.collection('systemState').doc('refundQueueHalted');
  const haltedSnap = await haltedRef.get();
  if (haltedSnap.exists) {
    logger.warn('pendingRefunds_retry_skipped_halted', {});
    return;
  }

  // 2) Pull a batch of failed_will_retry docs ordered by lastAttemptAt asc.
  let batchSnap;
  try {
    batchSnap = await db
      .collection('pendingRefunds')
      .where('status', '==', 'failed_will_retry')
      .orderBy('lastAttemptAt', 'asc')
      .limit(MAX_BATCH)
      .get();
  } catch (queryErr) {
    logger.error('pendingRefunds_retry_query_failed', queryErr);
    return;
  }

  if (batchSnap.empty) {
    logger.info('pendingRefunds_retry_no_work', {});
    // Even with no work we still run the circuit-breaker scan so a recent
    // burst of permanent failures can trip the breaker on the next tick.
    await maybeTripCircuitBreaker();
    return;
  }

  const refundCapture = getRefundCapture();

  for (const doc of batchSnap.docs) {
    const data = doc.data() as PendingRefundDocProjection | undefined;
    const captureId = data?.captureId ?? doc.id;
    const attemptCount = typeof data?.attemptCount === 'number' ? data.attemptCount : 0;
    const reason = typeof data?.reason === 'string' ? data.reason : 'retry';

    if (attemptCount >= MAX_ATTEMPTS) {
      // Move to alert_required so on-call sees it and the retry pump stops
      // hammering. We update directly because refundCapture would otherwise
      // bump attemptCount further on each call.
      try {
        await doc.ref.update({
          status: 'alert_required',
          alertReason: 'max_attempts_exceeded',
          lastAttemptAt: FieldValue.serverTimestamp(),
        });
        logger.error('pendingRefunds_retry_max_attempts', null, {
          captureId,
          attemptCount,
        });
      } catch (updateErr) {
        logger.error('pendingRefunds_retry_max_attempts_write_failed', updateErr, {
          captureId,
        });
      }
      continue;
    }

    const correlationId = uuidv4();
    try {
      await refundCapture(captureId, reason, correlationId);
    } catch (refundErr) {
      // refundCapture is contractually non-throwing for known failure modes,
      // but defensively swallow so one bad doc doesn't kill the whole batch.
      logger.error('pendingRefunds_retry_call_failed', refundErr, {
        captureId,
        correlationId,
      });
    }
  }

  // 3) [C22] Post-run breaker scan.
  await maybeTripCircuitBreaker();
}

// ---------------------------------------------------------------------------
// Circuit breaker
// ---------------------------------------------------------------------------

async function maybeTripCircuitBreaker(): Promise<void> {
  const since = new Date(Date.now() - CIRCUIT_BREAKER_WINDOW_MS);
  let recentSnap;
  try {
    recentSnap = await db
      .collection('pendingRefunds')
      .where('status', '==', 'alert_required')
      .where('lastAttemptAt', '>', Timestamp.fromDate(since))
      .get();
  } catch (queryErr) {
    logger.error('pendingRefunds_breaker_query_failed', queryErr);
    return;
  }

  if (recentSnap.empty) return;

  const counts: Map<string, number> = new Map();
  for (const doc of recentSnap.docs) {
    const data = doc.data() as PendingRefundDocProjection | undefined;
    const code = typeof data?.errorCode === 'string' ? data.errorCode : '';
    if (!code) continue;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }

  for (const [code, count] of counts.entries()) {
    if (count >= CIRCUIT_BREAKER_THRESHOLD) {
      try {
        await db.collection('systemState').doc('refundQueueHalted').set({
          reason: 'permanent_refund_burst',
          code,
          count,
          haltedAt: FieldValue.serverTimestamp(),
        });
      } catch (writeErr) {
        logger.error('pendingRefunds_breaker_write_failed', writeErr, {
          code,
          count,
        });
        return;
      }
      // Single emit — the alerting pipeline keys off this exact event name.
      logger.error('pendingRefunds_circuit_breaker_tripped', null, {
        code,
        count,
      });
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// v1 scheduled wrapper.
// ---------------------------------------------------------------------------

export const pendingRefundsRetry = functions
  .runWith({
    secrets: PAYPAL_SECRET_NAMES,
  })
  .pubsub.schedule('every 15 minutes')
  .onRun(async () => {
    await _pendingRefundsRetryImpl();
    return null;
  });
