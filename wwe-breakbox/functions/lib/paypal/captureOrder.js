"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.capturePayPalOrder = void 0;
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
const functions = __importStar(require("firebase-functions"));
const admin_1 = require("../utils/admin");
const client_1 = require("./client");
const refund_1 = require("./refund");
const finalizeSlotPurchase_1 = require("../purchases/finalizeSlotPurchase");
const logger = __importStar(require("../utils/logger"));
const config_1 = require("./config");
// ---------------------------------------------------------------------------
// Projector for the capture HTTP response.
// ---------------------------------------------------------------------------
function projectCapture(resp) {
    const r = (resp !== null && resp !== void 0 ? resp : {});
    const id = typeof r.id === 'string' ? r.id : '';
    const status = typeof r.status === 'string' ? r.status : '';
    const rawUnits = Array.isArray(r.purchase_units) ? r.purchase_units : [];
    const purchase_units = rawUnits.map((u) => {
        var _a;
        const unit = (u !== null && u !== void 0 ? u : {});
        const payments = ((_a = unit.payments) !== null && _a !== void 0 ? _a : {});
        const rawCaps = Array.isArray(payments.captures) ? payments.captures : [];
        const captures = rawCaps.map((c) => {
            var _a;
            const cap = (c !== null && c !== void 0 ? c : {});
            const amt = ((_a = cap.amount) !== null && _a !== void 0 ? _a : {});
            return {
                id: typeof cap.id === 'string' ? cap.id : '',
                status: typeof cap.status === 'string' ? cap.status : '',
                amount: {
                    value: typeof amt.value === 'string' ? amt.value : '',
                    currency_code: typeof amt.currency_code === 'string' ? amt.currency_code : '',
                },
                custom_id: typeof cap.custom_id === 'string' ? cap.custom_id : undefined,
            };
        });
        return { payments: { captures } };
    });
    return { id, status, purchase_units };
}
// ---------------------------------------------------------------------------
// Callable — v1 onCall with secrets bound (no webhook id needed here).
// ---------------------------------------------------------------------------
exports.capturePayPalOrder = functions
    .runWith({
    minInstances: 0,
    secrets: [config_1.PAYPAL_CLIENT_ID, config_1.PAYPAL_CLIENT_SECRET],
})
    .https.onCall(async (data, context) => {
    var _a, _b, _c, _d;
    // ---- Auth ------------------------------------------------------------
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be authenticated');
    }
    const uid = context.auth.uid;
    const orderId = typeof (data === null || data === void 0 ? void 0 : data.orderId) === 'string' ? data.orderId : '';
    if (!orderId) {
        throw new functions.https.HttpsError('invalid-argument', 'orderId is required');
    }
    // ---- Load the order doc ---------------------------------------------
    const orderRef = admin_1.db.collection('paypalOrders').doc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'Order not found');
    }
    const order = orderSnap.data();
    if (!order) {
        throw new functions.https.HttpsError('not-found', 'Order not found');
    }
    // ---- [C9] Authorization check ---------------------------------------
    if (order.userId !== uid) {
        throw new functions.https.HttpsError('permission-denied', 'You do not own this order');
    }
    const correlationId = order.correlationId;
    const log = logger.withCorrelationId(correlationId);
    // ---- Status gating ---------------------------------------------------
    if (order.status === 'voided_by_user') {
        throw new functions.https.HttpsError('failed-precondition', 'Order has been voided', { code: 'ORDER_VOIDED' });
    }
    if (order.status === 'captured') {
        // Capture already happened on a prior call; surface the existing
        // purchase doc rather than re-calling PayPal.
        // The purchase doc id == captureId; we don't have captureId on the
        // order doc directly so we look it up via the
        // `paypalOrders.captureId` field if present, else search.
        const orderData = order;
        if (orderData.captureId) {
            return { success: true, purchaseId: orderData.captureId };
        }
        // Fall back: no captureId persisted (shouldn't happen, but degrade
        // gracefully) — return success without a purchaseId.
        return { success: true };
    }
    // ---- PayPal capture call --------------------------------------------
    let response;
    try {
        response = await (0, client_1.request)('POST', `/v2/checkout/orders/${orderId}/capture`, {}, {
            requestId: `capture:${orderId}`,
            project: projectCapture,
            correlationId,
        });
    }
    catch (err) {
        // SanitizedError from client.ts. Surface as internal — callers can
        // safely retry: the deterministic request-id makes PayPal idempotent.
        const sErr = err;
        log.error('paypal_capture_failed', sErr, { orderId });
        throw new functions.https.HttpsError('internal', sErr.message || 'PayPal capture failed');
    }
    const cap = (_d = (_c = (_b = (_a = response.purchase_units[0]) === null || _a === void 0 ? void 0 : _a.payments) === null || _b === void 0 ? void 0 : _b.captures) === null || _c === void 0 ? void 0 : _c[0]) !== null && _d !== void 0 ? _d : undefined;
    if (!cap || !cap.id) {
        log.error('paypal_capture_missing_capture', null, {
            orderId,
            responseId: response.id,
        });
        throw new functions.https.HttpsError('internal', 'PayPal capture response missing capture id');
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
            await (0, refund_1.refundCapture)(cap.id, 'amount_mismatch', correlationId);
        }
        catch (refundErr) {
            log.error('paypal_amount_mismatch_refund_failed', refundErr, {
                captureId: cap.id,
            });
        }
        throw new functions.https.HttpsError('failed-precondition', 'Captured amount or currency does not match the order', { code: 'AMOUNT_MISMATCH' });
    }
    // ---- [S10] Finalize via decision-lock transaction --------------------
    // Convert "10.10" → 1010 cents via Math.round on parseFloat * 100. We
    // already know the string equals expectedAmount, so either source is
    // fine — use expectedAmount for clarity.
    const amountCents = Math.round(parseFloat(order.expectedAmount) * 100);
    let finalizeResult;
    try {
        finalizeResult = await admin_1.db.runTransaction((tx) => (0, finalizeSlotPurchase_1.finalize)(tx, {
            captureId: cap.id,
            orderId,
            eventId: order.eventId,
            slotId: order.slotId,
            userId: uid,
            amountCents,
            correlationId,
            paypalEnv: config_1.PAYPAL_ENV,
        }));
    }
    catch (txErr) {
        log.error('paypal_finalize_transaction_failed', txErr, {
            orderId,
            captureId: cap.id,
        });
        // Money has been captured but our finalize failed for an unknown
        // reason. Throw internal — operator pages on this; do NOT auto-refund
        // because the next call will hit `purchases/{captureId}` (if it
        // somehow committed) or the slot is still locked for retry.
        throw new functions.https.HttpsError('internal', 'Failed to finalize purchase');
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
                    capturedAt: admin_1.FieldValue.serverTimestamp(),
                });
            }
            catch (updErr) {
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
            const refundStatus = await (0, refund_1.refundCapture)(cap.id, 'slot_sold_to_other', correlationId);
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
            const refundStatus = await (0, refund_1.refundCapture)(cap.id, 'lock_expired', correlationId);
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
                status: finalizeResult.status,
            });
            throw new functions.https.HttpsError('internal', 'Unknown finalize status');
        }
    }
});
//# sourceMappingURL=captureOrder.js.map