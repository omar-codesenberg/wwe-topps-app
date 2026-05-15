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
 * [#25] Refund idempotency — [C7] (app-level decision lock) and [S11]
 * (deterministic PayPal-Request-Id).
 *
 * Verifies:
 *   1. Two concurrent refundCapture() calls for the same captureId result in
 *      EXACTLY ONE call to the PayPal client. The losing caller observes
 *      `status: in_flight` in `pendingRefunds/{captureId}` and short-circuits.
 *   2. The single PayPal call uses `requestId: 'refund:CAP1:full'` (S11).
 *   3. After the first refund completes, a third call short-circuits with
 *      `{ status: 'already_completed' }` and never re-calls PayPal.
 */
// Set env BEFORE any module load that touches paypal/config (transitively).
process.env.PAYPAL_ENV = 'sandbox';
// `firebase-functions/params` would otherwise fail under Jest because there's
// no Firebase runtime to register against.
jest.mock('firebase-functions/params', () => ({
    defineSecret: (name) => ({ name, value: () => `mocked-${name}` }),
}));
// Mock the PayPal client. `request` is a jest.fn() the tests drive.
jest.mock('../paypal/client', () => ({
    request: jest.fn(),
}));
const docs = new Map();
// Concurrency knob: tests can install a hook to interleave the second caller's
// transaction between the first caller's transaction commit and its
// `update -> in_flight` step (or in front of/within the txn read).
let pendingTransactionGate = null;
function makeRef(path) {
    return { _path: path };
}
function snap(path) {
    const data = docs.get(path);
    return {
        exists: data !== undefined,
        data: () => data,
    };
}
const dbMock = {
    collection: (col) => ({
        doc: (id) => {
            const path = `${col}/${id}`;
            return {
                _path: path,
                update: async (data) => {
                    const existing = docs.get(path);
                    if (existing === undefined) {
                        // Mirror Firestore: update on missing throws.
                        throw new Error(`update on missing doc: ${path}`);
                    }
                    docs.set(path, Object.assign(Object.assign({}, existing), data));
                },
            };
        },
    }),
    runTransaction: async (fn) => {
        // Optional gate — lets a test pause one transaction while another runs.
        if (pendingTransactionGate) {
            const g = pendingTransactionGate;
            pendingTransactionGate = null;
            await g();
        }
        // Buffer writes inside the txn and commit them atomically on success.
        const writes = [];
        const txn = {
            get: async (ref) => snap(ref._path),
            set: (ref, data, _opts) => {
                writes.push(() => docs.set(ref._path, Object.assign({}, data)));
            },
            update: (ref, data) => {
                writes.push(() => {
                    var _a;
                    const cur = (_a = docs.get(ref._path)) !== null && _a !== void 0 ? _a : {};
                    docs.set(ref._path, Object.assign(Object.assign({}, cur), data));
                });
            },
        };
        const result = await fn(txn);
        for (const w of writes)
            w();
        return result;
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
// Silence the structured logger. Note: jest.config.js has `restoreMocks: true`,
// so we must (re)install the `withCorrelationId` implementation in beforeEach
// — otherwise auto-restore wipes it before each test runs.
jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    withCorrelationId: jest.fn(),
}));
// Pull the mocked client + the SUT after all mocks are installed.
const refund_1 = require("../paypal/refund");
const client_1 = require("../paypal/client");
const loggerMod = __importStar(require("../utils/logger"));
const requestMock = client_1.request;
const withCorrelationIdMock = loggerMod.withCorrelationId;
beforeEach(() => {
    docs.clear();
    pendingTransactionGate = null;
    requestMock.mockReset();
    withCorrelationIdMock.mockReset();
    withCorrelationIdMock.mockReturnValue({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    });
});
describe('refundCapture — [C7][S11] idempotency', () => {
    test('two concurrent calls produce exactly ONE PayPal request', async () => {
        // Make the PayPal call slow enough that both callers' transactions race.
        let resolveRequest = () => { };
        const requestPromise = new Promise((r) => {
            resolveRequest = r;
        });
        requestMock.mockImplementation(() => requestPromise);
        const callerA = (0, refund_1.refundCapture)('CAP1', 'amount_mismatch', 'corrA');
        // Yield so callerA's transaction commits and the doc is set to `requested`,
        // then advances to `in_flight` BEFORE callerB observes state.
        await new Promise((r) => setImmediate(r));
        await new Promise((r) => setImmediate(r));
        const callerB = (0, refund_1.refundCapture)('CAP1', 'amount_mismatch', 'corrB');
        // Let callerB's transaction run; it should observe `in_flight` and bail.
        const resultB = await callerB;
        expect(resultB).toEqual({ status: 'failed_will_retry' });
        // Now finish callerA's PayPal call.
        resolveRequest({ id: 'REFUND-1', status: 'COMPLETED' });
        const resultA = await callerA;
        expect(resultA).toEqual({
            status: 'completed',
            paypalRefundId: 'REFUND-1',
        });
        // Exactly one PayPal call.
        expect(requestMock).toHaveBeenCalledTimes(1);
    });
    test('the single PayPal call uses requestId "refund:CAP1:full" [S11]', async () => {
        requestMock.mockResolvedValue({ id: 'REFUND-2', status: 'COMPLETED' });
        const result = await (0, refund_1.refundCapture)('CAP1', 'slot_already_sold', 'corr1');
        expect(result.status).toBe('completed');
        expect(requestMock).toHaveBeenCalledTimes(1);
        const [method, path, body, opts] = requestMock.mock.calls[0];
        expect(method).toBe('POST');
        expect(path).toBe('/v2/payments/captures/CAP1/refund');
        expect(body).toEqual({});
        expect(opts).toMatchObject({
            requestId: 'refund:CAP1:full',
            correlationId: 'corr1',
        });
        expect(typeof opts.project).toBe('function');
    });
    test('post-completion call returns already_completed without a new PayPal call', async () => {
        requestMock.mockResolvedValue({ id: 'REFUND-3', status: 'COMPLETED' });
        // First call completes normally.
        const first = await (0, refund_1.refundCapture)('CAP1', 'reason', 'corr1');
        expect(first.status).toBe('completed');
        expect(first.paypalRefundId).toBe('REFUND-3');
        expect(requestMock).toHaveBeenCalledTimes(1);
        // Sanity: doc is in completed state.
        const stored = docs.get('pendingRefunds/CAP1');
        expect(stored === null || stored === void 0 ? void 0 : stored.status).toBe('completed');
        expect(stored === null || stored === void 0 ? void 0 : stored.paypalRefundId).toBe('REFUND-3');
        // Second call must short-circuit.
        const second = await (0, refund_1.refundCapture)('CAP1', 'reason', 'corr2');
        expect(second).toEqual({
            status: 'already_completed',
            paypalRefundId: 'REFUND-3',
        });
        expect(requestMock).toHaveBeenCalledTimes(1); // unchanged
    });
});
//# sourceMappingURL=refundIdempotency.test.js.map