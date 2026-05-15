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
 * Tests for `createPayPalOrder` (P7) covering:
 *   [S1]  Stored expectedAmount = exact PayPal amount string.
 *   [S2]  Per-(uid, slotId) cap of 1 active order.
 *   [C6]  Cumulative lock-extension cap (extend on first call only).
 *   [C20] Account-level cap of 5 active orders → resource-exhausted.
 *   [S17] custom_id length cap (>127 chars rejected).
 *   [C2]  Server-authoritative pricing (slot.priceCents wins, ignore data.price).
 */
// PAYPAL_ENV must be set BEFORE the SUT loads (transitively imports config).
process.env.PAYPAL_ENV = 'sandbox';
// Mock firebase-functions/params before config.ts loads.
jest.mock('firebase-functions/params', () => ({
    defineSecret: (name) => ({ name, value: () => `mocked-${name}` }),
}));
// Mock the PayPal client. `request` is a jest.fn() the tests drive.
jest.mock('../paypal/client', () => ({
    request: jest.fn(),
}));
// Silence the structured logger. `restoreMocks: true` in jest.config.js wipes
// implementations between tests, so we (re)install in beforeEach below.
jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    withCorrelationId: jest.fn(),
}));
const docs = new Map();
function makeQuery(collectionPath, clauses, limit) {
    const exec = () => {
        const out = [];
        const prefix = `${collectionPath}/`;
        for (const [path, data] of docs.entries()) {
            if (!path.startsWith(prefix))
                continue;
            // Only direct children of the collection (skip subcollection docs).
            const rest = path.slice(prefix.length);
            if (rest.includes('/'))
                continue;
            const matches = clauses.every((c) => {
                const v = data[c.field];
                return v === c.value;
            });
            if (!matches)
                continue;
            out.push({
                id: rest,
                data: () => data,
                ref: makeDoc(collectionPath, rest),
            });
            if (limit !== undefined && out.length >= limit)
                break;
        }
        return Promise.resolve({
            empty: out.length === 0,
            size: out.length,
            docs: out,
        });
    };
    return {
        where(field, op, value) {
            return makeQuery(collectionPath, [...clauses, { field, op, value }], limit);
        },
        limit(n) {
            return makeQuery(collectionPath, clauses, n);
        },
        get: exec,
    };
}
function makeDoc(collectionPath, id) {
    const path = `${collectionPath}/${id}`;
    return {
        id,
        path,
        get: () => {
            const data = docs.get(path);
            return Promise.resolve({
                exists: data !== undefined,
                id,
                data: () => data,
            });
        },
        set: async (data, opts) => {
            var _a, _b;
            // Resolve FieldValue.increment markers to actual numbers when merging.
            const resolved = {};
            for (const [k, v] of Object.entries(data)) {
                if (v &&
                    typeof v === 'object' &&
                    v._increment !== undefined) {
                    const inc = Number(v._increment);
                    const prev = ((_a = docs.get(path)) !== null && _a !== void 0 ? _a : {})[k];
                    resolved[k] = (typeof prev === 'number' ? prev : 0) + inc;
                }
                else if (v &&
                    typeof v === 'object' &&
                    v._serverTs === true) {
                    resolved[k] = '__serverTs__';
                }
                else {
                    resolved[k] = v;
                }
            }
            if (opts === null || opts === void 0 ? void 0 : opts.merge) {
                docs.set(path, Object.assign(Object.assign({}, ((_b = docs.get(path)) !== null && _b !== void 0 ? _b : {})), resolved));
            }
            else {
                docs.set(path, resolved);
            }
        },
        update: async (data) => {
            const existing = docs.get(path);
            if (existing === undefined) {
                throw new Error(`update on missing doc: ${path}`);
            }
            docs.set(path, Object.assign(Object.assign({}, existing), data));
        },
        collection(sub) {
            return makeCollection(`${path}/${sub}`);
        },
    };
}
function makeCollection(name) {
    return {
        doc(id) {
            return makeDoc(name, id);
        },
        where(field, op, value) {
            return makeQuery(name, [{ field, op, value }]);
        },
    };
}
const dbMock = {
    collection: (name) => makeCollection(name),
};
jest.mock('../utils/admin', () => ({
    db: dbMock,
    FieldValue: {
        serverTimestamp: () => ({ _serverTs: true }),
        increment: (n) => ({ _increment: n }),
    },
    Timestamp: {
        now: () => ({ _now: Date.now() }),
        fromDate: (d) => ({
            _fromDate: d.toISOString(),
            toMillis: () => d.getTime(),
            toDate: () => d,
        }),
    },
}));
// ---------------------------------------------------------------------------
// Import SUT + mocks AFTER all jest.mock(...) registrations.
// ---------------------------------------------------------------------------
const createOrder_1 = require("../paypal/createOrder");
const client_1 = require("../paypal/client");
const loggerMod = __importStar(require("../utils/logger"));
const requestMock = client_1.request;
const withCorrelationIdMock = loggerMod.withCorrelationId;
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const UID = 'USER-A';
const EVENT_ID = 'EVT-1';
const SLOT_ID = 'SLOT-1';
function seedLockedSlot(opts = {}) {
    var _a, _b, _c;
    const eventId = (_a = opts.eventId) !== null && _a !== void 0 ? _a : EVENT_ID;
    const slotId = (_b = opts.slotId) !== null && _b !== void 0 ? _b : SLOT_ID;
    const lockedBy = opts.lockedBy === undefined ? UID : opts.lockedBy;
    const lockedUntilMs = (_c = opts.lockedUntilMs) !== null && _c !== void 0 ? _c : Date.now() + 60000;
    // Allow callers to explicitly set priceCents to undefined by checking
    // own-property presence rather than `=== undefined`.
    const hasPrice = Object.prototype.hasOwnProperty.call(opts, 'priceCents');
    const priceCents = hasPrice ? opts.priceCents : 2500;
    const path = `events/${eventId}/slots/${slotId}`;
    const date = new Date(lockedUntilMs);
    const slotDoc = {
        status: 'locked',
        lockedBy,
        lockedUntil: {
            toMillis: () => date.getTime(),
            toDate: () => date,
        },
    };
    if (priceCents !== undefined) {
        slotDoc.priceCents = priceCents;
    }
    docs.set(path, slotDoc);
}
function seedPaypalOrder(orderId, fields) {
    var _a, _b, _c, _d, _e;
    docs.set(`paypalOrders/${orderId}`, {
        orderId,
        userId: (_a = fields.userId) !== null && _a !== void 0 ? _a : UID,
        slotId: (_b = fields.slotId) !== null && _b !== void 0 ? _b : SLOT_ID,
        eventId: (_c = fields.eventId) !== null && _c !== void 0 ? _c : EVENT_ID,
        status: (_d = fields.status) !== null && _d !== void 0 ? _d : 'created',
        approveUrl: (_e = fields.approveUrl) !== null && _e !== void 0 ? _e : 'https://paypal.example/approve',
        correlationId: 'pre-corr',
    });
}
function makePayPalResponse(orderId = 'PP-ORD-1') {
    return {
        id: orderId,
        status: 'CREATED',
        links: [
            { rel: 'self', href: 'https://api/orders/x', method: 'GET' },
            {
                rel: 'approve',
                href: `https://www.paypal.com/checkoutnow?token=${orderId}`,
                method: 'GET',
            },
            { rel: 'capture', href: 'https://api/capture', method: 'POST' },
        ],
    };
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
// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('createPayPalOrder — auth', () => {
    test('throws unauthenticated when context.auth is missing', async () => {
        seedLockedSlot();
        await expect((0, createOrder_1._createPayPalOrderImpl)({ eventId: EVENT_ID, slotId: SLOT_ID }, { auth: null })).rejects.toMatchObject({ code: 'unauthenticated' });
        expect(requestMock).not.toHaveBeenCalled();
    });
    test('throws invalid-argument when eventId/slotId missing', async () => {
        seedLockedSlot();
        await expect((0, createOrder_1._createPayPalOrderImpl)({}, { auth: { uid: UID } })).rejects.toMatchObject({ code: 'invalid-argument' });
        expect(requestMock).not.toHaveBeenCalled();
    });
});
describe('createPayPalOrder — [C2] server-authoritative pricing', () => {
    test('amount is derived from slot.priceCents, ignoring client-supplied price', async () => {
        seedLockedSlot({ priceCents: 2500 });
        requestMock.mockResolvedValue(makePayPalResponse('PP-1'));
        await (0, createOrder_1._createPayPalOrderImpl)(
        // Inject a hostile client-supplied `price` field — must be ignored.
        { eventId: EVENT_ID, slotId: SLOT_ID, price: 99999 }, { auth: { uid: UID } });
        expect(requestMock).toHaveBeenCalledTimes(1);
        const [, , body] = requestMock.mock.calls[0];
        expect(body.purchase_units[0].amount).toEqual({
            currency_code: 'CAD',
            value: '25.00',
        });
    });
});
describe('createPayPalOrder — [S1] integer cent → string formatting', () => {
    const cases = [
        [10, '0.10'],
        [100, '1.00'],
        [1010, '10.10'],
        [99995, '999.95'],
        [1000000, '10000.00'],
    ];
    for (const [priceCents, expected] of cases) {
        test(`priceCents=${priceCents} → "${expected}"`, async () => {
            seedLockedSlot({ priceCents });
            requestMock.mockResolvedValue(makePayPalResponse(`PP-${priceCents}`));
            await (0, createOrder_1._createPayPalOrderImpl)({ eventId: EVENT_ID, slotId: SLOT_ID }, { auth: { uid: UID } });
            const [, , body] = requestMock.mock.calls[0];
            // String equality — never "10.1".
            expect(body.purchase_units[0].amount.value).toBe(expected);
            // [S1] Stored expectedAmount must equal the EXACT outbound string.
            const stored = docs.get(`paypalOrders/PP-${priceCents}`);
            expect(stored.expectedAmount).toBe(expected);
        });
    }
});
describe('createPayPalOrder — lock validation', () => {
    test('lockedBy other user → throws, no PayPal call', async () => {
        seedLockedSlot({ lockedBy: 'OTHER_USER' });
        await expect((0, createOrder_1._createPayPalOrderImpl)({ eventId: EVENT_ID, slotId: SLOT_ID }, { auth: { uid: UID } })).rejects.toMatchObject({ code: 'failed-precondition' });
        expect(requestMock).not.toHaveBeenCalled();
    });
    test('lockedUntil in past → throws, no PayPal call', async () => {
        seedLockedSlot({ lockedUntilMs: Date.now() - 1000 });
        await expect((0, createOrder_1._createPayPalOrderImpl)({ eventId: EVENT_ID, slotId: SLOT_ID }, { auth: { uid: UID } })).rejects.toMatchObject({ code: 'failed-precondition' });
        expect(requestMock).not.toHaveBeenCalled();
    });
});
describe('createPayPalOrder — [S2] per-(uid, slotId) cap of 1', () => {
    test('returns existing order with alreadyOpen:true; no new PayPal call', async () => {
        seedLockedSlot();
        seedPaypalOrder('PRE-1', {
            userId: UID,
            slotId: SLOT_ID,
            status: 'created',
            approveUrl: 'https://paypal.example/approve/PRE-1',
        });
        const result = await (0, createOrder_1._createPayPalOrderImpl)({ eventId: EVENT_ID, slotId: SLOT_ID }, { auth: { uid: UID } });
        expect(result).toMatchObject({
            orderId: 'PRE-1',
            approveUrl: 'https://paypal.example/approve/PRE-1',
            alreadyOpen: true,
        });
        expect(requestMock).not.toHaveBeenCalled();
    });
});
describe('createPayPalOrder — [C20] account-level cap of 5', () => {
    test('6th active order throws resource-exhausted; no PayPal call', async () => {
        seedLockedSlot();
        // Pre-populate 5 active orders for the same user, all on different slots.
        for (let i = 0; i < 5; i++) {
            seedPaypalOrder(`OTHER-${i}`, {
                userId: UID,
                slotId: `OTHER-SLOT-${i}`,
                status: 'created',
            });
        }
        await expect((0, createOrder_1._createPayPalOrderImpl)({ eventId: EVENT_ID, slotId: SLOT_ID }, { auth: { uid: UID } })).rejects.toMatchObject({
            code: 'resource-exhausted',
            message: 'RATE_LIMITED',
        });
        expect(requestMock).not.toHaveBeenCalled();
    });
});
describe('createPayPalOrder — [C6] cumulative lock-extension cap', () => {
    test('first call extends lock; second call (with prior order doc) does not', async () => {
        const originalLockMs = Date.now() + 60000; // 1 min from now
        seedLockedSlot({ lockedUntilMs: originalLockMs });
        requestMock.mockResolvedValue(makePayPalResponse('PP-EXT-1'));
        // First call.
        await (0, createOrder_1._createPayPalOrderImpl)({ eventId: EVENT_ID, slotId: SLOT_ID }, { auth: { uid: UID } });
        const slotAfterFirst = docs.get(`events/${EVENT_ID}/slots/${SLOT_ID}`);
        const lockedUntilAfterFirst = slotAfterFirst.lockedUntil;
        // The lock should have been pushed out — strictly later than the original.
        const newMs = typeof lockedUntilAfterFirst.toMillis === 'function'
            ? lockedUntilAfterFirst.toMillis()
            : new Date(String(lockedUntilAfterFirst._fromDate)).getTime();
        expect(newMs).toBeGreaterThan(originalLockMs);
        // And it should be capped at min(now + 5min, original + 10min).
        const expectedCap = Math.min(Date.now() + 5 * 60000, originalLockMs + 10 * 60000);
        // Allow a 5s wallclock fudge (since Date.now() is read again inside).
        expect(newMs).toBeLessThanOrEqual(expectedCap + 5000);
        // Manually inject a "previous" order doc to simulate what would happen
        // if the FIRST call's order was cancelled (status != 'created'). This
        // ensures the ANY-prior-doc check (not just status==created) blocks
        // re-extension. We seed it as 'cancelled' so it's not the S2 short-circuit.
        docs.set('paypalOrders/PRIOR-CANCELLED', {
            orderId: 'PRIOR-CANCELLED',
            userId: UID,
            slotId: SLOT_ID,
            eventId: EVENT_ID,
            status: 'cancelled',
        });
        // Also delete the just-created PP-EXT-1 so S2 doesn't short-circuit.
        docs.delete('paypalOrders/PP-EXT-1');
        // Capture lock state right before the second call.
        const lockBeforeSecond = newMs;
        requestMock.mockResolvedValue(makePayPalResponse('PP-EXT-2'));
        await (0, createOrder_1._createPayPalOrderImpl)({ eventId: EVENT_ID, slotId: SLOT_ID }, { auth: { uid: UID } });
        const slotAfterSecond = docs.get(`events/${EVENT_ID}/slots/${SLOT_ID}`);
        const lockedUntilAfterSecond = slotAfterSecond.lockedUntil;
        const msAfterSecond = typeof lockedUntilAfterSecond.toMillis === 'function'
            ? lockedUntilAfterSecond.toMillis()
            : new Date(String(lockedUntilAfterSecond._fromDate)).getTime();
        // Second call must NOT have re-extended the lock.
        expect(msAfterSecond).toBe(lockBeforeSecond);
    });
});
describe('createPayPalOrder — [S17] custom_id length cap', () => {
    test('custom_id of 128 chars throws at construction; no PayPal call', async () => {
        // Build eventId+slotId+uid (with two ":" separators) of exactly 128 chars.
        // 128 - 2 separators = 126 chars across the three fields.
        const eventId = 'E'.repeat(42);
        const slotId = 'S'.repeat(42);
        const uid = 'U'.repeat(42);
        const customId = `${eventId}:${slotId}:${uid}`;
        expect(customId.length).toBe(128);
        seedLockedSlot({ eventId, slotId, lockedBy: uid });
        await expect((0, createOrder_1._createPayPalOrderImpl)({ eventId, slotId }, { auth: { uid } })).rejects.toMatchObject({ code: 'invalid-argument' });
        expect(requestMock).not.toHaveBeenCalled();
    });
    test('custom_id of 127 chars is accepted', async () => {
        const eventId = 'E'.repeat(42);
        const slotId = 'S'.repeat(42);
        const uid = 'U'.repeat(41);
        const customId = `${eventId}:${slotId}:${uid}`;
        expect(customId.length).toBe(127);
        seedLockedSlot({ eventId, slotId, lockedBy: uid });
        requestMock.mockResolvedValue(makePayPalResponse('PP-CID-OK'));
        await expect((0, createOrder_1._createPayPalOrderImpl)({ eventId, slotId }, { auth: { uid } })).resolves.toMatchObject({ orderId: 'PP-CID-OK' });
    });
});
describe('createPayPalOrder — invalid priceCents', () => {
    const bad = [
        ['negative', -100],
        ['zero', 0],
        ['non-integer', 12.5],
        ['missing', undefined],
        ['string', '2500'],
    ];
    for (const [label, value] of bad) {
        test(`priceCents=${label} → failed-precondition, no PayPal call`, async () => {
            seedLockedSlot({ priceCents: value });
            await expect((0, createOrder_1._createPayPalOrderImpl)({ eventId: EVENT_ID, slotId: SLOT_ID }, { auth: { uid: UID } })).rejects.toMatchObject({ code: 'failed-precondition' });
            expect(requestMock).not.toHaveBeenCalled();
        });
    }
});
describe('createPayPalOrder — successful response shape', () => {
    test('returns { orderId, approveUrl, correlationId } and writes paypalOrders doc', async () => {
        seedLockedSlot({ priceCents: 2500 });
        const approveHref = 'https://www.paypal.com/checkoutnow?token=PP-OK-1';
        requestMock.mockResolvedValue({
            id: 'PP-OK-1',
            status: 'CREATED',
            links: [
                { rel: 'self', href: 'https://api/x', method: 'GET' },
                { rel: 'approve', href: approveHref, method: 'GET' },
            ],
        });
        const result = await (0, createOrder_1._createPayPalOrderImpl)({ eventId: EVENT_ID, slotId: SLOT_ID }, { auth: { uid: UID } });
        expect(result.orderId).toBe('PP-OK-1');
        expect(result.approveUrl).toBe(approveHref);
        expect(typeof result.correlationId).toBe('string');
        expect(result.correlationId.length).toBeGreaterThan(0);
        expect(result).not.toHaveProperty('alreadyOpen');
        // Persisted doc.
        const stored = docs.get('paypalOrders/PP-OK-1');
        expect(stored).toMatchObject({
            orderId: 'PP-OK-1',
            userId: UID,
            eventId: EVENT_ID,
            slotId: SLOT_ID,
            status: 'created',
            // [S1] EXACT outbound amount string.
            expectedAmount: '25.00',
            currency: 'CAD',
            correlationId: result.correlationId,
            approveUrl: approveHref,
        });
        // PayPal call shape.
        const [method, path, body, opts] = requestMock.mock.calls[0];
        expect(method).toBe('POST');
        expect(path).toBe('/v2/checkout/orders');
        expect(body).toMatchObject({
            intent: 'CAPTURE',
            purchase_units: [
                {
                    custom_id: `${EVENT_ID}:${SLOT_ID}:${UID}`,
                    amount: { currency_code: 'CAD', value: '25.00' },
                },
            ],
            application_context: {
                return_url: 'wwebreakbox://paypal/return',
                cancel_url: 'wwebreakbox://paypal/cancel',
                brand_name: 'WWE Breakbox',
                user_action: 'PAY_NOW',
                shipping_preference: 'NO_SHIPPING',
            },
        });
        // requestId encodes (slotId, uid, lockedUntilMs) for PayPal idempotency.
        expect(typeof opts.requestId).toBe('string');
        expect(opts.requestId.startsWith(`${SLOT_ID}:${UID}:`)).toBe(true);
        expect(opts.correlationId).toBe(result.correlationId);
        expect(typeof opts.project).toBe('function');
    });
});
//# sourceMappingURL=createOrder.test.js.map