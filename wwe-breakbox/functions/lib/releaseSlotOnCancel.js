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
exports.releaseSlotOnCancel = functions.https.onCall(async (data, context) => {
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