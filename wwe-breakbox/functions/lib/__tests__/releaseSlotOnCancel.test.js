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
 * [#5 / S14 / C5] releaseSlotOnCancel — defensive PayPal-void behavior.
 *
 * Verifies:
 *   1. [S14 CRITICAL] User B calling release for a slot whose open paypalOrders
 *      doc belongs to user A MUST NOT void user A's order. Cross-user voids
 *      are the attack we're defending against.
 *   2. Owner cancels with explicit `orderId` — Firestore doc flips to
 *      `voided_by_user`, PayPal void IS attempted.
 *   3. Owner cancels without `orderId` — query by (userId, slotId,
 *      status='created') still finds the open order and voids it.
 *   4. No matching paypalOrders — slot lock is still released, no PayPal
 *      call, no Firestore write to paypalOrders.
 *   5. PayPal void network error — Firestore status still flipped, error
 *      logged as warning (NOT thrown), slot lock still released.
 */
process.env.PAYPAL_ENV = 'sandbox';
jest.mock('firebase-functions/params', () => ({
    defineSecret: (name) => ({ name, value: () => `mocked-${name}` }),
}));
jest.mock('../paypal/client', () => ({
    request: jest.fn(),
}));
jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    withCorrelationId: jest.fn(),
}));
const docs = new Map();
function snap(path) {
    var _a;
    const data = docs.get(path);
    const id = (_a = path.split('/').pop()) !== null && _a !== void 0 ? _a : '';
    return {
        id,
        exists: data !== undefined,
        data: () => data,
    };
}
function buildQuery(prefix, filters) {
    return {
        where(field, op, value) {
            return buildQuery(prefix, [...filters, { field, op, value }]);
        },
        async get() {
            var _a;
            const matches = [];
            for (const [path, data] of docs.entries()) {
                if (!path.startsWith(`${prefix}/`))
                    continue;
                if (data === undefined)
                    continue;
                const ok = filters.every((f) => {
                    if (f.op !== '==')
                        return false;
                    return data[f.field] === f.value;
                });
                if (ok) {
                    const id = (_a = path.split('/').pop()) !== null && _a !== void 0 ? _a : '';
                    matches.push({
                        id,
                        exists: true,
                        data: () => data,
                    });
                }
            }
            return {
                forEach: (cb) => matches.forEach(cb),
            };
        },
    };
}
const dbMock = {
    collection: (col) => {
        const collRef = {
            doc: (id) => {
                const path = `${col}/${id}`;
                return {
                    _path: path,
                    get: async () => snap(path),
                    update: async (data) => {
                        const existing = docs.get(path);
                        if (existing === undefined) {
                            throw new Error(`update on missing doc: ${path}`);
                        }
                        docs.set(path, Object.assign(Object.assign({}, existing), data));
                    },
                    collection: (sub) => {
                        const subPrefix = `${path}/${sub}`;
                        return {
                            doc: (subId) => {
                                const subPath = `${subPrefix}/${subId}`;
                                return {
                                    _path: subPath,
                                    get: async () => snap(subPath),
                                    update: async (data) => {
                                        const existing = docs.get(subPath);
                                        if (existing === undefined) {
                                            throw new Error(`update on missing doc: ${subPath}`);
                                        }
                                        docs.set(subPath, Object.assign(Object.assign({}, existing), data));
                                    },
                                };
                            },
                        };
                    },
                };
            },
            where: (field, op, value) => buildQuery(col, [{ field, op, value }]),
        };
        return collRef;
    },
    runTransaction: async (fn) => {
        const writes = [];
        const txn = {
            get: async (ref) => snap(ref._path),
            update: (ref, data) => {
                writes.push(() => {
                    const cur = docs.get(ref._path);
                    if (cur === undefined)
                        return;
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
const releaseSlotOnCancel_1 = require("../releaseSlotOnCancel");
const client_1 = require("../paypal/client");
const loggerMod = __importStar(require("../utils/logger"));
const requestMock = client_1.request;
const warnMock = loggerMod.warn;
const runFn = releaseSlotOnCancel_1.releaseSlotOnCancel.run;
beforeEach(() => {
    docs.clear();
    requestMock.mockReset();
    warnMock.mockReset();
});
// Convenience: locked slot owned by a given user.
function seedLockedSlot(eventId, slotId, ownerUid) {
    docs.set(`events/${eventId}/slots/${slotId}`, {
        status: 'locked',
        lockedBy: ownerUid,
        lockedAt: { _serverTs: true },
        lockedUntil: { _now: Date.now() + 60000 },
    });
}
describe('releaseSlotOnCancel — [S14] cross-user void defense', () => {
    test('user B canceling A\'s slot does NOT void A\'s open paypalOrders doc', async () => {
        seedLockedSlot('EVT-1', 'SLOT-1', 'USER-A');
        docs.set('paypalOrders/ORD-A', {
            userId: 'USER-A',
            slotId: 'SLOT-1',
            status: 'created',
        });
        requestMock.mockResolvedValue({});
        await runFn({ eventId: 'EVT-1', slotId: 'SLOT-1' }, { auth: { uid: 'USER-B' } });
        // CRITICAL: A's order is untouched.
        const order = docs.get('paypalOrders/ORD-A');
        expect(order === null || order === void 0 ? void 0 : order.status).toBe('created');
        expect(order === null || order === void 0 ? void 0 : order.voidedAt).toBeUndefined();
        // No PayPal call to void anything.
        expect(requestMock).not.toHaveBeenCalled();
    });
    test('user B explicitly passes A\'s orderId — defense-in-depth still rejects', async () => {
        seedLockedSlot('EVT-1', 'SLOT-1', 'USER-A');
        docs.set('paypalOrders/ORD-A', {
            userId: 'USER-A',
            slotId: 'SLOT-1',
            status: 'created',
        });
        requestMock.mockResolvedValue({});
        await runFn({ eventId: 'EVT-1', slotId: 'SLOT-1', orderId: 'ORD-A' }, { auth: { uid: 'USER-B' } });
        const order = docs.get('paypalOrders/ORD-A');
        expect(order === null || order === void 0 ? void 0 : order.status).toBe('created');
        expect(requestMock).not.toHaveBeenCalled();
    });
});
describe('releaseSlotOnCancel — owner cancel paths', () => {
    test('owner cancels with explicit orderId — doc voided, PayPal void called', async () => {
        seedLockedSlot('EVT-1', 'SLOT-1', 'USER-A');
        docs.set('paypalOrders/USER-A-ORD', {
            userId: 'USER-A',
            slotId: 'SLOT-1',
            status: 'created',
        });
        requestMock.mockResolvedValue({});
        const result = await runFn({ eventId: 'EVT-1', slotId: 'SLOT-1', orderId: 'USER-A-ORD' }, { auth: { uid: 'USER-A' } });
        expect(result).toEqual({ success: true });
        const order = docs.get('paypalOrders/USER-A-ORD');
        expect(order === null || order === void 0 ? void 0 : order.status).toBe('voided_by_user');
        expect(order === null || order === void 0 ? void 0 : order.voidedAt).toBeDefined();
        expect(requestMock).toHaveBeenCalledTimes(1);
        const [method, path] = requestMock.mock.calls[0];
        expect(method).toBe('POST');
        expect(path).toBe('/v2/checkout/orders/USER-A-ORD/void');
        // Slot lock released.
        const slot = docs.get('events/EVT-1/slots/SLOT-1');
        expect(slot === null || slot === void 0 ? void 0 : slot.status).toBe('available');
        expect(slot === null || slot === void 0 ? void 0 : slot.lockedBy).toBeNull();
    });
    test('owner cancels without orderId — query by (userId, slotId, status="created") finds + voids the open order', async () => {
        var _a, _b, _c;
        seedLockedSlot('EVT-1', 'SLOT-1', 'USER-A');
        docs.set('paypalOrders/AUTO-FOUND', {
            userId: 'USER-A',
            slotId: 'SLOT-1',
            status: 'created',
        });
        // Decoy: a different user's open order on the same slot — must NOT match.
        docs.set('paypalOrders/DECOY-OTHER-USER', {
            userId: 'USER-B',
            slotId: 'SLOT-1',
            status: 'created',
        });
        // Decoy: this user's already-captured order — must NOT match (status filter).
        docs.set('paypalOrders/DECOY-CAPTURED', {
            userId: 'USER-A',
            slotId: 'SLOT-1',
            status: 'captured',
        });
        requestMock.mockResolvedValue({});
        await runFn({ eventId: 'EVT-1', slotId: 'SLOT-1' }, { auth: { uid: 'USER-A' } });
        expect((_a = docs.get('paypalOrders/AUTO-FOUND')) === null || _a === void 0 ? void 0 : _a.status).toBe('voided_by_user');
        // Decoys untouched.
        expect((_b = docs.get('paypalOrders/DECOY-OTHER-USER')) === null || _b === void 0 ? void 0 : _b.status).toBe('created');
        expect((_c = docs.get('paypalOrders/DECOY-CAPTURED')) === null || _c === void 0 ? void 0 : _c.status).toBe('captured');
        // PayPal void called once for the matched order only.
        expect(requestMock).toHaveBeenCalledTimes(1);
        expect(requestMock.mock.calls[0][1]).toBe('/v2/checkout/orders/AUTO-FOUND/void');
    });
    test('no matching paypalOrders — slot lock still released; no PayPal call; no paypalOrders write', async () => {
        seedLockedSlot('EVT-1', 'SLOT-1', 'USER-A');
        const result = await runFn({ eventId: 'EVT-1', slotId: 'SLOT-1' }, { auth: { uid: 'USER-A' } });
        expect(result).toEqual({ success: true });
        const slot = docs.get('events/EVT-1/slots/SLOT-1');
        expect(slot === null || slot === void 0 ? void 0 : slot.status).toBe('available');
        expect(slot === null || slot === void 0 ? void 0 : slot.lockedBy).toBeNull();
        expect(requestMock).not.toHaveBeenCalled();
        // No paypalOrders docs were touched (none existed).
        for (const key of docs.keys()) {
            expect(key.startsWith('paypalOrders/')).toBe(false);
        }
    });
    test('PayPal void network error — Firestore still flipped, warn logged, no throw, lock still released', async () => {
        var _a;
        seedLockedSlot('EVT-1', 'SLOT-1', 'USER-A');
        docs.set('paypalOrders/USER-A-ORD', {
            userId: 'USER-A',
            slotId: 'SLOT-1',
            status: 'created',
        });
        requestMock.mockRejectedValue(new Error('network down'));
        const result = await runFn({ eventId: 'EVT-1', slotId: 'SLOT-1', orderId: 'USER-A-ORD' }, { auth: { uid: 'USER-A' } });
        // Did NOT throw.
        expect(result).toEqual({ success: true });
        // Local status is the authoritative signal — flip succeeded.
        expect((_a = docs.get('paypalOrders/USER-A-ORD')) === null || _a === void 0 ? void 0 : _a.status).toBe('voided_by_user');
        // PayPal failure logged as warning (not error/throw).
        const warnEvents = warnMock.mock.calls.map((c) => c[0]);
        expect(warnEvents).toContain('paypal_void_failed');
        // Slot lock still released.
        const slot = docs.get('events/EVT-1/slots/SLOT-1');
        expect(slot === null || slot === void 0 ? void 0 : slot.status).toBe('available');
    });
});
describe('releaseSlotOnCancel — preserved behavior', () => {
    test('rejects unauthenticated callers', async () => {
        let caught;
        try {
            await runFn({ eventId: 'EVT-1', slotId: 'SLOT-1' }, {});
        }
        catch (e) {
            caught = e;
        }
        expect(caught === null || caught === void 0 ? void 0 : caught.code).toBe('unauthenticated');
    });
    test('rejects missing args', async () => {
        let caught;
        try {
            await runFn({ eventId: 'EVT-1' }, { auth: { uid: 'USER-A' } });
        }
        catch (e) {
            caught = e;
        }
        expect(caught === null || caught === void 0 ? void 0 : caught.code).toBe('invalid-argument');
    });
    test('caller without lock — no slot mutation, but call succeeds (preserved)', async () => {
        // Slot exists but locked by someone else.
        seedLockedSlot('EVT-1', 'SLOT-1', 'USER-OTHER');
        const result = await runFn({ eventId: 'EVT-1', slotId: 'SLOT-1' }, { auth: { uid: 'USER-A' } });
        expect(result).toEqual({ success: true });
        // Slot remains locked by USER-OTHER (existing logic — no-op release).
        const slot = docs.get('events/EVT-1/slots/SLOT-1');
        expect(slot === null || slot === void 0 ? void 0 : slot.status).toBe('locked');
        expect(slot === null || slot === void 0 ? void 0 : slot.lockedBy).toBe('USER-OTHER');
    });
});
//# sourceMappingURL=releaseSlotOnCancel.test.js.map