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
 * [#26] Refund error classification — [C22].
 *
 * Verifies the permanent-vs-transient mapping used to decide between
 * `alert_required` (page on-call, never auto-retry) and `failed_will_retry`
 * (scheduler picks up).
 *
 *   PERMANENT (no retry, alert_required, attemptCount=1):
 *     - INSUFFICIENT_FUNDS   (422)
 *     - INSTRUMENT_DECLINED  (any)
 *     - REFUND_NOT_ALLOWED   (any)
 *
 *   TRANSIENT (failed_will_retry, attemptCount incremented):
 *     - INTERNAL_SERVER_ERROR (500)
 *     - TOO_MANY_REQUESTS     (429)
 *     - Network error (no paypalCode, no status)
 */
process.env.PAYPAL_ENV = 'sandbox';
jest.mock('firebase-functions/params', () => ({
    defineSecret: (name) => ({ name, value: () => `mocked-${name}` }),
}));
jest.mock('../paypal/client', () => ({
    request: jest.fn(),
}));
const docs = new Map();
const dbMock = {
    collection: (col) => ({
        doc: (id) => {
            const path = `${col}/${id}`;
            return {
                _path: path,
                update: async (data) => {
                    const existing = docs.get(path);
                    if (existing === undefined) {
                        throw new Error(`update on missing doc: ${path}`);
                    }
                    // Apply increment sentinel against the existing value.
                    const merged = Object.assign({}, existing);
                    for (const [k, v] of Object.entries(data)) {
                        if (v && typeof v === 'object' && v._inc !== undefined) {
                            const cur = typeof merged[k] === 'number' ? merged[k] : 0;
                            merged[k] = cur + (v._inc);
                        }
                        else {
                            merged[k] = v;
                        }
                    }
                    docs.set(path, merged);
                },
            };
        },
    }),
    runTransaction: async (fn) => {
        const writes = [];
        const txn = {
            get: async (ref) => {
                const data = docs.get(ref._path);
                return {
                    exists: data !== undefined,
                    data: () => data,
                };
            },
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
// so we (re)install `withCorrelationId`'s implementation in beforeEach.
jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    withCorrelationId: jest.fn(),
}));
const refund_1 = require("../paypal/refund");
const client_1 = require("../paypal/client");
const loggerMod = __importStar(require("../utils/logger"));
const requestMock = client_1.request;
const withCorrelationIdMock = loggerMod.withCorrelationId;
/** Build a SanitizedError-shaped object. */
function sanitizedError(fields) {
    var _a;
    const e = new Error((_a = fields.message) !== null && _a !== void 0 ? _a : 'sanitized error');
    if (fields.paypalCode !== undefined)
        e.paypalCode = fields.paypalCode;
    if (fields.status !== undefined)
        e.status = fields.status;
    return e;
}
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
describe('refundCapture — [C22] error classification', () => {
    test('INSUFFICIENT_FUNDS (422) → alert_required, no retry, attemptCount=1', async () => {
        requestMock.mockRejectedValue(sanitizedError({ paypalCode: 'INSUFFICIENT_FUNDS', status: 422 }));
        const result = await (0, refund_1.refundCapture)('CAP1', 'reason', 'corr1');
        expect(result.status).toBe('alert_required');
        expect(result.errorCode).toBe('INSUFFICIENT_FUNDS');
        const stored = docs.get('pendingRefunds/CAP1');
        expect(stored === null || stored === void 0 ? void 0 : stored.status).toBe('alert_required');
        expect(stored === null || stored === void 0 ? void 0 : stored.errorCode).toBe('INSUFFICIENT_FUNDS');
        expect(stored === null || stored === void 0 ? void 0 : stored.attemptCount).toBe(1);
        expect(requestMock).toHaveBeenCalledTimes(1);
    });
    test('INSTRUMENT_DECLINED → alert_required', async () => {
        requestMock.mockRejectedValue(sanitizedError({ paypalCode: 'INSTRUMENT_DECLINED' }));
        const result = await (0, refund_1.refundCapture)('CAP1', 'reason', 'corr1');
        expect(result.status).toBe('alert_required');
        expect(result.errorCode).toBe('INSTRUMENT_DECLINED');
        const stored = docs.get('pendingRefunds/CAP1');
        expect(stored === null || stored === void 0 ? void 0 : stored.status).toBe('alert_required');
        expect(stored === null || stored === void 0 ? void 0 : stored.attemptCount).toBe(1);
    });
    test('REFUND_NOT_ALLOWED → alert_required', async () => {
        requestMock.mockRejectedValue(sanitizedError({ paypalCode: 'REFUND_NOT_ALLOWED' }));
        const result = await (0, refund_1.refundCapture)('CAP1', 'reason', 'corr1');
        expect(result.status).toBe('alert_required');
        expect(result.errorCode).toBe('REFUND_NOT_ALLOWED');
    });
    test('INTERNAL_SERVER_ERROR (500) → failed_will_retry', async () => {
        requestMock.mockRejectedValue(sanitizedError({ paypalCode: 'INTERNAL_SERVER_ERROR', status: 500 }));
        const result = await (0, refund_1.refundCapture)('CAP1', 'reason', 'corr1');
        expect(result.status).toBe('failed_will_retry');
        expect(result.errorCode).toBe('INTERNAL_SERVER_ERROR');
        const stored = docs.get('pendingRefunds/CAP1');
        expect(stored === null || stored === void 0 ? void 0 : stored.status).toBe('failed_will_retry');
        expect(stored === null || stored === void 0 ? void 0 : stored.errorCode).toBe('INTERNAL_SERVER_ERROR');
        expect(stored === null || stored === void 0 ? void 0 : stored.attemptCount).toBe(1); // started at 0, incremented by 1
    });
    test('TOO_MANY_REQUESTS (429) → failed_will_retry', async () => {
        requestMock.mockRejectedValue(sanitizedError({ paypalCode: 'TOO_MANY_REQUESTS', status: 429 }));
        const result = await (0, refund_1.refundCapture)('CAP1', 'reason', 'corr1');
        expect(result.status).toBe('failed_will_retry');
        expect(result.errorCode).toBe('TOO_MANY_REQUESTS');
        const stored = docs.get('pendingRefunds/CAP1');
        expect(stored === null || stored === void 0 ? void 0 : stored.status).toBe('failed_will_retry');
    });
    test('network error (no paypalCode, no status) → failed_will_retry', async () => {
        // A bare network-style failure: no paypalCode, no status.
        const netErr = new Error('ECONNRESET');
        requestMock.mockRejectedValue(netErr);
        const result = await (0, refund_1.refundCapture)('CAP1', 'reason', 'corr1');
        expect(result.status).toBe('failed_will_retry');
        expect(result.errorCode).toBeUndefined();
        const stored = docs.get('pendingRefunds/CAP1');
        expect(stored === null || stored === void 0 ? void 0 : stored.status).toBe('failed_will_retry');
        expect(stored === null || stored === void 0 ? void 0 : stored.attemptCount).toBe(1);
    });
    describe('_classifyError direct mapping', () => {
        test.each([
            ['INSUFFICIENT_FUNDS'],
            ['INSTRUMENT_DECLINED'],
            ['REFUND_NOT_ALLOWED'],
            ['TRANSACTION_REFUSED'],
            ['CAPTURE_FULLY_REFUNDED'],
        ])('%s → permanent', (code) => {
            expect((0, refund_1._classifyError)({ paypalCode: code })).toBe('permanent');
            expect(refund_1.PERMANENT_REFUND_ERROR_CODES.has(code)).toBe(true);
        });
        test.each([
            ['INTERNAL_SERVER_ERROR'],
            ['TOO_MANY_REQUESTS'],
            ['UNKNOWN_CODE'],
        ])('%s → transient', (code) => {
            expect((0, refund_1._classifyError)({ paypalCode: code })).toBe('transient');
        });
        test('no code → transient', () => {
            expect((0, refund_1._classifyError)(new Error('boom'))).toBe('transient');
            expect((0, refund_1._classifyError)(undefined)).toBe('transient');
            expect((0, refund_1._classifyError)(null)).toBe('transient');
        });
    });
});
//# sourceMappingURL=refundClassification.test.js.map