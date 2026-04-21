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
exports.lockSlot = void 0;
const functions = __importStar(require("firebase-functions"));
const admin_1 = require("./utils/admin");
exports.lockSlot = functions
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
            const [slotDoc, eventDoc] = await Promise.all([
                transaction.get(slotRef),
                transaction.get(eventRef),
            ]);
            if (!slotDoc.exists)
                return { success: false, reason: 'SLOT_NOT_FOUND' };
            if (!eventDoc.exists)
                return { success: false, reason: 'EVENT_NOT_FOUND' };
            const slot = slotDoc.data();
            const event = eventDoc.data();
            if (event.status !== 'live')
                return { success: false, reason: 'EVENT_NOT_LIVE' };
            if (slot.status === 'locked')
                return { success: false, reason: 'SLOT_LOCKED' };
            if (slot.status === 'sold')
                return { success: false, reason: 'SLOT_SOLD' };
            if (slot.status === 'closed')
                return { success: false, reason: 'SLOT_CLOSED' };
            const lockedUntil = new Date(Date.now() + 30000);
            transaction.update(slotRef, {
                status: 'locked',
                lockedBy: uid,
                lockedAt: admin_1.FieldValue.serverTimestamp(),
                lockedUntil: admin_1.Timestamp.fromDate(lockedUntil),
            });
            return { success: true, lockedUntil: lockedUntil.toISOString() };
        });
        return result;
    }
    catch (error) {
        console.error('lockSlot error:', error);
        throw new functions.https.HttpsError('internal', 'Failed to lock slot');
    }
});
//# sourceMappingURL=lockSlot.js.map