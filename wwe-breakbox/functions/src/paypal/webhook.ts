/**
 * paypalWebhook — public HTTPS endpoint that PayPal posts webhook events to.
 *
 * Implements (per integration plan §14–§17, §19 + change-log):
 *   [C3]  Dedupe via `webhookEvents/{transmissionId}`. The same transmissionId
 *         delivered twice (PayPal retry, function instance crash, etc.) is a
 *         no-op on the second pass — first transaction wins, second sees the
 *         doc and returns 200.
 *   [C8]  Server-side signature verification via PayPal's verifier endpoint
 *         (delegated to `verifyWebhookSignature`).
 *   [C10] PAYMENT.CAPTURE.PENDING is logged but does NOT mutate state — the
 *         flow waits for the eventual COMPLETED/DENIED follow-up.
 *   [C15] Dedupe write + finalize live in a SINGLE Firestore transaction so a
 *         partial failure cannot leave us with a finalized purchase but no
 *         dedupe marker (or vice versa).
 *   [C18] `maxInstances: 50` cap — PayPal can burst; we deliberately bound
 *         concurrency so a misbehaving event storm cannot exhaust quotas.
 *   [S3]  Three-state verifier result is mapped to HTTP: success → continue,
 *         failure → 401 (drop), verifier_unavailable → 503 (PayPal retries).
 *   [S5]  custom_id cross-check. PayPal-supplied `custom_id` is asserted to
 *         match the trusted `paypalOrders/{orderId}` record we wrote at order
 *         creation. A mismatch is treated as an attack: 400, log, no finalize.
 *   [S13] Dedupe doc carries a TTL field so Firestore TTL policy garbage-
 *         collects it after PayPal's retry window (~5 days). We use 8 days as
 *         a safety margin.
 *   [S16] correlationId threaded into every log line for this request.
 *   [S18] Pre-verifier sanity gate validates required headers + JSON body +
 *         recognised event_type BEFORE we burn a verifier call. Cheap defense
 *         against unauthenticated traffic and accidental misconfiguration.
 */

import * as functions from 'firebase-functions';
import { v4 as uuidv4 } from 'uuid';
import { db, FieldValue } from '../utils/admin';
import { verifyWebhookSignature } from './verifySignature';
import type { PayPalWebhookHeaders } from './verifySignature';
import { finalize } from '../purchases/finalizeSlotPurchase';
import type { FinalizeResult } from '../purchases/finalizeSlotPurchase';
// `refundCapture` is loaded lazily so jest.mock('./refund', ...) in tests
// transparently intercepts and we don't pay the import cost on the happy path.
import type { refundCapture as RefundCaptureFn } from './refund';
import * as logger from '../utils/logger';
import {
  PAYPAL_ENV,
  PAYPAL_CLIENT_ID,
  PAYPAL_CLIENT_SECRET,
  PAYPAL_WEBHOOK_ID,
  getResolvedConfig,
} from './config';

// `defineSecret(...)` references carry their resource id as `.name`. v1
// `runWith({ secrets: [...] })` accepts string resource ids, so we surface the
// names from the config module rather than hard-coding them. This keeps the
// per-environment secret naming centralised in `paypal/config.ts` and matches
// the pattern in `createOrder.ts`.
const PAYPAL_SECRET_NAMES: string[] = [
  (PAYPAL_CLIENT_ID as unknown as { name: string }).name,
  (PAYPAL_CLIENT_SECRET as unknown as { name: string }).name,
  (PAYPAL_WEBHOOK_ID as unknown as { name: string }).name,
];

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** [S18] Body size cap. PayPal events are small (<10 KB typical); 50 KB is generous. */
const MAX_BODY_BYTES = 50_000;

/** [S13] TTL window for the dedupe doc (8 days; PayPal retries up to ~5 days). */
const DEDUPE_TTL_MS = 8 * 24 * 60 * 60 * 1000;

