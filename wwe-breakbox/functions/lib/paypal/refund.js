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
exports.PERMANENT_REFUND_ERROR_CODES = void 0;
exports._classifyError = _classifyError;
exports.refundCapture = refundCapture;
const admin_1 = require("../utils/admin");
const logger = __importStar(require("../utils/logger"));
/** [C22] Permanent failure codes — never auto-retried; on-call paged instead. */
exports.PERMANENT_REFUND_ERROR_CODES = new Set([
    'INSUFFICIENT_FUNDS',
    'INSTRUMENT_DECLINED',
    'REFUND_NOT_ALLOWED',
    'TRANSACTION_REFUSED',
    'CAPTURE_FULLY_REFUNDED',
]);
function asErr(err) {
    if (err && typeof err === 'object') {
        return err;
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
function _classifyError(err) {
    const code = asErr(err).paypalCode;
    if (code && exports.PERMANENT_REFUND_ERROR_CODES.has(code)) {
        return 'permanent';
    }
    return 'transient';
}
function getRequest() {
    // Deferred require so this module type-checks even before P4's client.ts
    // lands. Tests `jest.mock('./client', ...)` will short-circuit this.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('./client');
    return mod.request;
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
async function refundCapture(captureId, reason, correlationId) {
    const log = logger.withCorrelationId(correlationId);
    const pendingRef = admin_1.db.collection('pendingRefunds').doc(captureId);
    const purchaseRef = admin_1.db.collection('purchases').doc(captureId);
    // ------ [S10] Decision-lock transaction ----------------------------------
    let lockResult;
    try {
        lockResult = await admin_1.db.runTransaction(async (txn) => {
            const [pendingSnap, purchaseSnap] = await Promise.all([
                txn.get(pendingRef),
                txn.get(purchaseRef),
            ]);
            const existing = pendingSnap.exists
                ? pendingSnap.data()
                : undefined;
            // Already-completed refund — fully idempotent return.
            if (existing && existing.status === 'completed') {
                return {
                    proceed: false,
                    shortCircuit: {
                        status: 'already_completed',
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
                    shortCircuit: { status: 'failed_will_retry' },
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
            const fresh = {
                status: 'requested',
                captureId,
                reason,
                correlationId,
                attemptCount: 0,
                createdAt: admin_1.FieldValue.serverTimestamp(),
            };
            txn.set(pendingRef, fresh, { merge: false });
            return { proceed: true };
        });
    }
    catch (txErr) {
        log.error('paypal.refund.lock_transaction_failed', txErr, { captureId });
        // Treat lock failures as transient so the retry scheduler picks them up.
        return {
            status: 'failed_will_retry',
            errorMessage: txErr instanceof Error ? txErr.message : 'lock transaction failed',
        };
    }
    if (!lockResult.proceed) {
        // shortCircuit is always set when proceed is false.
        return lockResult.shortCircuit;
    }
    // ------ Advance to in_flight (we are the sole progressor) ----------------
    try {
        await pendingRef.update({ status: 'in_flight' });
    }
    catch (updateErr) {
        log.error('paypal.refund.in_flight_update_failed', updateErr, { captureId });
        return {
            status: 'failed_will_retry',
            errorMessage: updateErr instanceof Error
                ? updateErr.message
                : 'in_flight update failed',
        };
    }
    log.info('paypal.refund.attempt', { captureId, reason });
    // ------ Call PayPal with [S11] deterministic request id ------------------
    let refundResp;
    try {
        const request = getRequest();
        refundResp = await request('POST', `/v2/payments/captures/${captureId}/refund`, {}, {
            requestId: `refund:${captureId}:full`,
            project: (r) => {
                var _a, _b;
                const resp = r;
                return { id: (_a = resp.id) !== null && _a !== void 0 ? _a : '', status: (_b = resp.status) !== null && _b !== void 0 ? _b : '' };
            },
            correlationId,
        });
    }
    catch (err) {
        return await handleFailure(captureId, err, log);
    }
    // ------ Success path -----------------------------------------------------
    try {
        await pendingRef.update({
            status: 'completed',
            paypalRefundId: refundResp.id,
            completedAt: admin_1.FieldValue.serverTimestamp(),
        });
    }
    catch (writeErr) {
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
async function handleFailure(captureId, err, log) {
    const e = asErr(err);
    const errorCode = e.paypalCode;
    const errorMessage = e.message;
    const pendingRef = admin_1.db.collection('pendingRefunds').doc(captureId);
    const classification = _classifyError(err);
    if (classification === 'permanent' && errorCode) {
        // [C22] Permanent — page on-call, never auto-retry.
        try {
            await pendingRef.update({
                status: 'alert_required',
                errorCode,
                errorMessage: errorMessage !== null && errorMessage !== void 0 ? errorMessage : null,
                attemptCount: 1,
                lastAttemptAt: admin_1.FieldValue.serverTimestamp(),
            });
        }
        catch (writeErr) {
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
            errorCode: errorCode !== null && errorCode !== void 0 ? errorCode : null,
            errorMessage: errorMessage !== null && errorMessage !== void 0 ? errorMessage : null,
            attemptCount: admin_1.FieldValue.increment(1),
            lastAttemptAt: admin_1.FieldValue.serverTimestamp(),
        });
    }
    catch (writeErr) {
        log.error('paypal.refund.transient_write_failed', writeErr, { captureId });
    }
    log.warn('paypal.refund.transient_failure', {
        captureId,
        errorCode: errorCode !== null && errorCode !== void 0 ? errorCode : null,
    });
    return {
        status: 'failed_will_retry',
        errorCode,
        errorMessage,
    };
}
//# sourceMappingURL=refund.js.map