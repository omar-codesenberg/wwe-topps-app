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
exports.purchaseSlot = void 0;
// TODO(paypal-cutover): remove this callable once PayPal flow is verified in production. See plan file #14.
//
// Legacy purchaseSlot callable. Kept around so the existing mobile app keeps
// working through the PayPal cutover. The body now delegates to the shared
// `finalize()` helper that the new PayPal capture / webhook handlers also use,
// with a synthetic `legacy:<uuid>` captureId so legacy and PayPal-issued
// captures live in disjoint ID spaces inside `purchases/`.
const functions = __importStar(require("firebase-functions"));
const uuid_1 = require("uuid");
const admin_1 = require("./utils/admin");
const finalizeSlotPurchase_1 = require("./purchases/finalizeSlotPurchase");
exports.purchaseSlot = functions
    .runWith({ minInstances: 0 })
    .https.onCall(async (data, context) => {
    var _a;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be authenticated');
    }
    const { eventId, slotId } = data;
    if (!eventId || !slotId) {
        throw new functions.https.HttpsError('invalid-argument', 'eventId and slotId required');
    }
    const uid = context.auth.uid;
    const slotRef = admin_1.db.collection('events').doc(eventId).collection('slots').doc(slotId);
    try {
        // Read the slot once outside the transaction just to get `priceCents`
        // for the finalize amount. (The transaction inside `finalize` re-reads
        // the slot atomically and validates state.)
        const slotDoc = await slotRef.get();
        if (!slotDoc.exists) {
            return { success: false, reason: 'NOT_FOUND' };
        }
        const slot = slotDoc.data();
        const amountCents = (_a = slot.priceCents) !== null && _a !== void 0 ? _a : 0;
        const captureId = `legacy:${(0, uuid_1.v4)()}`;
        const result = await admin_1.db.runTransaction((tx) => (0, finalizeSlotPurchase_1.finalize)(tx, {
            captureId,
            orderId: 'legacy',
            eventId,
            slotId,
            userId: uid,
            amountCents,
            correlationId: 'legacy',
            paypalEnv: 'sandbox',
        }));
        // Preserve the legacy callable response shape so existing mobile clients
        // continue to work without redeploying the app.
        switch (result.status) {
            case 'finalized':
                return { success: true, purchaseId: result.purchaseId };
            case 'already_finalized':
                // Extremely unlikely with a fresh uuid; treat as success for the client.
                return { success: true, purchaseId: result.purchaseId };
            case 'already_sold_other':
                // Mirrors the prior NOT_YOUR_LOCK / SLOT_NOT_LOCKED branches.
                return { success: false, reason: 'SLOT_NOT_LOCKED' };
            case 'lock_expired':
                return { success: false, reason: 'LOCK_EXPIRED' };
            case 'refund_decided':
                // Cannot occur on the legacy path (no real PayPal refund pipeline),
                // but surface a stable reason if it ever does.
                return { success: false, reason: 'REFUND_DECIDED' };
            default:
                return { success: false, reason: 'UNKNOWN' };
        }
    }
    catch (error) {
        console.error('purchaseSlot error:', error);
        throw new functions.https.HttpsError('internal', 'Failed to purchase slot');
    }
});
//# sourceMappingURL=purchaseSlot.js.map