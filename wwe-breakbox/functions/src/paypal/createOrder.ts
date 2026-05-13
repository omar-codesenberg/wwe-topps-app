/**
 * createPayPalOrder — v1 callable that creates a PayPal Orders v2 order for a
 * locked slot.
 *
 * Implements (per integration plan §3 / change-log):
 *   [C2]  Server-authoritative pricing. The amount sent to PayPal is derived
 *         from `slot.priceCents` in Firestore — never from `data` on the
 *         callable. Any client-supplied `price`/`amount` field is ignored.
 *   [C6]  Bounded cumulative lock extension. The first createPayPalOrder call
 *         for a (uid, slotId) lock window extends `lockedUntil` to
 *         `min(now + 5min, originalLockedUntil + 10min)`. Subsequent calls do
 *         NOT extend further so the lock cannot be held indefinitely by
 *         repeatedly invoking createPayPalOrder.
 *   [C20] Account-level cap: a single user may have at most 5 active
 *         (`status === 'created'`) PayPal orders. The 6th attempt throws
 *         `resource-exhausted / RATE_LIMITED`.
 *   [S1]  Stored `expectedAmount` on `paypalOrders/{orderId}` is the EXACT
 *         decimal string we sent to PayPal so the capture-side amount audit
 *         can do byte-for-byte string equality (no float reformatting drift).
 *   [S2]  Per-(uid, slotId) cap of 1 active order. If a `paypalOrders` doc
 *         already exists for this user/slot in `created` state, return its
 *         id/approveUrl and `alreadyOpen: true` instead of creating a second
 *         PayPal order.
 *   [S17] `custom_id` length cap: PayPal rejects values > 127 chars. We assert
 *         locally before issuing the call so a misconfigured ID surfaces a
 *         deterministic HttpsError instead of a sanitized PayPal 4xx.
 *   [S19] Best-effort bump of a global counter at
 *         `systemState/orderCreationRate` (`count`) so a Wave-5 alert can fire
 *         on abnormal create rates. A failed bump must not fail the call.
 */

import * as functions from 'firebase-functions';
import { v4 as uuidv4 } from 'uuid';
import { db, FieldValue, Timestamp } from '../utils/admin';
import {
  PAYPAL_CLIENT_ID,
  PAYPAL_CLIENT_SECRET,
  PAYPAL_WEBHOOK_ID,
} from './config';
import * as logger from '../utils/logger';

// `defineSecret(...)` references carry their resource id as `.name`. v1
// `runWith({ secrets: [...] })` accepts string resource ids, so we surface the
// names from the config module rather than hard-coding them. This keeps the
// per-environment secret naming centralised in `paypal/config.ts`.
const PAYPAL_SECRET_NAMES: string[] = [
  (PAYPAL_CLIENT_ID as unknown as { name: string }).name,
  (PAYPAL_CLIENT_SECRET as unknown as { name: string }).name,
  (PAYPAL_WEBHOOK_ID as unknown as { name: string }).name,
];
// Lazy-resolved at call-time so this module type-checks even if `./client`
// were not yet present, and so jest.mock('./client', ...) in tests can
// transparently intercept.
import type { request as RequestFn } from './client';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACTIVE_ORDER_STATUS = 'created';
const PER_USER_ACTIVE_ORDER_CAP = 5; // [C20]
const CUSTOM_ID_MAX_LEN = 127; // [S17]
const LOCK_EXTENSION_FROM_NOW_MS = 5 * 60 * 1000; // 5 min from now
const LOCK_EXTENSION_FROM_ORIGINAL_MS = 10 * 60 * 1000; // 10 min from original lock

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PayPalOrderResponseProjection {
  id: string;
  status: string;
  links: Array<{ rel?: string; href?: string; method?: string }>;
}

interface CreateOrderRequestData {
  eventId?: unknown;
  slotId?: unknown;
}

