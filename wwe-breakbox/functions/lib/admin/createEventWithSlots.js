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
exports.createEventWithSlots = void 0;
const functions = __importStar(require("firebase-functions"));
const admin_1 = require("../utils/admin");
const tier_1 = require("../utils/tier");
const requireAdmin_1 = require("../utils/requireAdmin");
const VALID_BRANDS = ['RAW', 'SMACKDOWN', 'NXT', 'LEGENDS'];
exports.createEventWithSlots = functions
    .runWith({ minInstances: 0, timeoutSeconds: 120 })
    .https.onCall(async (data, context) => {
    var _a, _b;
    (0, requireAdmin_1.requireAdmin)(context);
    const { title, opensAt, description, slots } = data || {};
    if (!title || typeof title !== 'string') {
        throw new functions.https.HttpsError('invalid-argument', 'title is required');
    }
    if (!opensAt || typeof opensAt !== 'number') {
        throw new functions.https.HttpsError('invalid-argument', 'opensAt (ms epoch) is required');
    }
    if (!Array.isArray(slots) || slots.length === 0) {
        throw new functions.https.HttpsError('invalid-argument', 'slots array is required');
    }
    for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        if (!s.wrestlerName || typeof s.wrestlerName !== 'string') {
            throw new functions.https.HttpsError('invalid-argument', `slots[${i}].wrestlerName invalid`);
        }
        if (typeof s.price !== 'number' || s.price < 0) {
            throw new functions.https.HttpsError('invalid-argument', `slots[${i}].price invalid`);
        }
        if (!VALID_BRANDS.includes(s.brand)) {
            throw new functions.https.HttpsError('invalid-argument', `slots[${i}].brand invalid`);
        }
    }
    const eventRef = admin_1.db.collection('events').doc();
    const eventId = eventRef.id;
    // Firestore batched writes (transaction not required — new doc IDs only).
    // Chunked into batches of 400 (under 500-write hard limit).
    const slotIds = [];
    const BATCH_SIZE = 400;
    // First batch creates the event itself + first chunk of slots.
    let firstBatch = admin_1.db.batch();
    firstBatch.set(eventRef, {
        title,
        description: description !== null && description !== void 0 ? description : '',
        status: 'upcoming',
        opensAt: admin_1.Timestamp.fromMillis(opensAt),
        closesAt: null,
        imageUrl: null,
        totalSlots: slots.length,
        soldSlots: 0,
        featuredSlotIds: [],
        createdAt: admin_1.FieldValue.serverTimestamp(),
        createdBy: context.auth.uid,
    });
    const firstChunk = slots.slice(0, BATCH_SIZE - 1);
    for (const s of firstChunk) {
        const slotRef = eventRef.collection('slots').doc();
        slotIds.push(slotRef.id);
        firstBatch.set(slotRef, {
            wrestlerName: s.wrestlerName,
            members: (_a = s.members) !== null && _a !== void 0 ? _a : [],
            brand: s.brand,
            price: s.price,
            tier: (0, tier_1.deriveTier)(s.price),
            status: 'available',
            lockedBy: null,
            lockedAt: null,
            lockedUntil: null,
            purchasedBy: null,
            purchasedAt: null,
            imageUrl: null,
        });
    }
    await firstBatch.commit();
    // Remaining slots in subsequent batches.
    for (let i = BATCH_SIZE - 1; i < slots.length; i += BATCH_SIZE) {
        const batch = admin_1.db.batch();
        const chunk = slots.slice(i, i + BATCH_SIZE);
        for (const s of chunk) {
            const slotRef = eventRef.collection('slots').doc();
            slotIds.push(slotRef.id);
            batch.set(slotRef, {
                wrestlerName: s.wrestlerName,
                members: (_b = s.members) !== null && _b !== void 0 ? _b : [],
                brand: s.brand,
                price: s.price,
                tier: (0, tier_1.deriveTier)(s.price),
                status: 'available',
                lockedBy: null,
                lockedAt: null,
                lockedUntil: null,
                purchasedBy: null,
                purchasedAt: null,
                imageUrl: null,
            });
        }
        await batch.commit();
    }
    return { eventId, slotCount: slotIds.length };
});
//# sourceMappingURL=createEventWithSlots.js.map