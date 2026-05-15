"use strict";
/// <reference types="jest" />
/// <reference types="node" />
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
/**
 * [#5 / S6 / C9] getPayPalOrderStatus — deep-link recovery + cross-user probe
 * defense.
 *
 * Verifies:
 *   1. [C9] Cross-user probe: user B asking for user A's orderId throws
 *      `permission-denied` BEFORE any PayPal call is attempted.
 *   2. Local `voided_by_user` state surfaces as `voided: true`.
 *   3. Happy path returns the (firestoreStatus, paypalStatus, voided=false)
 *      triple and the PayPal call IS made.
 *   4. Missing `context.auth` throws `unauthenticated` and never calls PayPal.
 *   5. Missing Firestore order doc throws `not-found` and never calls PayPal.
 */
process.env.PAYPAL_ENV = 'sandbox';
jest.mock('firebase-functions/params', () => ({
    defineSecret: (name) => ({ name, value: () => `mocked-${name}` }),
}));
jest.mock('../paypal/client', () => ({
    request: jest.fn(),
}));
// Silence the structured logger.
jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    withCorrelationId: jest.fn(),
}));
const docs = new Map();
const dbMock = {
    collection: (col) => ({
        doc: (id) => ({
            _path: `${col}/${id}`,
            get: async () => {
                const data = docs.get(`${col}/${id}`);
                return {
                    exists: data !== undefined,
                    data: () => data,
                };
            },
        }),
    }),
};
jest.mock('../utils/admin', () => ({
    db: dbMock,
    FieldValue: {
        serverTimestamp: () => ({ _serverTs: true }),
        increment: (n) => ({ _inc: n }),
    },
    Timestamp: {
        now: () => ({ _now: Date.now() }),
        fromDate: (d) => ({ _fromDate: d.toISOString() }),
    },
}));
const getOrderStatus_1 = require("../paypal/getOrderStatus");
const client_1 = require("../paypal/client");
const loggerMod = __importStar(require("../utils/logger"));
const requestMock = client_1.request;
const withCorrelationIdMock = loggerMod.withCorrelationId;
// `functions.https.onCall(...)` returns an object with a `.run(data, context)`
// hook for unit tests (Runnable<T>). Type the cast loosely so we can call it.
const runFn = getOrderStatus_1.getPayPalOrderStatus.run;
beforeEach(() => {
    docs.clear();
    requestMock.mockReset();
    withCorrelationIdMock.mockReset();
    withCorrelationIdMock.mockReturnValue({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    });
});
async function expectHttpsError(promise, expectedCode) {
    let caught;
    try {
        await promise;
    }
    catch (e) {
        caught = e;
    }
    if (caught === undefined) {
        throw new Error(`Expected HttpsError(${expectedCode}) but no error thrown`);
    }
    const err = caught;
    expect(err.code).toBe(expectedCode);
    return err;
}
describe('getPayPalOrderStatus', () => {
    test('[C9] cross-user probe — user B asking for user A\'s order throws permission-denied and never calls PayPal', async () => {
        docs.set('paypalOrders/ORD-A', {
            userId: 'USER-A',
            slotId: 'SLOT-1',
            status: 'created',
        });
        await expectHttpsError(runFn({ orderId: 'ORD-A' }, { auth: { uid: 'USER-B' } }), 'permission-denied');
        expect(requestMock).not.toHaveBeenCalled();
    });
    test('local voided_by_user state surfaces as voided: true', async () => {
        docs.set('paypalOrders/ORD-V', {
            userId: 'USER-A',
            slotId: 'SLOT-1',
            status: 'voided_by_user',
        });
        requestMock.mockResolvedValue({
            id: 'ORD-V',
            status: 'CREATED',
            intent: 'CAPTURE',
        });
        const result = (await runFn({ orderId: 'ORD-V' }, { auth: { uid: 'USER-A' } }));
        expect(result).toEqual({
            orderId: 'ORD-V',
            status: 'voided_by_user',
            paypalStatus: 'CREATED',
            voided: true,
        });
    });
    test('valid (user, order, status=created) tuple returns paypalStatus + voided=false; PayPal IS called', async () => {
        docs.set('paypalOrders/ORD-OK', {
            userId: 'USER-A',
            slotId: 'SLOT-1',
            status: 'created',
        });
        requestMock.mockResolvedValue({
            id: 'ORD-OK',
            status: 'APPROVED',
            intent: 'CAPTURE',
        });
        const result = (await runFn({ orderId: 'ORD-OK' }, { auth: { uid: 'USER-A' } }));
        expect(result).toEqual({
            orderId: 'ORD-OK',
            status: 'created',
            paypalStatus: 'APPROVED',
            voided: false,
        });
        expect(requestMock).toHaveBeenCalledTimes(1);
        const [method, path, body, opts] = requestMock.mock.calls[0];
        expect(method).toBe('GET');
        expect(path).toBe('/v2/checkout/orders/ORD-OK');
        expect(body).toBeUndefined();
        expect(typeof opts.project).toBe('function');
    });
    test('missing auth throws unauthenticated and never calls PayPal', async () => {
        docs.set('paypalOrders/ORD-A', {
            userId: 'USER-A',
            status: 'created',
        });
        await expectHttpsError(runFn({ orderId: 'ORD-A' }, {}), 'unauthenticated');
        expect(requestMock).not.toHaveBeenCalled();
    });
    test('missing order doc throws not-found and never calls PayPal', async () => {
        await expectHttpsError(runFn({ orderId: 'ORD-MISSING' }, { auth: { uid: 'USER-A' } }), 'not-found');
        expect(requestMock).not.toHaveBeenCalled();
    });
    test('PayPal "VOIDED" status surfaces as voided: true even when Firestore says created', async () => {
        docs.set('paypalOrders/ORD-PV', {
            userId: 'USER-A',
            slotId: 'SLOT-1',
            status: 'created',
        });
        requestMock.mockResolvedValue({
            id: 'ORD-PV',
            status: 'VOIDED',
            intent: 'CAPTURE',
        });
        const result = (await runFn({ orderId: 'ORD-PV' }, { auth: { uid: 'USER-A' } }));
        expect(result.paypalStatus).toBe('VOIDED');
        expect(result.voided).toBe(true);
    });
});
//# sourceMappingURL=deepLinkTokenValidation.test.js.map