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
exports.releaseSlotOnCancel = void 0;
const functions = __importStar(require("firebase-functions"));
const admin_1 = require("./utils/admin");
const logger = __importStar(require("./utils/logger"));
const config_1 = require("./paypal/config");
// v1 `runWith({ secrets: [...] })` accepts string resource ids; surface the
// `.name` from each defineSecret reference so the per-environment naming
// stays centralised in `paypal/config.ts`.
const PAYPAL_SECRET_NAMES = [
    config_1.PAYPAL_CLIENT_ID.name,
    config_1.PAYPAL_CLIENT_SECRET.name,
];
function getRequest() {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('./paypal/client');
    return mod.request;
}
/**
 * Mark a single `paypalOrders` doc as voided_by_user (Firestore) and best-effort
 * void it on PayPal's side. Caller MUST have already verified ownership.
 */
async function voidOpenOrder(orderId, correlationId) {
    const orderRef = admin_1.db.collection('paypalOrders').doc(orderId);
    try {
        await orderRef.update({
            status: 'voided_by_user',
            voidedAt: admin_1.FieldValue.serverTimestamp(),
        });
    }
    catch (writeErr) {
        logger.warn('paypal_void_firestore_write_failed', {
            orderId,
            correlationId,
            error: writeErr instanceof Error ? writeErr.message : String(writeErr),
        });
        // Don't return — still attempt the PayPal-side void so we don't leave a
        // half-cancelled order in PayPal if our local write hit a transient issue.
    }
    // Best-effort PayPal-side void. PayPal will time the order out on its own
    // schedule even if this fails, so we never throw.
    try {
        const request = getRequest();
        await request('POST', `/v2/checkout/orders/${orderId}/void`, undefined, {
            // No projection needed for a void (204 No Content) — return empty obj.
            project: () => ({}),
            correlationId,
        });
    }
    catch (err) {
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
async function findOpenOrderIds(uid, slotId, orderId, correlationId) {
    var _a;
    if (orderId) {
        try {
            const snap = await admin_1.db.collection('paypalOrders').doc(orderId).get();
            if (!snap.exists)
                return [];
            const doc = ((_a = snap.data()) !== null && _a !== void 0 ? _a : {});
            // [S14] Defense-in-depth: triple-check userId, slotId, and status before
            // attributing the void. We do NOT trust `orderId` alone.
            if (doc.userId !== uid ||
                doc.slotId !== slotId ||
                doc.status !== 'created') {
                logger.warn('paypal_void_ownership_mismatch', {
                    orderId,
                    callerUid: uid,
                    slotId,
                    correlationId,
                });
                return [];
            }
            return [orderId];
        }
        catch (err) {
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
        const snapshot = await admin_1.db
            .collection('paypalOrders')
            .where('userId', '==', uid)
            .where('slotId', '==', slotId)
            .where('status', '==', 'created')
            .get();
        const ids = [];
        snapshot.forEach((d) => ids.push(d.id));
        return ids;
    }
    catch (err) {
        logger.warn('paypal_void_query_failed', {
            callerUid: uid,
            slotId,
            correlationId,
            error: err instanceof Error ? err.message : String(err),
        });
        return [];
    }
}
exports.releaseSlotOnCancel = functions
    .runWith({ secrets: PAYPAL_SECRET_NAMES })
    .https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be authenticated');
    }
    const { eventId, slotId, orderId } = (data !== null && data !== void 0 ? data : {});
    if (!eventId || !slotId) {
        throw new functions.https.HttpsError('invalid-argument', 'eventId and slotId required');
    }
    const uid = context.auth.uid;
    const correlationId = `releaseSlotOnCancel:${eventId}:${slotId}:${uid}`;
    // ---- [C5] + [S14]: void any open paypalOrders for (uid, slotId) --------
    const orderIds = await findOpenOrderIds(uid, slotId, typeof orderId === 'string' && orderId.length > 0 ? orderId : null, correlationId);
    for (const id of orderIds) {
        await voidOpenOrder(id, correlationId);
    }
    // ---- Existing slot-release logic (unchanged behavior) ------------------
    const slotRef = admin_1.db.collection('events').doc(eventId).collection('slots').doc(slotId);
    try {
        await admin_1.db.runTransaction(async (transaction) => {
            const slotDoc = await transaction.get(slotRef);
            if (!slotDoc.exists)
                return;
            const slot = slotDoc.data();
            if (slot.status !== 'locked' || slot.lockedBy !== uid)
                return;
            transaction.update(slotRef, {
                status: 'available',
                lockedBy: null,
                lockedAt: null,
                lockedUntil: null,
            });
        });
        return { success: true };
    }
    catch (error) {
        console.error('releaseSlotOnCancel error:', error);
        return { success: true };
    }
});
//# sourceMappingURL=releaseSlotOnCancel.js.map