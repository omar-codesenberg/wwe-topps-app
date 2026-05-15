"use strict";
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
exports.pendingRefundsRetry = void 0;
exports._pendingRefundsRetryImpl = _pendingRefundsRetryImpl;
const functions = __importStar(require("firebase-functions"));
const uuid_1 = require("uuid");
const admin_1 = require("../utils/admin");
const logger = __importStar(require("../utils/logger"));
const config_1 = require("./config");
// `defineSecret(...)` references carry their resource id as `.name`. v1
// `runWith({ secrets: [...] })` accepts string resource ids, mirroring the
// pattern in `createOrder.ts` / `webhook.ts`.
const PAYPAL_SECRET_NAMES = [
    config_1.PAYPAL_CLIENT_ID.name,
    config_1.PAYPAL_CLIENT_SECRET.name,
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
function getRefundCapture() {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('./refund');
    return mod.refundCapture;
}
// ---------------------------------------------------------------------------
// Core handler — exported for tests.
// ---------------------------------------------------------------------------
async function _pendingRefundsRetryImpl() {
    var _a;
    // 1) [C22] Circuit-breaker pre-check.
    const haltedRef = admin_1.db.collection('systemState').doc('refundQueueHalted');
    const haltedSnap = await haltedRef.get();
    if (haltedSnap.exists) {
        logger.warn('pendingRefunds_retry_skipped_halted', {});
        return;
    }
    // 2) Pull a batch of failed_will_retry docs ordered by lastAttemptAt asc.
    let batchSnap;
    try {
        batchSnap = await admin_1.db
            .collection('pendingRefunds')
            .where('status', '==', 'failed_will_retry')
            .orderBy('lastAttemptAt', 'asc')
            .limit(MAX_BATCH)
            .get();
    }
    catch (queryErr) {
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
        const data = doc.data();
        const captureId = (_a = data === null || data === void 0 ? void 0 : data.captureId) !== null && _a !== void 0 ? _a : doc.id;
        const attemptCount = typeof (data === null || data === void 0 ? void 0 : data.attemptCount) === 'number' ? data.attemptCount : 0;
        const reason = typeof (data === null || data === void 0 ? void 0 : data.reason) === 'string' ? data.reason : 'retry';
        if (attemptCount >= MAX_ATTEMPTS) {
            // Move to alert_required so on-call sees it and the retry pump stops
            // hammering. We update directly because refundCapture would otherwise
            // bump attemptCount further on each call.
            try {
                await doc.ref.update({
                    status: 'alert_required',
                    alertReason: 'max_attempts_exceeded',
                    lastAttemptAt: admin_1.FieldValue.serverTimestamp(),
                });
                logger.error('pendingRefunds_retry_max_attempts', null, {
                    captureId,
                    attemptCount,
                });
            }
            catch (updateErr) {
                logger.error('pendingRefunds_retry_max_attempts_write_failed', updateErr, {
                    captureId,
                });
            }
            continue;
        }
        const correlationId = (0, uuid_1.v4)();
        try {
            await refundCapture(captureId, reason, correlationId);
        }
        catch (refundErr) {
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
async function maybeTripCircuitBreaker() {
    var _a;
    const since = new Date(Date.now() - CIRCUIT_BREAKER_WINDOW_MS);
    let recentSnap;
    try {
        recentSnap = await admin_1.db
            .collection('pendingRefunds')
            .where('status', '==', 'alert_required')
            .where('lastAttemptAt', '>', admin_1.Timestamp.fromDate(since))
            .get();
    }
    catch (queryErr) {
        logger.error('pendingRefunds_breaker_query_failed', queryErr);
        return;
    }
    if (recentSnap.empty)
        return;
    const counts = new Map();
    for (const doc of recentSnap.docs) {
        const data = doc.data();
        const code = typeof (data === null || data === void 0 ? void 0 : data.errorCode) === 'string' ? data.errorCode : '';
        if (!code)
            continue;
        counts.set(code, ((_a = counts.get(code)) !== null && _a !== void 0 ? _a : 0) + 1);
    }
    for (const [code, count] of counts.entries()) {
        if (count >= CIRCUIT_BREAKER_THRESHOLD) {
            try {
                await admin_1.db.collection('systemState').doc('refundQueueHalted').set({
                    reason: 'permanent_refund_burst',
                    code,
                    count,
                    haltedAt: admin_1.FieldValue.serverTimestamp(),
                });
            }
            catch (writeErr) {
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
exports.pendingRefundsRetry = functions
    .runWith({
    secrets: PAYPAL_SECRET_NAMES,
})
    .pubsub.schedule('every 15 minutes')
    .onRun(async () => {
    await _pendingRefundsRetryImpl();
    return null;
});
//# sourceMappingURL=pendingRefundsRetry.js.map