/** [S18] Recognised event types — anything else is dropped at the pre-gate. */
const SUBSCRIBED_EVENT_TYPES = new Set<string>([
  'PAYMENT.CAPTURE.COMPLETED',
  'PAYMENT.CAPTURE.DENIED',
  'PAYMENT.CAPTURE.REFUNDED',
  'PAYMENT.CAPTURE.PENDING',
]);

// ---------------------------------------------------------------------------
// Lazy refund resolution (mirrors createOrder.ts pattern for testability).
// ---------------------------------------------------------------------------

function getRefundCapture(): typeof RefundCaptureFn {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('./refund') as { refundCapture: typeof RefundCaptureFn };
  return mod.refundCapture;
}

// ---------------------------------------------------------------------------
// Types — minimal projections of the PayPal event payload we trust.
// ---------------------------------------------------------------------------

interface PayPalWebhookEvent {
  id?: string;
  event_type?: string;
  resource?: {
    id?: string;
    custom_id?: string;
    amount?: { value?: string; currency_code?: string };
    supplementary_data?: { related_ids?: { order_id?: string } };
  };
}

interface PreGateOutcome {
  ok: boolean;
  status?: number;
  reason?: string;
  parsedBody?: PayPalWebhookEvent;
  headers?: PayPalWebhookHeaders;
  rawBody?: string;
}

interface PayPalOrderRecord {
  eventId?: string;
  slotId?: string;
  userId?: string;
  status?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readHeader(req: functions.https.Request, name: string): string {
  const v = req.headers[name];
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'string') return v[0];
  return '';
}

/**
 * [S18] Pre-verifier sanity gate. Cheap, deterministic checks performed BEFORE
 * any PayPal verifier call so unauthenticated/malformed traffic is dropped at
 * the door.
 */
function preVerifierGate(req: functions.https.Request): PreGateOutcome {
  // Body size cap.
  const lengthHeader = req.headers['content-length'];
  const lengthValue =
    typeof lengthHeader === 'string'
      ? parseInt(lengthHeader, 10)
      : Array.isArray(lengthHeader) && typeof lengthHeader[0] === 'string'
        ? parseInt(lengthHeader[0], 10)
        : NaN;
  if (Number.isFinite(lengthValue) && lengthValue > MAX_BODY_BYTES) {
    return { ok: false, status: 413, reason: 'body_too_large' };
  }

  const transmissionId = readHeader(req, 'paypal-transmission-id');
  const transmissionSig = readHeader(req, 'paypal-transmission-sig');
  const certUrl = readHeader(req, 'paypal-cert-url');
  const authAlgo = readHeader(req, 'paypal-auth-algo');
  const transmissionTime = readHeader(req, 'paypal-transmission-time');

  if (
    !transmissionId ||
    !transmissionSig ||
    !certUrl ||
    !authAlgo ||
    !transmissionTime
  ) {
    return { ok: false, status: 400, reason: 'missing_paypal_headers' };
  }

  // Body parse. `req.rawBody` is provided by the firebase-functions HTTP
  // wrapper as a Buffer of the original request body bytes.
  const rawBuffer: Buffer | undefined = (req as { rawBody?: Buffer }).rawBody;
  if (!rawBuffer || rawBuffer.length === 0) {
    return { ok: false, status: 400, reason: 'empty_body' };
  }

  if (rawBuffer.length > MAX_BODY_BYTES) {
    return { ok: false, status: 413, reason: 'body_too_large' };
  }

  const rawBody = rawBuffer.toString('utf-8');
  let parsed: PayPalWebhookEvent;
  try {
    parsed = JSON.parse(rawBody) as PayPalWebhookEvent;
  } catch {
    return { ok: false, status: 400, reason: 'body_not_json' };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, status: 400, reason: 'body_not_object' };
  }

  const eventType = parsed.event_type;
  if (typeof eventType !== 'string' || !SUBSCRIBED_EVENT_TYPES.has(eventType)) {
    return { ok: false, status: 400, reason: 'unrecognised_event_type' };
  }

  return {
    ok: true,
    parsedBody: parsed,
    headers: {
      transmissionId,
      transmissionSig,
      certUrl,
      authAlgo,
      transmissionTime,
    },
    rawBody,
  };
}