interface CreateOrderResponse {
  orderId: string;
  approveUrl: string;
  correlationId: string;
  alreadyOpen?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getRequest(): typeof RequestFn {
  // Deferred require so jest.mock('../paypal/client', ...) transparently works
  // and so the dependency edge here is identical to the refund.ts pattern.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('./client') as { request: typeof RequestFn };
  return mod.request;
}

/** Extract the APPROVE link href from a PayPal Orders response. */
function extractApproveUrl(
  links: Array<{ rel?: string; href?: string }> | undefined,
): string {
  if (!Array.isArray(links)) return '';
  for (const link of links) {
    if (link && link.rel === 'approve' && typeof link.href === 'string') {
      return link.href;
    }
  }
  return '';
}

/** Format an integer cent amount as a PayPal CAD value string ("12.34"). */
function formatAmount(priceCents: number): string {
  // Keep arithmetic in integer space to avoid float drift on values like 1010.
  const dollars = Math.trunc(priceCents / 100);
  const cents = priceCents - dollars * 100;
  const centsStr = cents < 10 ? `0${cents}` : `${cents}`;
  return `${dollars}.${centsStr}`;
}

// ---------------------------------------------------------------------------
// Core handler — exported separately from the v1 wrapper so tests can drive
// it without spinning up the firebase-functions HTTPS shim.
// ---------------------------------------------------------------------------

export async function _createPayPalOrderImpl(
  data: CreateOrderRequestData,
  context: { auth?: { uid: string } | null },
): Promise<CreateOrderResponse> {
  // 1) Auth gate (matches lockSlot pattern).
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'Must be authenticated',
    );
  }
  const uid = context.auth.uid;

  // Argument validation — be strict about types so the rest of the handler
  // can use plain string concatenation safely.
  const eventId = typeof data?.eventId === 'string' ? data.eventId : '';
  const slotId = typeof data?.slotId === 'string' ? data.slotId : '';
  if (!eventId || !slotId) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'eventId and slotId required',
    );
  }

  // [S17] custom_id length assertion — assert BEFORE any I/O so a
  // misconfigured ID surfaces deterministically and we don't waste a PayPal
  // request id slot.
  const customId = `${eventId}:${slotId}:${uid}`;
  if (customId.length > CUSTOM_ID_MAX_LEN) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `custom_id exceeds ${CUSTOM_ID_MAX_LEN} chars`,
    );
  }

  const slotRef = db
    .collection('events')
    .doc(eventId)
    .collection('slots')
    .doc(slotId);
  const paypalOrdersCol = db.collection('paypalOrders');

  // 2) Lock-ownership check.
  const slotSnap = await slotRef.get();
  if (!slotSnap.exists) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Slot not found',
    );
  }
  const slot = slotSnap.data() as {
    lockedBy?: string | null;
    lockedUntil?: { toMillis?: () => number; toDate?: () => Date } | null;
    priceCents?: number;
  };

  if (slot.lockedBy !== uid) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Slot is not locked by caller',
    );
  }

  const lockedUntilMillis =
    typeof slot.lockedUntil?.toMillis === 'function'
      ? slot.lockedUntil.toMillis()
      : slot.lockedUntil?.toDate?.().getTime() ?? 0;
  const now = Date.now();
  if (!lockedUntilMillis || lockedUntilMillis <= now) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Slot lock has expired',
    );
  }

  // 6) Validate priceCents.
  const priceCents = slot.priceCents;
  if (
    typeof priceCents !== 'number' ||
    !Number.isInteger(priceCents) ||
    priceCents <= 0
  ) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Slot priceCents missing or invalid',
    );
  }
  const amountValue = formatAmount(priceCents);

  // 3) [S2] Per-(uid, slotId) cap of 1 active order.
  const existingForSlotSnap = await paypalOrdersCol
    .where('userId', '==', uid)
    .where('slotId', '==', slotId)
    .where('status', '==', ACTIVE_ORDER_STATUS)
    .limit(1)
    .get();
  if (!existingForSlotSnap.empty) {
    const existingDoc = existingForSlotSnap.docs[0];
    const existing = existingDoc.data() as {
      orderId?: string;
      approveUrl?: string;
      correlationId?: string;
    };
    return {
      orderId: existing.orderId ?? existingDoc.id,
      approveUrl: existing.approveUrl ?? '',
      correlationId: existing.correlationId ?? '',
      alreadyOpen: true,
    };
  }

  // 4) [C20] Account-level active-order cap.
  const accountActiveSnap = await paypalOrdersCol
    .where('userId', '==', uid)
    .where('status', '==', ACTIVE_ORDER_STATUS)
    .get();
  if (accountActiveSnap.size >= PER_USER_ACTIVE_ORDER_CAP) {
    throw new functions.https.HttpsError(
      'resource-exhausted',
      'RATE_LIMITED',
    );
  }

  // 8) [C6] Lock extension if this is the FIRST createOrder call for this
  // (uid, slotId) lock window. We detect "first" by checking whether ANY
  // paypalOrders doc already exists for (uid, slotId), regardless of status.
  // (The S2 query above only checks `status === 'created'`; a previously
  // failed/cancelled order should still count as "not the first" so we don't
  // re-extend the lock for a user who has been bouncing in and out.)
  const anyPriorForSlotSnap = await paypalOrdersCol
    .where('userId', '==', uid)
    .where('slotId', '==', slotId)
    .limit(1)
    .get();
  const isFirstCreateForLock = anyPriorForSlotSnap.empty;

  if (isFirstCreateForLock) {
    const fromNow = now + LOCK_EXTENSION_FROM_NOW_MS;
    const fromOriginal = lockedUntilMillis + LOCK_EXTENSION_FROM_ORIGINAL_MS;
    const newLockedUntilMs = Math.min(fromNow, fromOriginal);
    // Only push the lock OUT, never in.
    if (newLockedUntilMs > lockedUntilMillis) {
      try {
        await slotRef.update({
          lockedUntil: Timestamp.fromDate(new Date(newLockedUntilMs)),
        });
      } catch (err) {
        // A failed extension must not block order creation — the original
        // lock is still valid for `lockedUntilMillis - now` ms.
        logger.warn('paypal.createOrder.lock_extension_failed', {
          eventId,
          slotId,
          uid,
        });
      }
    }
  }

  // 5) [S19] Best-effort bump of the global creation-rate counter.
  try {
    await db
      .collection('systemState')
      .doc('orderCreationRate')
      .set({ count: FieldValue.increment(1) }, { merge: true });
  } catch (err) {
    logger.warn('paypal.createOrder.rate_counter_bump_failed', {
      eventId,
      slotId,
      uid,
    });
  }

  // 9) Generate correlationId.
  const correlationId = uuidv4();
  const log = logger.withCorrelationId(correlationId);

  // 10) Call PayPal POST /v2/checkout/orders.
  const requestId = `${slotId}:${uid}:${lockedUntilMillis}`;
  const orderBody = {
    intent: 'CAPTURE' as const,
    purchase_units: [
      {
        custom_id: customId,
        amount: {
          currency_code: 'CAD',
          value: amountValue,
        },
      },
    ],
    application_context: {
      return_url: 'wwebreakbox://paypal/return',
      cancel_url: 'wwebreakbox://paypal/cancel',
      brand_name: 'WWE Breakbox',
      user_action: 'PAY_NOW',
      shipping_preference: 'NO_SHIPPING',
    },
  };

  let paypalResp: PayPalOrderResponseProjection;
  try {
    const request = getRequest();
    paypalResp = await request<PayPalOrderResponseProjection>(
      'POST',
      '/v2/checkout/orders',
      orderBody,
      {
        requestId,
        correlationId,
        project: (r: unknown) => {
          const resp = r as Partial<PayPalOrderResponseProjection>;
          return {
            id: typeof resp.id === 'string' ? resp.id : '',
            status: typeof resp.status === 'string' ? resp.status : '',
            links: Array.isArray(resp.links) ? resp.links : [],
          };
        },
      },
    );
  } catch (err) {
    log.error('paypal.createOrder.paypal_call_failed', err, {
      eventId,
      slotId,
    });
    throw new functions.https.HttpsError('internal', 'PayPal order creation failed');
  }

  if (!paypalResp.id) {
    log.error('paypal.createOrder.missing_order_id', undefined, {
      eventId,
      slotId,
    });
    throw new functions.https.HttpsError(
      'internal',
      'PayPal returned no order id',
    );
  }

  const approveUrl = extractApproveUrl(paypalResp.links);

  // 11) Persist the order doc.
  try {
    await db
      .collection('paypalOrders')
      .doc(paypalResp.id)
      .set({
        orderId: paypalResp.id,
        userId: uid,
        eventId,
        slotId,
        status: ACTIVE_ORDER_STATUS,
        createdAt: FieldValue.serverTimestamp(),
        // [S1] EXACT string sent to PayPal — capture-side audit string-compares.
        expectedAmount: amountValue,
        currency: 'CAD',
        correlationId,
        approveUrl,
      });
  } catch (err) {
    log.error('paypal.createOrder.persist_failed', err, {
      eventId,
      slotId,
      orderId: paypalResp.id,
    });
    throw new functions.https.HttpsError(
      'internal',
      'Failed to persist PayPal order',
    );
  }

  log.info('paypal.createOrder.created', {
    eventId,
    slotId,
    orderId: paypalResp.id,
  });

  return {
    orderId: paypalResp.id,
    approveUrl,
    correlationId,
  };
}

// ---------------------------------------------------------------------------
// v1 callable wrapper.
//
// Per integration plan: the codebase stays on v1 callables, but secret
// resolution still goes through `defineSecret(...).value()` from
// firebase-functions/params (a v2 API). v1 `runWith({ secrets: [...] })`
// accepts the same `defineSecret` references so the secret is materialised
// at request time on either runtime.
// ---------------------------------------------------------------------------

export const createPayPalOrder = functions
  .runWith({
    minInstances: 0,
    secrets: PAYPAL_SECRET_NAMES,
  })
  .https.onCall((data, context) =>
    _createPayPalOrderImpl(data as CreateOrderRequestData, context),
  );
