import * as functions from 'firebase-functions';
import { db } from '../utils/admin';
import { request } from './client';
import * as logger from '../utils/logger';
import { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET } from './config';

// `defineSecret(...)` references carry their resource id as `.name`. v1
// `runWith({ secrets: [...] })` validates each entry as a string resource id,
// so we surface the names from the config module rather than the raw
// SecretParam objects (which would fail v1's regex check).
const PAYPAL_SECRET_NAMES: string[] = [
  (PAYPAL_CLIENT_ID as unknown as { name: string }).name,
  (PAYPAL_CLIENT_SECRET as unknown as { name: string }).name,
];

/**
 * v1 callable: read-only PayPal order status.
 *
 * Implements:
 *   [C9]  Authorization: the Firestore `paypalOrders/{orderId}` doc MUST belong
 *         to the calling user. Cross-user probes throw `permission-denied`
 *         BEFORE any PayPal call is made.
 *   [S6]  Deep-link recovery: the mobile app calls this after a PayPal
 *         deep-link return to disambiguate "captured / approved-but-not-captured
 *         / user-voided / browser-dismissed" states without trusting the
 *         deep-link payload alone.
 *   [S8]  Allow-list projection on the PayPal response — only `id`, `status`,
 *         `intent` survive into the function body.
 *
 * Returns `{ orderId, status, paypalStatus, voided }` where:
 *   - `status` is the Firestore `paypalOrders.status`
 *     ('created' | 'captured' | 'voided_by_user' | 'denied').
 *   - `paypalStatus` is PayPal's status (CREATED, APPROVED, COMPLETED,
 *     VOIDED, PAYER_ACTION_REQUIRED, ...).
 *   - `voided` is true when EITHER PayPal reports VOIDED OR the user has
 *     locally cancelled (`status === 'voided_by_user'`).
 */

interface PayPalOrderProjection {
  id: string;
  status: string;
  intent: string;
}

export interface OrderStatusResult {
  orderId: string;
  status: string;
  paypalStatus: string;
  voided: boolean;
}

export const getPayPalOrderStatus = functions
  .runWith({ secrets: PAYPAL_SECRET_NAMES })
  .https.onCall(async (data, context): Promise<OrderStatusResult> => {
    if (!context.auth) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'Must be authenticated',
      );
    }

    const orderId =
      data && typeof data === 'object' && typeof (data as { orderId?: unknown }).orderId === 'string'
        ? (data as { orderId: string }).orderId
        : '';
    if (!orderId) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'orderId required',
      );
    }

    const uid = context.auth.uid;
    const correlationId = `getOrderStatus:${orderId}`;
    const log = logger.withCorrelationId(correlationId);

    // ---- Firestore lookup ---------------------------------------------------
    const orderRef = db.collection('paypalOrders').doc(orderId);
    let orderSnap;
    try {
      orderSnap = await orderRef.get();
    } catch (err) {
      log.error('paypal.getOrderStatus.read_failed', err, { orderId });
      throw new functions.https.HttpsError('internal', 'Failed to read order');
    }

    if (!orderSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Order not found');
    }

    const orderDoc = orderSnap.data() ?? {};

    // [C9] Cross-user probe defense — assert ownership BEFORE the PayPal call.
    if (orderDoc.userId !== uid) {
      log.warn('paypal.getOrderStatus.cross_user_probe', {
        orderId,
        callerUid: uid,
      });
      throw new functions.https.HttpsError(
        'permission-denied',
        'Order does not belong to caller',
      );
    }

    const firestoreStatus =
      typeof orderDoc.status === 'string' ? orderDoc.status : '';

    // ---- PayPal read --------------------------------------------------------
    let projected: PayPalOrderProjection;
    try {
      projected = await request<PayPalOrderProjection>(
        'GET',
        `/v2/checkout/orders/${orderId}`,
        undefined,
        {
          // [S8] Allow-list projection — drop `links`, `payer`, `purchase_units`.
          project: (resp: unknown): PayPalOrderProjection => {
            const r = (resp ?? {}) as {
              id?: unknown;
              status?: unknown;
              intent?: unknown;
            };
            return {
              id: typeof r.id === 'string' ? r.id : '',
              status: typeof r.status === 'string' ? r.status : '',
              intent: typeof r.intent === 'string' ? r.intent : '',
            };
          },
          correlationId,
        },
      );
    } catch (err) {
      log.error('paypal.getOrderStatus.paypal_call_failed', err, { orderId });
      throw new functions.https.HttpsError(
        'internal',
        'Failed to fetch order status from PayPal',
      );
    }

    const paypalStatus = projected.status;
    const voided =
      paypalStatus === 'VOIDED' || firestoreStatus === 'voided_by_user';

    return {
      orderId,
      status: firestoreStatus,
      paypalStatus,
      voided,
    };
  });
