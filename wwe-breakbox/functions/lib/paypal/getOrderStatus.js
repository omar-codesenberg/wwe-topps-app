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
exports.getPayPalOrderStatus = void 0;
const functions = __importStar(require("firebase-functions"));
const admin_1 = require("../utils/admin");
const client_1 = require("./client");
const logger = __importStar(require("../utils/logger"));
const config_1 = require("./config");
// `defineSecret(...)` references carry their resource id as `.name`. v1
// `runWith({ secrets: [...] })` validates each entry as a string resource id,
// so we surface the names from the config module rather than the raw
// SecretParam objects (which would fail v1's regex check).
const PAYPAL_SECRET_NAMES = [
    config_1.PAYPAL_CLIENT_ID.name,
    config_1.PAYPAL_CLIENT_SECRET.name,
];
exports.getPayPalOrderStatus = functions
    .runWith({ secrets: PAYPAL_SECRET_NAMES })
    .https.onCall(async (data, context) => {
    var _a;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be authenticated');
    }
    const orderId = data && typeof data === 'object' && typeof data.orderId === 'string'
        ? data.orderId
        : '';
    if (!orderId) {
        throw new functions.https.HttpsError('invalid-argument', 'orderId required');
    }
    const uid = context.auth.uid;
    const correlationId = `getOrderStatus:${orderId}`;
    const log = logger.withCorrelationId(correlationId);
    // ---- Firestore lookup ---------------------------------------------------
    const orderRef = admin_1.db.collection('paypalOrders').doc(orderId);
    let orderSnap;
    try {
        orderSnap = await orderRef.get();
    }
    catch (err) {
        log.error('paypal.getOrderStatus.read_failed', err, { orderId });
        throw new functions.https.HttpsError('internal', 'Failed to read order');
    }
    if (!orderSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'Order not found');
    }
    const orderDoc = (_a = orderSnap.data()) !== null && _a !== void 0 ? _a : {};
    // [C9] Cross-user probe defense — assert ownership BEFORE the PayPal call.
    if (orderDoc.userId !== uid) {
        log.warn('paypal.getOrderStatus.cross_user_probe', {
            orderId,
            callerUid: uid,
        });
        throw new functions.https.HttpsError('permission-denied', 'Order does not belong to caller');
    }
    const firestoreStatus = typeof orderDoc.status === 'string' ? orderDoc.status : '';
    // ---- PayPal read --------------------------------------------------------
    let projected;
    try {
        projected = await (0, client_1.request)('GET', `/v2/checkout/orders/${orderId}`, undefined, {
            // [S8] Allow-list projection — drop `links`, `payer`, `purchase_units`.
            project: (resp) => {
                const r = (resp !== null && resp !== void 0 ? resp : {});
                return {
                    id: typeof r.id === 'string' ? r.id : '',
                    status: typeof r.status === 'string' ? r.status : '',
                    intent: typeof r.intent === 'string' ? r.intent : '',
                };
            },
            correlationId,
        });
    }
    catch (err) {
        log.error('paypal.getOrderStatus.paypal_call_failed', err, { orderId });
        throw new functions.https.HttpsError('internal', 'Failed to fetch order status from PayPal');
    }
    const paypalStatus = projected.status;
    const voided = paypalStatus === 'VOIDED' || firestoreStatus === 'voided_by_user';
    return {
        orderId,
        status: firestoreStatus,
        paypalStatus,
        voided,
    };
});
//# sourceMappingURL=getOrderStatus.js.map