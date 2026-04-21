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
exports.setSlotClosed = void 0;
const functions = __importStar(require("firebase-functions"));
const admin_1 = require("../utils/admin");
const requireAdmin_1 = require("../utils/requireAdmin");
exports.setSlotClosed = functions
    .runWith({ minInstances: 0 })
    .https.onCall(async (data, context) => {
    (0, requireAdmin_1.requireAdmin)(context);
    const { eventId, slotId, closed } = data || {};
    if (!eventId || !slotId || typeof closed !== 'boolean') {
        throw new functions.https.HttpsError('invalid-argument', 'eventId, slotId, closed required');
    }
    const slotRef = admin_1.db.collection('events').doc(eventId).collection('slots').doc(slotId);
    return admin_1.db.runTransaction(async (tx) => {
        const slotDoc = await tx.get(slotRef);
        if (!slotDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Slot not found');
        }
        const slot = slotDoc.data();
        if (closed) {
            if (slot.status === 'sold') {
                throw new functions.https.HttpsError('failed-precondition', 'Cannot close a sold slot');
            }
            if (slot.status === 'locked') {
                // Closing while locked: clear the lock and mark closed.
                tx.update(slotRef, {
                    status: 'closed',
                    lockedBy: null,
                    lockedAt: null,
                    lockedUntil: null,
                });
            }
            else {
                tx.update(slotRef, { status: 'closed' });
            }
        }
        else {
            if (slot.status !== 'closed') {
                throw new functions.https.HttpsError('failed-precondition', 'Slot is not closed');
            }
            tx.update(slotRef, { status: 'available' });
        }
        return { success: true };
    });
});
//# sourceMappingURL=setSlotClosed.js.map