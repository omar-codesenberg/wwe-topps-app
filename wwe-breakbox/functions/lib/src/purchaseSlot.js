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
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const uuid_1 = require("uuid");
const admin_1 = require("./utils/admin");
exports.purchaseSlot = functions
    .runWith({ minInstances: 0 })
    .https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be authenticated');
    }
    const { eventId, slotId } = data;
    if (!eventId || !slotId) {
        throw new functions.https.HttpsError('invalid-argument', 'eventId and slotId required');
    }
    const uid = context.auth.uid;
    const slotRef = admin_1.db.collection('events').doc(eventId).collection('slots').doc(slotId);
    const eventRef = admin_1.db.collection('events').doc(eventId);
    try {
        const result = await admin_1.db.runTransaction(async (transaction) => {
            var _a;
            const [slotDoc, eventDoc] = await Promise.all([
                transaction.get(slotRef),
                transaction.get(eventRef),
            ]);
            if (!slotDoc.exists || !eventDoc.exists)
                return { success: false, reason: 'NOT_FOUND' };
            const slot = slotDoc.data();
            const event = eventDoc.data();
            if (slot.status !== 'locked')
                return { success: false, reason: 'SLOT_NOT_LOCKED' };
            if (slot.lockedBy !== uid)
                return { success: false, reason: 'NOT_YOUR_LOCK' };
            const lockedUntil = (_a = slot.lockedUntil) === null || _a === void 0 ? void 0 : _a.toDate();
            if (lockedUntil && lockedUntil < new Date())
                return { success: false, reason: 'LOCK_EXPIRED' };
            const purchaseId = (0, uuid_1.v4)();
            const purchaseRef = admin_1.db.collection('purchases').doc(purchaseId);
            const userRef = admin_1.db.collection('users').doc(uid);
            const newSoldSlots = (event.soldSlots || 0) + 1;
            const isLastSlot = newSoldSlots >= (event.totalSlots || 112);
            transaction.update(slotRef, {
                status: 'sold',
                purchasedBy: uid,
                purchasedAt: admin.firestore.FieldValue.serverTimestamp(),
                lockedBy: null,
                lockedAt: null,
                lockedUntil: null,
            });
            transaction.set(purchaseRef, {
                id: purchaseId,
                userId: uid,
                eventId,
                slotId,
                wrestlerName: slot.wrestlerName,
                eventTitle: event.title,
                brand: slot.brand,
                tier: slot.tier,
                price: slot.price,
                purchasedAt: admin.firestore.FieldValue.serverTimestamp(),
                transactionId: (0, uuid_1.v4)(), // TODO: Replace with PayPal transaction ID
                status: 'completed',
            });
            transaction.update(eventRef, Object.assign({ soldSlots: admin.firestore.FieldValue.increment(1) }, (isLastSlot ? { status: 'closed', closesAt: admin.firestore.FieldValue.serverTimestamp() } : {})));
            transaction.update(userRef, {
                purchaseCount: admin.firestore.FieldValue.increment(1),
            });
            return { success: true, purchaseId };
        });
        return result;
    }
    catch (error) {
        console.error('purchaseSlot error:', error);
        throw new functions.https.HttpsError('internal', 'Failed to purchase slot');
    }
});
//# sourceMappingURL=purchaseSlot.js.map