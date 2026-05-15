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
 * Tests for the webhook handler — focus on the [S5] custom_id cross-check
 * defense, plus the [S18] pre-verifier sanity gate, [S3] verifier-state HTTP
 * mapping, and [C3] dedupe.
 *
 * The handler is exercised through `_paypalWebhookImpl` (the test export of
 * the v1 onRequest body) so we don't need to spin up the firebase-functions
 * HTTPS shim.
 */
// Set env BEFORE any module that touches paypal/config (transitively).
process.env.PAYPAL_ENV = 'sandbox';
// `firebase-functions/params` would otherwise fail under Jest because there's
// no Firebase runtime to register against.
jest.mock('firebase-functions/params', () => ({
    defineSecret: (name) => ({ name, value: () => `mocked-${name}` }),
}));
// Mock the PayPal HTTP client so verifySignature's transitive import resolves.
jest.mock('../paypal/client', () => ({
    request: jest.fn(),
}));
// Mock the verifier so we drive the tri-state result from each test.
jest.mock('../paypal/verifySignature', () => ({
    verifyWebhookSignature: jest.fn(),
}));
// Mock finalize so we can assert on whether (and how) it was called.
jest.mock('../purchases/finalizeSlotPurchase', () => ({
    finalize: jest.fn(),
}));
// Mock refund so we can assert no refund is issued on mismatch.
jest.mock('../paypal/refund', () => ({
    refundCapture: jest.fn(),
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
                    docs.set(path, Object.assign(Object.assign({}, existing), data));
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
        let result;
        try {
            result = await fn(txn);
        }
        catch (e) {
            // Mirror Firestore: a thrown body aborts the transaction without
            // committing buffered writes.
            throw e;
        }
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
// Silence the structured logger. `restoreMocks: true` is set globally, so we
// re-install `withCorrelationId` in beforeEach.
jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    withCorrelationId: jest.fn(),
}));
const webhook_1 = require("../paypal/webhook");
const verifySignature_1 = require("../paypal/verifySignature");
const finalizeSlotPurchase_1 = require("../purchases/finalizeSlotPurchase");
const refund_1 = require("../paypal/refund");
const loggerMod = __importStar(require("../utils/logger"));
const verifyMock = verifySignature_1.verifyWebhookSignature;
const finalizeMock = finalizeSlotPurchase_1.finalize;
const refundMock = refund_1.refundCapture;
const loggerErrorMock = loggerMod.error;
const loggerWarnMock = loggerMod.warn;
const loggerInfoMock = loggerMod.info;
const withCorrelationIdMock = loggerMod.withCorrelationId;
function makeRes() {
    const res = {
        statusCode: 0,
        body: undefined,
        status(n) {
            this.statusCode = n;
            return {
                send: (body) => {
                    res.body = body;
                },
            };
        },
    };
    return res;
}
// We type the req as `unknown` here and cast at the boundary — it matches the
// minimum surface `_paypalWebhookImpl` reads (method, headers, rawBody).
function makeReq(opts = {}) {
    var _a, _b;
    const headers = {};
    for (const [k, v] of Object.entries((_a = opts.headers) !== null && _a !== void 0 ? _a : {})) {
        if (typeof v === 'string')
            headers[k.toLowerCase()] = v;
    }
    let raw;
    if (typeof opts.body === 'string') {
        raw = Buffer.from(opts.body, 'utf-8');
    }
    else if (Buffer.isBuffer(opts.body)) {
        raw = opts.body;
    }
    else {
        raw = undefined;
    }
    // Set content-length only if not explicitly provided.
    if (raw && headers['content-length'] === undefined) {
        headers['content-length'] = String(raw.length);
    }
    return {
        method: (_b = opts.method) !== null && _b !== void 0 ? _b : 'POST',
        headers,
        rawBody: raw,
    };
}
function defaultPaypalHeaders(transmissionId = 'TX-1') {
    return {
        'paypal-transmission-id': transmissionId,
        'paypal-transmission-sig': 'sig-bytes',
        'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/cert',
        'paypal-auth-algo': 'SHA256withRSA',
        'paypal-transmission-time': '2026-05-12T00:00:00Z',
    };
}
function buildCompletedEvent(opts = {}) {
    var _a, _b, _c, _d, _e;
    const event = {
        id: 'EVT-001',
        event_type: (_a = opts.eventType) !== null && _a !== void 0 ? _a : 'PAYMENT.CAPTURE.COMPLETED',
        resource: {
            id: (_b = opts.captureId) !== null && _b !== void 0 ? _b : 'CAP-XYZ',
            custom_id: (_c = opts.customId) !== null && _c !== void 0 ? _c : 'evt-1:slot-1:user-1',
            amount: { currency_code: 'CAD', value: (_d = opts.amountValue) !== null && _d !== void 0 ? _d : '25.00' },
            supplementary_data: {
                related_ids: { order_id: (_e = opts.orderId) !== null && _e !== void 0 ? _e : 'ORD-ABC' },
            },
        },
    };
    const body = JSON.stringify(event);
    const headers = defaultPaypalHeaders(opts.transmissionId);
    return { body, headers };
}
function seedOrder(orderId, fields) {
    docs.set(`paypalOrders/${orderId}`, Object.assign(Object.assign({}, fields), { status: 'created' }));
}
beforeEach(() => {
    docs.clear();
    verifyMock.mockReset();
    finalizeMock.mockReset();
    refundMock.mockReset();
    loggerErrorMock.mockReset();
    loggerWarnMock.mockReset();
    loggerInfoMock.mockReset();
    withCorrelationIdMock.mockReset();
    withCorrelationIdMock.mockImplementation(() => ({
        info: loggerInfoMock,
        warn: loggerWarnMock,
        error: loggerErrorMock,
    }));
});
// ---------------------------------------------------------------------------
// 1) custom_id mismatch [S5]
// ---------------------------------------------------------------------------
describe('webhook — [S5] custom_id mismatch defense', () => {
    test('PAYMENT.CAPTURE.COMPLETED with mismatched custom_id → 400, no finalize, no refund', async () => {
        verifyMock.mockResolvedValue({ state: 'success' });
        seedOrder('ORD-ABC', {
            eventId: 'evt-1',
            slotId: 'slot-1',
            userId: 'user-1',
        });
        const { body, headers } = buildCompletedEvent({
            orderId: 'ORD-ABC',
            customId: 'otherEvent:otherSlot:otherUid',
        });
        const req = makeReq({ method: 'POST', headers, body });
        const res = makeRes();
        await (0, webhook_1._paypalWebhookImpl)(req, res);
        expect(res.statusCode).toBe(400);
        expect(finalizeMock).not.toHaveBeenCalled();
        expect(refundMock).not.toHaveBeenCalled();
        // Dedupe doc must NOT have been committed (tx aborted).
        expect(docs.get('webhookEvents/TX-1')).toBeUndefined();
        // The mismatch event was logged.
        expect(loggerErrorMock).toHaveBeenCalledWith('paypal_custom_id_mismatch', null, expect.objectContaining({
            orderId: 'ORD-ABC',
            expected: 'evt-1:slot-1:user-1',
            actual: 'otherEvent:otherSlot:otherUid',
        }));
    });
    test('PAYMENT.CAPTURE.COMPLETED with matching custom_id → finalize IS called', async () => {
        verifyMock.mockResolvedValue({ state: 'success' });
        finalizeMock.mockResolvedValue({ status: 'finalized', purchaseId: 'CAP-XYZ' });
        seedOrder('ORD-ABC', {
            eventId: 'evt-1',
            slotId: 'slot-1',
            userId: 'user-1',
        });
        const { body, headers } = buildCompletedEvent({
            orderId: 'ORD-ABC',
            customId: 'evt-1:slot-1:user-1',
            captureId: 'CAP-XYZ',
            amountValue: '25.00',
        });
        const req = makeReq({ method: 'POST', headers, body });
        const res = makeRes();
        await (0, webhook_1._paypalWebhookImpl)(req, res);
        expect(res.statusCode).toBe(200);
        expect(finalizeMock).toHaveBeenCalledTimes(1);
        const [tx, args] = finalizeMock.mock.calls[0];
        expect(tx).toBeDefined();
        expect(args).toMatchObject({
            captureId: 'CAP-XYZ',
            orderId: 'ORD-ABC',
            eventId: 'evt-1',
            slotId: 'slot-1',
            userId: 'user-1',
            amountCents: 2500,
            paypalEnv: 'sandbox',
        });
        expect(typeof args.correlationId).toBe('string');
        expect(args.correlationId.length).toBeGreaterThan(0);
        // No refund on a happy finalize.
        expect(refundMock).not.toHaveBeenCalled();
        // Dedupe doc was committed.
        expect(docs.get('webhookEvents/TX-1')).toBeDefined();
    });
});
// ---------------------------------------------------------------------------
// 2) Pre-verifier gate [S18]
// ---------------------------------------------------------------------------
describe('webhook — [S18] pre-verifier sanity gate', () => {
    test('missing paypal-transmission-id header → 400, verifier NOT called', async () => {
        verifyMock.mockResolvedValue({ state: 'success' });
        const { body } = buildCompletedEvent();
        const headers = defaultPaypalHeaders();
        delete headers['paypal-transmission-id'];
        const req = makeReq({ method: 'POST', headers, body });
        const res = makeRes();
        await (0, webhook_1._paypalWebhookImpl)(req, res);
        expect(res.statusCode).toBe(400);
        expect(verifyMock).not.toHaveBeenCalled();
        expect(finalizeMock).not.toHaveBeenCalled();
        expect(loggerWarnMock).toHaveBeenCalledWith('paypal_webhook_pre_gate_failed', expect.objectContaining({ reason: 'missing_paypal_headers' }));
    });
    test('unrecognised event_type → 400, verifier NOT called', async () => {
        verifyMock.mockResolvedValue({ state: 'success' });
        const event = {
            id: 'EVT-2',
            event_type: 'UNKNOWN.EVENT',
            resource: {},
        };
        const req = makeReq({
            method: 'POST',
            headers: defaultPaypalHeaders(),
            body: JSON.stringify(event),
        });
        const res = makeRes();
        await (0, webhook_1._paypalWebhookImpl)(req, res);
        expect(res.statusCode).toBe(400);
        expect(verifyMock).not.toHaveBeenCalled();
        expect(finalizeMock).not.toHaveBeenCalled();
        expect(loggerWarnMock).toHaveBeenCalledWith('paypal_webhook_pre_gate_failed', expect.objectContaining({ reason: 'unrecognised_event_type' }));
    });
});
// ---------------------------------------------------------------------------
// 3) Verifier states [S3]
// ---------------------------------------------------------------------------
describe('webhook — [S3] verifier state → HTTP mapping', () => {
    test('verifier returns failure → 401, no finalize, no Firestore writes', async () => {
        verifyMock.mockResolvedValue({ state: 'failure', reason: 'bad_sig' });
        const { body, headers } = buildCompletedEvent();
        const req = makeReq({ method: 'POST', headers, body });
        const res = makeRes();
        await (0, webhook_1._paypalWebhookImpl)(req, res);
        expect(res.statusCode).toBe(401);
        expect(finalizeMock).not.toHaveBeenCalled();
        expect(docs.size).toBe(0);
        expect(loggerErrorMock).toHaveBeenCalledWith('paypal_webhook_signature_invalid', null, expect.objectContaining({ transmissionId: 'TX-1' }));
    });
    test('verifier returns verifier_unavailable → 503, no finalize, no Firestore writes', async () => {
        verifyMock.mockResolvedValue({
            state: 'verifier_unavailable',
            reason: 'http_503',
        });
        const { body, headers } = buildCompletedEvent();
        const req = makeReq({ method: 'POST', headers, body });
        const res = makeRes();
        await (0, webhook_1._paypalWebhookImpl)(req, res);
        expect(res.statusCode).toBe(503);
        expect(finalizeMock).not.toHaveBeenCalled();
        expect(docs.size).toBe(0);
        expect(loggerWarnMock).toHaveBeenCalledWith('paypal_webhook_verifier_unavailable', expect.objectContaining({ transmissionId: 'TX-1' }));
    });
});
// ---------------------------------------------------------------------------
// 4) Dedupe [C3]
// ---------------------------------------------------------------------------
describe('webhook — [C3] dedupe by transmissionId', () => {
    test('second delivery of same transmissionId is a no-op', async () => {
        verifyMock.mockResolvedValue({ state: 'success' });
        finalizeMock.mockResolvedValue({ status: 'finalized', purchaseId: 'CAP-XYZ' });
        seedOrder('ORD-ABC', {
            eventId: 'evt-1',
            slotId: 'slot-1',
            userId: 'user-1',
        });
        const { body, headers } = buildCompletedEvent({
            transmissionId: 'TX-DUP',
            orderId: 'ORD-ABC',
            customId: 'evt-1:slot-1:user-1',
            captureId: 'CAP-XYZ',
        });
        // First delivery.
        {
            const req = makeReq({ method: 'POST', headers, body });
            const res = makeRes();
            await (0, webhook_1._paypalWebhookImpl)(req, res);
            expect(res.statusCode).toBe(200);
        }
        expect(finalizeMock).toHaveBeenCalledTimes(1);
        expect(docs.get('webhookEvents/TX-DUP')).toBeDefined();
        // Second delivery (same transmissionId).
        {
            const req = makeReq({ method: 'POST', headers, body });
            const res = makeRes();
            await (0, webhook_1._paypalWebhookImpl)(req, res);
            expect(res.statusCode).toBe(200);
        }
        // finalize NOT called the second time.
        expect(finalizeMock).toHaveBeenCalledTimes(1);
    });
});
// ---------------------------------------------------------------------------
// 5) Body too large
// ---------------------------------------------------------------------------
describe('webhook — body size cap', () => {
    test('content-length > 50_000 → 413, verifier NOT called', async () => {
        verifyMock.mockResolvedValue({ state: 'success' });
        const { body, headers } = buildCompletedEvent();
        // Override content-length to a value beyond the cap.
        const headersOverride = Object.assign(Object.assign({}, headers), { 'content-length': '60000' });
        const req = makeReq({ method: 'POST', headers: headersOverride, body });
        const res = makeRes();
        await (0, webhook_1._paypalWebhookImpl)(req, res);
        expect(res.statusCode).toBe(413);
        expect(verifyMock).not.toHaveBeenCalled();
        expect(finalizeMock).not.toHaveBeenCalled();
        expect(loggerWarnMock).toHaveBeenCalledWith('paypal_webhook_pre_gate_failed', expect.objectContaining({ reason: 'body_too_large' }));
    });
});
//# sourceMappingURL=webhookCustomIdCheck.test.js.map