// ---------------------------------------------------------------------------
// Core handler — exported for tests so they can drive it without spinning up
// the firebase-functions HTTPS shim.
// ---------------------------------------------------------------------------

export async function _paypalWebhookImpl(
  req: functions.https.Request,
  res: { status: (n: number) => { send: (body?: unknown) => void } },
): Promise<void> {
  // 1) HTTP method check.
  if (req.method !== 'POST') {
    res.status(405).send({ error: 'method_not_allowed' });
    return;
  }

  // 2) [S18] Pre-verifier sanity gate.
  const gate = preVerifierGate(req);
  if (!gate.ok) {
    logger.warn('paypal_webhook_pre_gate_failed', {
      reason: gate.reason ?? 'unknown',
    });
    res.status(gate.status ?? 400).send({ error: gate.reason ?? 'invalid_request' });
    return;
  }

  const headers = gate.headers!;
  const rawBody = gate.rawBody!;
  const event = gate.parsedBody!;
  const eventType = event.event_type as string;
  const transmissionId = headers.transmissionId;

  // 3) Generate correlationId for this delivery.
  const correlationId = uuidv4();
  const log = logger.withCorrelationId(correlationId);

  log.info('paypal_webhook_received', {
    eventType,
    transmissionId,
    eventId: event.id,
  });

  // 4) [C8][S3] Verifier call.
  const { webhookId } = getResolvedConfig();
  const verifyResult = await verifyWebhookSignature(
    webhookId,
    headers,
    rawBody,
    correlationId,
  );

  if (verifyResult.state === 'failure') {
    log.error('paypal_webhook_signature_invalid', null, {
      transmissionId,
      reason: verifyResult.reason ?? null,
    });
    res.status(401).send({ error: 'signature_invalid' });
    return;
  }

  if (verifyResult.state === 'verifier_unavailable') {
    log.warn('paypal_webhook_verifier_unavailable', {
      transmissionId,
      reason: verifyResult.reason ?? null,
    });
    res.status(503).send({ error: 'verifier_unavailable' });
    return;
  }

  // ---- verifyResult.state === 'success' from here on ----------------------

  // 5) [C15] Single transaction: dedupe-write + route + (for COMPLETED) finalize.
  const webhookEventRef = db.collection('webhookEvents').doc(transmissionId);
  const ttlAtMs = Date.now() + DEDUPE_TTL_MS;
  const ttlAt = new Date(ttlAtMs);

  let postTxAction: { kind: 'refund'; captureId: string; reason: string } | null =
    null;
  let preCommitMismatch = false;

  let finalizeResult: FinalizeResult | null = null;
  let routedAs: string | null = null;

  try {
    await db.runTransaction(async (tx) => {
      // [C3] Dedupe — first write wins.
      const dedupeSnap = await tx.get(webhookEventRef);
      if (dedupeSnap.exists) {
        log.info('paypal_webhook_dedupe_hit', {
          transmissionId,
          eventType,
        });
        return;
      }

      if (eventType === 'PAYMENT.CAPTURE.COMPLETED') {
        // 6) Look up the order. Prefer related_ids.order_id, fall back to the
        //    order_id parsed from custom_id is NOT meaningful — custom_id
        //    encodes (eventId, slotId, userId), not the orderId. So we rely
        //    on supplementary_data.related_ids.order_id.
        const orderId = event.resource?.supplementary_data?.related_ids?.order_id;
        if (typeof orderId !== 'string' || orderId.length === 0) {
          log.error('paypal_webhook_missing_order_id', null, {
            transmissionId,
          });
          // Still write the dedupe doc so PayPal does not retry forever — we
          // cannot recover from a missing order id.
          tx.set(webhookEventRef, {
            transmissionId,
            eventType,
            receivedAt: FieldValue.serverTimestamp(),
            ttlAt,
            correlationId,
            error: 'missing_order_id',
          });
          return;
        }

        const orderRef = db.collection('paypalOrders').doc(orderId);
        const orderSnap = await tx.get(orderRef);
        if (!orderSnap.exists) {
          log.error('paypal_webhook_order_not_found', null, {
            transmissionId,
            orderId,
          });
          tx.set(webhookEventRef, {
            transmissionId,
            eventType,
            receivedAt: FieldValue.serverTimestamp(),
            ttlAt,
            correlationId,
            error: 'order_not_found',
          });
          return;
        }

        const order = orderSnap.data() as PayPalOrderRecord | undefined;
        const orderEventId = order?.eventId;
        const orderSlotId = order?.slotId;
        const orderUserId = order?.userId;

        if (!orderEventId || !orderSlotId || !orderUserId) {
          log.error('paypal_webhook_order_missing_fields', null, {
            transmissionId,
            orderId,
          });
          tx.set(webhookEventRef, {
            transmissionId,
            eventType,
            receivedAt: FieldValue.serverTimestamp(),
            ttlAt,
            correlationId,
            error: 'order_missing_fields',
          });
          return;
        }

        // [S5] custom_id cross-check. The PayPal-supplied custom_id MUST match
        // the trusted record we wrote at order creation. A mismatch is treated
        // as an attack: log, abort the tx, return 400.
        const expectedCustomId = `${orderEventId}:${orderSlotId}:${orderUserId}`;
        const actualCustomId = event.resource?.custom_id;
        if (actualCustomId !== expectedCustomId) {
          log.error('paypal_custom_id_mismatch', null, {
            transmissionId,
            orderId,
            expected: expectedCustomId,
            actual: actualCustomId ?? null,
          });
          preCommitMismatch = true;
          // Throw to abort the transaction without committing the dedupe doc
          // (we want to return 400 to the caller; PayPal's retry is acceptable
          // because a real mismatch is permanent and the caller will see 400).
          throw new Error('__custom_id_mismatch__');
        }

        // Capture id + amount.
        const captureId = event.resource?.id;
        if (typeof captureId !== 'string' || captureId.length === 0) {
          log.error('paypal_webhook_missing_capture_id', null, {
            transmissionId,
            orderId,
          });
          tx.set(webhookEventRef, {
            transmissionId,
            eventType,
            receivedAt: FieldValue.serverTimestamp(),
            ttlAt,
            correlationId,
            error: 'missing_capture_id',
          });
          return;
        }

        const amountValue = event.resource?.amount?.value;
        const amountFloat =
          typeof amountValue === 'string' ? parseFloat(amountValue) : NaN;
        const amountCents = Number.isFinite(amountFloat)
          ? Math.round(amountFloat * 100)
          : 0;

        // [C15] Write dedupe BEFORE finalize so on commit success both are
        // atomic. Firestore transactions buffer writes regardless of order; we
        // still write the dedupe first for readability.
        tx.set(webhookEventRef, {
          transmissionId,
          eventType,
          receivedAt: FieldValue.serverTimestamp(),
          ttlAt,
          correlationId,
        });

        finalizeResult = await finalize(tx, {
          captureId,
          orderId,
          eventId: orderEventId,
          slotId: orderSlotId,
          userId: orderUserId,
          amountCents,
          correlationId,
          paypalEnv: PAYPAL_ENV,
        });
        routedAs = 'completed';

        // If finalize cannot proceed and the slot belongs to someone else (or
        // the lock was lost), the captured payment is for a slot we cannot
        // deliver. Schedule a refund AFTER the tx commits.
        if (
          finalizeResult.status === 'already_sold_other' ||
          finalizeResult.status === 'lock_expired'
        ) {
          postTxAction = {
            kind: 'refund',
            captureId,
            reason: `webhook_finalize_${finalizeResult.status}`,
          };
        }
        return;
      }

      if (eventType === 'PAYMENT.CAPTURE.DENIED') {
        // Mark the order denied via related_ids.order_id, if present.
        tx.set(webhookEventRef, {
          transmissionId,
          eventType,
          receivedAt: FieldValue.serverTimestamp(),
          ttlAt,
          correlationId,
        });
        const orderId = event.resource?.supplementary_data?.related_ids?.order_id;
        if (typeof orderId === 'string' && orderId.length > 0) {
          tx.update(db.collection('paypalOrders').doc(orderId), {
            status: 'denied',
            deniedAt: FieldValue.serverTimestamp(),
          });
        }
        routedAs = 'denied';
        return;
      }

      if (eventType === 'PAYMENT.CAPTURE.REFUNDED') {
        tx.set(webhookEventRef, {
          transmissionId,
          eventType,
          receivedAt: FieldValue.serverTimestamp(),
          ttlAt,
          correlationId,
        });
        // Per spec: stamp `refundedAt` on `purchases/{captureId}`. The capture
        // id is on `event.resource.id` for REFUNDED events (PayPal documents
        // this field as the refund id, but `links` includes an `up` ref to the
        // original capture; we use the related_ids fallback when available).
        // Pragmatically, the most reliable identifier we have is the original
        // capture which lives on `supplementary_data.related_ids.capture_id`
        // for refund events; absent that we use `resource.id` defensively.
        const relatedCaptureId = (event.resource?.supplementary_data
          ?.related_ids as { capture_id?: string } | undefined)?.capture_id;
        const captureId =
          typeof relatedCaptureId === 'string' && relatedCaptureId.length > 0
            ? relatedCaptureId
            : event.resource?.id;
        if (typeof captureId === 'string' && captureId.length > 0) {
          tx.update(db.collection('purchases').doc(captureId), {
            refundedAt: FieldValue.serverTimestamp(),
          });
        }
        routedAs = 'refunded';
        return;
      }

      if (eventType === 'PAYMENT.CAPTURE.PENDING') {
        // [C10] Log only, no state change.
        tx.set(webhookEventRef, {
          transmissionId,
          eventType,
          receivedAt: FieldValue.serverTimestamp(),
          ttlAt,
          correlationId,
        });
        routedAs = 'pending';
        return;
      }

      // Defensive: should never hit this because the pre-gate filters.
      tx.set(webhookEventRef, {
        transmissionId,
        eventType,
        receivedAt: FieldValue.serverTimestamp(),
        ttlAt,
        correlationId,
        error: 'unrouted',
      });
    });
  } catch (txErr) {
    if (preCommitMismatch) {
      // [S5] custom_id mismatch — return 400 without committing anything.
      res.status(400).send({ error: 'custom_id_mismatch' });
      return;
    }
    log.error('paypal_webhook_tx_failed', txErr, { transmissionId });
    // Transient — let PayPal retry.
    res.status(500).send({ error: 'tx_failed' });
    return;
  }

  log.info('paypal_webhook_processed', {
    eventType,
    routedAs: routedAs ?? 'dedupe_or_unhandled',
    finalizeStatus: finalizeResult?.status ?? null,
    transmissionId,
  });

  // 7) Post-tx side effects (refund issuance) — outside the tx so a refund
  //    failure does not undo the dedupe write.
  if (postTxAction && postTxAction.kind === 'refund') {
    try {
      const refundCapture = getRefundCapture();
      await refundCapture(
        postTxAction.captureId,
        postTxAction.reason,
        correlationId,
      );
    } catch (refundErr) {
      // refundCapture is contractually non-throwing for known failures, but
      // be defensive. Log and continue — the pendingRefunds queue will pick
      // up retries.
      log.error('paypal_webhook_post_tx_refund_failed', refundErr, {
        captureId: postTxAction.captureId,
      });
    }
  }

  res.status(200).send({ ok: true });
}

// ---------------------------------------------------------------------------
// v1 HTTP wrapper.
// ---------------------------------------------------------------------------

export const paypalWebhook = functions
  .runWith({
    minInstances: 0,
    maxInstances: 50, // [C18]
    secrets: PAYPAL_SECRET_NAMES,
  })
  .https.onRequest((req, res) => _paypalWebhookImpl(req, res));
