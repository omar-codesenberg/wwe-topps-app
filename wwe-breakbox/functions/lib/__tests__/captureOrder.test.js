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
 * Tests for the captureOrder callable (P8).
 *
 * Covers:
 *   [C2]  Server-side amount/currency assertion → refund + AMOUNT_MISMATCH.
 *   [S1]  String equality (not float) when comparing amounts.
 *   [S9]  paypal_amount_mismatch logger event on mismatch.
 *   [S10] Decision-lock: branch on `finalize()` result without re-checking.
 *   [S11] Refund flow uses refundCapture() — request-id template enforced
 *         inside refund.ts. We verify the captureId we pass through here.
 *   [C9]  Cross-user authorization rejected before any PayPal call.
 */
// Set env BEFORE any module load that touches paypal/config (transitively).
process.env.PAYPAL_ENV = 'sandbox';
const docs = new Map();
// Capture the function passed to runTransaction so the test driver can decide
// what `finalize()` should appear to return — we mock finalize directly below
// so the actual transaction body is the mocked function call.
const dbMock = {
    collection: (col) => ({
        doc: (id) => {
            const path = `${col}/${id}`;
            const ref = {
                _path: path,
                get: async () => {
                    const data = docs.get(path);
                    return {
                        exists: data !== undefined,
                        data: () => data,
                    };
                },
                update: async (data) => {
                    var _a;
                    const cur = (_a = docs.get(path)) !== null && _a !== void 0 ? _a : {};
                    docs.set(path, Object.assign(Object.assign({}, cur), data));
                },
            };
            return ref;
        },
    }),
    runTransaction: async (fn) => {
        // The body delegates to mocked `finalize()`, which doesn't actually use
        // the txn. Provide a stub.
        const txn = {
            get: async () => ({ exists: false, data: () => undefined }),
            set: () => { },
            update: () => { },
        };
        return fn(txn);
    },
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
// Mock the PayPal client.
jest.mock('../paypal/client', () => ({
    request: jest.fn(),
}));
// Mock the refund helper.
jest.mock('../paypal/refund', () => ({
    refundCapture: jest.fn(),
}));
// Mock finalize directly so we drive its return value per test.
jest.mock('../purchases/finalizeSlotPurchase', () => ({
    finalize: jest.fn(),
}));
// Silence the structured logger; jest.config.js sets restoreMocks: true so
// reinstall in beforeEach.
jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    withCorrelationId: jest.fn(),
}));
const client_1 = require("../paypal/client");
const refund_1 = require("../paypal/refund");
const finalizeSlotPurchase_1 = require("../purchases/finalizeSlotPurchase");
const loggerMod = __importStar(require("../utils/logger"));
const requestMock = client_1.request;
const refundCaptureMock = refund_1.refundCapture;
const finalizeMock = finalizeSlotPurchase_1.finalize;
const withCorrelationIdMock = loggerMod.withCorrelationId;
const loggerErrorMock = loggerMod.error;
const loggerInfoMock = loggerMod.info;
const loggerWarnMock = loggerMod.warn;
// Scoped logger spies that callers see via `withCorrelationId(...)`.
let scopedInfo;
let scopedWarn;
let scopedError;
// SUT — load AFTER all mocks so module init picks up our jest.mock factories.
// captureOrder.ts uses require('./client') indirectly via the v1 callable
// wrapper, so importing here is safe.
let capturePayPalOrder;
beforeAll(() => {
    ({ capturePayPalOrder } = require('../paypal/captureOrder'));
});
beforeEach(() => {
    docs.clear();
    requestMock.mockReset();
    refundCaptureMock.mockReset();
    finalizeMock.mockReset();
    loggerErrorMock.mockReset();
    loggerInfoMock.mockReset();
    loggerWarnMock.mockReset();
    scopedInfo = jest.fn();
    scopedWarn = jest.fn();
    scopedError = jest.fn();
    withCorrelationIdMock.mockReset();
    withCorrelationIdMock.mockReturnValue({
        info: scopedInfo,
        warn: scopedWarn,
        error: scopedError,
    });
});
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const ORDER_ID = 'ORDER-1';
const USER_A = 'USER-A';
const USER_B = 'USER-B';
const CORR_ID = 'corr-1';
function seedOrder(overrides = {}) {
    docs.set(`paypalOrders/${ORDER_ID}`, Object.assign({ userId: USER_A, status: 'created', expectedAmount: '10.10', currency: 'CAD', eventId: 'EVT-1', slotId: 'SLOT-1', correlationId: CORR_ID }, overrides));
}
function captureResponse(captureId, amountValue, currency = 'CAD') {
    return {
        id: ORDER_ID,
        status: 'COMPLETED',
        purchase_units: [
            {
                payments: {
                    captures: [
                        {
                            id: captureId,
                            status: 'COMPLETED',
                            amount: { value: amountValue, currency_code: currency },
                            custom_id: 'EVT-1::SLOT-1',
                        },
                    ],
                },
            },
        ],
    };
}
/** Pull the inner request handler out of a v1 onCall function. */
function getHandler(callable) {
    // firebase-functions v1 attaches the original handler at .run.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return callable.run;
}
async function invoke(data, auth) {
    const handler = getHandler(capturePayPalOrder);
    return handler(data, auth ? { auth } : {});
}
// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('capturePayPalOrder — auth + authorization', () => {
    test('no auth → throws unauthenticated; no PayPal call', async () => {
        seedOrder();
        requestMock.mockResolvedValue(captureResponse('CAP1', '10.10'));
        await expect(invoke({ orderId: ORDER_ID }, undefined)).rejects.toMatchObject({ code: 'unauthenticated' });
        expect(requestMock).not.toHaveBeenCalled();
        expect(refundCaptureMock).not.toHaveBeenCalled();
        expect(finalizeMock).not.toHaveBeenCalled();
    });
    test('cross-user attempt [C9] → permission-denied; no PayPal call', async () => {
        seedOrder({ userId: USER_A });
        requestMock.mockResolvedValue(captureResponse('CAP1', '10.10'));
        await expect(invoke({ orderId: ORDER_ID }, { uid: USER_B })).rejects.toMatchObject({ code: 'permission-denied' });
        expect(requestMock).not.toHaveBeenCalled();
        expect(refundCaptureMock).not.toHaveBeenCalled();
        expect(finalizeMock).not.toHaveBeenCalled();
    });
});
describe('capturePayPalOrder — pre-capture order status', () => {
    test('order voided_by_user → throws ORDER_VOIDED; no PayPal call', async () => {
        seedOrder({ status: 'voided_by_user' });
        requestMock.mockResolvedValue(captureResponse('CAP1', '10.10'));
        let caught;
        try {
            await invoke({ orderId: ORDER_ID }, { uid: USER_A });
        }
        catch (e) {
            caught = e;
        }
        expect(caught).toBeDefined();
        expect(caught.code).toBe('failed-precondition');
        // HttpsError details carry our domain code.
        const details = caught.details;
        expect(details === null || details === void 0 ? void 0 : details.code).toBe('ORDER_VOIDED');
        expect(requestMock).not.toHaveBeenCalled();
        expect(refundCaptureMock).not.toHaveBeenCalled();
    });
});
describe('capturePayPalOrder — amount/currency assertion [C2][S1][S9]', () => {
    test('amount mismatch → refund + AMOUNT_MISMATCH; finalize NOT called; logs paypal_amount_mismatch', async () => {
        var _a;
        seedOrder({ expectedAmount: '10.10' });
        requestMock.mockResolvedValue(captureResponse('CAP1', '10.11'));
        refundCaptureMock.mockResolvedValue({
            status: 'completed',
            paypalRefundId: 'REFUND-1',
        });
        let caught;
        try {
            await invoke({ orderId: ORDER_ID }, { uid: USER_A });
        }
        catch (e) {
            caught = e;
        }
        expect(caught).toBeDefined();
        expect(caught.code).toBe('failed-precondition');
        expect((_a = caught.details) === null || _a === void 0 ? void 0 : _a.code).toBe('AMOUNT_MISMATCH');
        expect(finalizeMock).not.toHaveBeenCalled();
        expect(refundCaptureMock).toHaveBeenCalledTimes(1);
        expect(refundCaptureMock).toHaveBeenCalledWith('CAP1', 'amount_mismatch', CORR_ID);
        // [S9] paypal_amount_mismatch event was logged with the right shape.
        const mismatchCalls = scopedError.mock.calls.filter((c) => c[0] === 'paypal_amount_mismatch');
        expect(mismatchCalls.length).toBe(1);
        const [, , extra] = mismatchCalls[0];
        expect(extra).toMatchObject({
            orderId: ORDER_ID,
            captureId: 'CAP1',
            expected: '10.10',
            actual: '10.11',
            correlationId: CORR_ID,
        });
    });
    test('currency mismatch (USD) → refund + AMOUNT_MISMATCH', async () => {
        var _a;
        seedOrder({ expectedAmount: '10.10' });
        requestMock.mockResolvedValue(captureResponse('CAP1', '10.10', 'USD'));
        refundCaptureMock.mockResolvedValue({
            status: 'completed',
            paypalRefundId: 'REFUND-1',
        });
        let caught;
        try {
            await invoke({ orderId: ORDER_ID }, { uid: USER_A });
        }
        catch (e) {
            caught = e;
        }
        expect(caught).toBeDefined();
        expect((_a = caught.details) === null || _a === void 0 ? void 0 : _a.code).toBe('AMOUNT_MISMATCH');
        expect(finalizeMock).not.toHaveBeenCalled();
        expect(refundCaptureMock).toHaveBeenCalledTimes(1);
        expect(refundCaptureMock).toHaveBeenCalledWith('CAP1', 'amount_mismatch', CORR_ID);
    });
    test('[S1] string equality "10.10" vs "10.1" → mismatch (would slip past float compare)', async () => {
        var _a;
        seedOrder({ expectedAmount: '10.10' });
        requestMock.mockResolvedValue(captureResponse('CAP1', '10.1'));
        refundCaptureMock.mockResolvedValue({
            status: 'completed',
            paypalRefundId: 'REFUND-1',
        });
        // Sanity check that floats would treat these as equal.
        expect(parseFloat('10.10')).toBe(parseFloat('10.1'));
        let caught;
        try {
            await invoke({ orderId: ORDER_ID }, { uid: USER_A });
        }
        catch (e) {
            caught = e;
        }
        expect(caught).toBeDefined();
        expect((_a = caught.details) === null || _a === void 0 ? void 0 : _a.code).toBe('AMOUNT_MISMATCH');
        expect(finalizeMock).not.toHaveBeenCalled();
        expect(refundCaptureMock).toHaveBeenCalledWith('CAP1', 'amount_mismatch', CORR_ID);
    });
});
describe('capturePayPalOrder — finalize branches [S10]', () => {
    test('finalize returns "finalized" → success; order stamped captured; no refund', async () => {
        seedOrder({ expectedAmount: '10.10' });
        requestMock.mockResolvedValue(captureResponse('CAP1', '10.10'));
        finalizeMock.mockResolvedValue({
            status: 'finalized',
            purchaseId: 'CAP1',
        });
        const result = await invoke({ orderId: ORDER_ID }, { uid: USER_A });
        expect(result).toEqual({ success: true, purchaseId: 'CAP1' });
        expect(refundCaptureMock).not.toHaveBeenCalled();
        expect(finalizeMock).toHaveBeenCalledTimes(1);
        const finalizeArgs = finalizeMock.mock.calls[0][1];
        expect(finalizeArgs).toMatchObject({
            captureId: 'CAP1',
            orderId: ORDER_ID,
            eventId: 'EVT-1',
            slotId: 'SLOT-1',
            userId: USER_A,
            amountCents: 1010,
            correlationId: CORR_ID,
            paypalEnv: 'sandbox',
        });
        const stored = docs.get(`paypalOrders/${ORDER_ID}`);
        expect(stored === null || stored === void 0 ? void 0 : stored.status).toBe('captured');
        expect(stored === null || stored === void 0 ? void 0 : stored.captureId).toBe('CAP1');
    });
    test('finalize returns "already_finalized" (race won by sibling) → success; no refund', async () => {
        seedOrder({ expectedAmount: '10.10' });
        requestMock.mockResolvedValue(captureResponse('CAP1', '10.10'));
        finalizeMock.mockResolvedValue({
            status: 'already_finalized',
            purchaseId: 'CAP1',
        });
        const result = await invoke({ orderId: ORDER_ID }, { uid: USER_A });
        expect(result).toEqual({ success: true, purchaseId: 'CAP1' });
        expect(refundCaptureMock).not.toHaveBeenCalled();
        const stored = docs.get(`paypalOrders/${ORDER_ID}`);
        expect(stored === null || stored === void 0 ? void 0 : stored.status).toBe('captured');
        expect(stored === null || stored === void 0 ? void 0 : stored.captureId).toBe('CAP1');
    });
    test('finalize returns "refund_decided" → REFUND_DECIDED; NO new refund', async () => {
        seedOrder({ expectedAmount: '10.10' });
        requestMock.mockResolvedValue(captureResponse('CAP1', '10.10'));
        finalizeMock.mockResolvedValue({ status: 'refund_decided' });
        const result = await invoke({ orderId: ORDER_ID }, { uid: USER_A });
        expect(result).toEqual({ success: false, reason: 'REFUND_DECIDED' });
        expect(refundCaptureMock).not.toHaveBeenCalled();
        const stored = docs.get(`paypalOrders/${ORDER_ID}`);
        expect(stored === null || stored === void 0 ? void 0 : stored.status).toBe('created'); // not stamped captured
    });
    test('finalize returns "already_sold_other" → SLOT_SOLD_OTHER + refund (slot_sold_to_other)', async () => {
        seedOrder({ expectedAmount: '10.10' });
        requestMock.mockResolvedValue(captureResponse('CAP1', '10.10'));
        finalizeMock.mockResolvedValue({ status: 'already_sold_other' });
        refundCaptureMock.mockResolvedValue({
            status: 'completed',
            paypalRefundId: 'REFUND-2',
        });
        const result = (await invoke({ orderId: ORDER_ID }, { uid: USER_A }));
        expect(result.success).toBe(false);
        expect(result.reason).toBe('SLOT_SOLD_OTHER');
        expect(refundCaptureMock).toHaveBeenCalledTimes(1);
        expect(refundCaptureMock).toHaveBeenCalledWith('CAP1', 'slot_sold_to_other', CORR_ID);
    });
    test('finalize returns "lock_expired" → LOCK_EXPIRED + refund (lock_expired)', async () => {
        seedOrder({ expectedAmount: '10.10' });
        requestMock.mockResolvedValue(captureResponse('CAP1', '10.10'));
        finalizeMock.mockResolvedValue({ status: 'lock_expired' });
        refundCaptureMock.mockResolvedValue({
            status: 'completed',
            paypalRefundId: 'REFUND-3',
        });
        const result = (await invoke({ orderId: ORDER_ID }, { uid: USER_A }));
        expect(result.success).toBe(false);
        expect(result.reason).toBe('LOCK_EXPIRED');
        expect(refundCaptureMock).toHaveBeenCalledTimes(1);
        expect(refundCaptureMock).toHaveBeenCalledWith('CAP1', 'lock_expired', CORR_ID);
    });
});
describe('capturePayPalOrder — refund delegation [S11]', () => {
    test('refund call passes the captureId returned by PayPal (request-id template enforced inside refund.ts)', async () => {
        seedOrder({ expectedAmount: '10.10' });
        requestMock.mockResolvedValue(captureResponse('CAP-XYZ-789', '10.10'));
        finalizeMock.mockResolvedValue({ status: 'lock_expired' });
        refundCaptureMock.mockResolvedValue({
            status: 'completed',
            paypalRefundId: 'REFUND-X',
        });
        await invoke({ orderId: ORDER_ID }, { uid: USER_A });
        expect(refundCaptureMock).toHaveBeenCalledTimes(1);
        const [captureIdArg, reasonArg, corrIdArg] = refundCaptureMock.mock.calls[0];
        expect(captureIdArg).toBe('CAP-XYZ-789');
        expect(reasonArg).toBe('lock_expired');
        expect(corrIdArg).toBe(CORR_ID);
    });
});
//# sourceMappingURL=captureOrder.test.js.map