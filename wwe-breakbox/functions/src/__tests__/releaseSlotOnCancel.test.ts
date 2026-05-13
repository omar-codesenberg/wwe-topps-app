/// <reference types="jest" />
/// <reference types="node" />

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
  defineSecret: (name: string) => ({ name, value: () => `mocked-${name}` }),
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

// ----- In-memory Firestore mock --------------------------------------------

type DocStore = Map<string, Record<string, unknown> | undefined>;
const docs: DocStore = new Map();

interface MockDocSnap {
  id: string;
  exists: boolean;
  data: () => Record<string, unknown> | undefined;
}

interface MockTransaction {
  get: (ref: { _path: string }) => Promise<MockDocSnap>;
  update: (ref: { _path: string }, data: Record<string, unknown>) => void;
}

function snap(path: string): MockDocSnap {
  const data = docs.get(path);
  const id = path.split('/').pop() ?? '';
  return {
    id,
    exists: data !== undefined,
    data: () => data,
  };
}

interface QueryFilter {
  field: string;
  op: string;
  value: unknown;
}

function buildQuery(prefix: string, filters: QueryFilter[]) {
  return {
    where(field: string, op: string, value: unknown) {
      return buildQuery(prefix, [...filters, { field, op, value }]);
    },
    async get(): Promise<{
      forEach: (cb: (snap: MockDocSnap) => void) => void;
    }> {
      const matches: MockDocSnap[] = [];
      for (const [path, data] of docs.entries()) {
        if (!path.startsWith(`${prefix}/`)) continue;
        if (data === undefined) continue;
        const ok = filters.every((f) => {
          if (f.op !== '==') return false;
          return (data as Record<string, unknown>)[f.field] === f.value;
        });
        if (ok) {
          const id = path.split('/').pop() ?? '';
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
  collection: (col: string) => {
    const collRef = {
      doc: (id: string) => {
        const path = `${col}/${id}`;
        return {
          _path: path,
          get: async (): Promise<MockDocSnap> => snap(path),
          update: async (data: Record<string, unknown>): Promise<void> => {
            const existing = docs.get(path);
            if (existing === undefined) {
              throw new Error(`update on missing doc: ${path}`);
            }
            docs.set(path, { ...existing, ...data });
          },
          collection: (sub: string) => {
            const subPrefix = `${path}/${sub}`;
            return {
              doc: (subId: string) => {
                const subPath = `${subPrefix}/${subId}`;
                return {
                  _path: subPath,
                  get: async (): Promise<MockDocSnap> => snap(subPath),
                  update: async (data: Record<string, unknown>): Promise<void> => {
                    const existing = docs.get(subPath);
                    if (existing === undefined) {
                      throw new Error(`update on missing doc: ${subPath}`);
                    }
                    docs.set(subPath, { ...existing, ...data });
                  },
                };
              },
            };
          },
        };
      },
      where: (field: string, op: string, value: unknown) =>
        buildQuery(col, [{ field, op, value }]),
    };
    return collRef;
  },
  runTransaction: async <T>(
    fn: (txn: MockTransaction) => Promise<T>,
  ): Promise<T> => {
    const writes: Array<() => void> = [];
    const txn: MockTransaction = {
      get: async (ref) => snap(ref._path),
      update: (ref, data) => {
        writes.push(() => {
          const cur = docs.get(ref._path);
          if (cur === undefined) return;
          docs.set(ref._path, { ...cur, ...data });
        });
      },
    };
    const result = await fn(txn);
    for (const w of writes) w();
    return result;
  },
};

jest.mock('../utils/admin', () => ({
  db: dbMock,
  FieldValue: {
    serverTimestamp: () => ({ _serverTs: true }),
    increment: (n: number) => ({ _inc: n }),
  },
  Timestamp: {
    now: () => ({ _now: Date.now() }),
    fromDate: (d: Date) => ({ _fromDate: d.toISOString() }),
  },
}));

import { releaseSlotOnCancel } from '../releaseSlotOnCancel';
import { request as mockRequest } from '../paypal/client';
import * as loggerMod from '../utils/logger';

const requestMock = mockRequest as unknown as jest.Mock;
const warnMock = loggerMod.warn as unknown as jest.Mock;

const runFn = (releaseSlotOnCancel as unknown as {
  run: (data: unknown, context: unknown) => Promise<unknown>;
}).run;

beforeEach(() => {
  docs.clear();
  requestMock.mockReset();
  warnMock.mockReset();
});

// Convenience: locked slot owned by a given user.
function seedLockedSlot(eventId: string, slotId: string, ownerUid: string): void {
  docs.set(`events/${eventId}/slots/${slotId}`, {
    status: 'locked',
    lockedBy: ownerUid,
    lockedAt: { _serverTs: true },
    lockedUntil: { _now: Date.now() + 60_000 },
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

    await runFn(
      { eventId: 'EVT-1', slotId: 'SLOT-1' },
      { auth: { uid: 'USER-B' } },
    );

    // CRITICAL: A's order is untouched.
    const order = docs.get('paypalOrders/ORD-A');
    expect(order?.status).toBe('created');
    expect(order?.voidedAt).toBeUndefined();

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

    await runFn(
      { eventId: 'EVT-1', slotId: 'SLOT-1', orderId: 'ORD-A' },
      { auth: { uid: 'USER-B' } },
    );

    const order = docs.get('paypalOrders/ORD-A');
    expect(order?.status).toBe('created');
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

    const result = await runFn(
      { eventId: 'EVT-1', slotId: 'SLOT-1', orderId: 'USER-A-ORD' },
      { auth: { uid: 'USER-A' } },
    );

    expect(result).toEqual({ success: true });

    const order = docs.get('paypalOrders/USER-A-ORD');
    expect(order?.status).toBe('voided_by_user');
    expect(order?.voidedAt).toBeDefined();

    expect(requestMock).toHaveBeenCalledTimes(1);
    const [method, path] = requestMock.mock.calls[0];
    expect(method).toBe('POST');
    expect(path).toBe('/v2/checkout/orders/USER-A-ORD/void');

    // Slot lock released.
    const slot = docs.get('events/EVT-1/slots/SLOT-1');
    expect(slot?.status).toBe('available');
    expect(slot?.lockedBy).toBeNull();
  });

  test('owner cancels without orderId — query by (userId, slotId, status="created") finds + voids the open order', async () => {
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

    await runFn(
      { eventId: 'EVT-1', slotId: 'SLOT-1' },
      { auth: { uid: 'USER-A' } },
    );

    expect(docs.get('paypalOrders/AUTO-FOUND')?.status).toBe('voided_by_user');
    // Decoys untouched.
    expect(docs.get('paypalOrders/DECOY-OTHER-USER')?.status).toBe('created');
    expect(docs.get('paypalOrders/DECOY-CAPTURED')?.status).toBe('captured');

    // PayPal void called once for the matched order only.
    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(requestMock.mock.calls[0][1]).toBe(
      '/v2/checkout/orders/AUTO-FOUND/void',
    );
  });

  test('no matching paypalOrders — slot lock still released; no PayPal call; no paypalOrders write', async () => {
    seedLockedSlot('EVT-1', 'SLOT-1', 'USER-A');

    const result = await runFn(
      { eventId: 'EVT-1', slotId: 'SLOT-1' },
      { auth: { uid: 'USER-A' } },
    );

    expect(result).toEqual({ success: true });
    const slot = docs.get('events/EVT-1/slots/SLOT-1');
    expect(slot?.status).toBe('available');
    expect(slot?.lockedBy).toBeNull();

    expect(requestMock).not.toHaveBeenCalled();
    // No paypalOrders docs were touched (none existed).
    for (const key of docs.keys()) {
      expect(key.startsWith('paypalOrders/')).toBe(false);
    }
  });

  test('PayPal void network error — Firestore still flipped, warn logged, no throw, lock still released', async () => {
    seedLockedSlot('EVT-1', 'SLOT-1', 'USER-A');
    docs.set('paypalOrders/USER-A-ORD', {
      userId: 'USER-A',
      slotId: 'SLOT-1',
      status: 'created',
    });
    requestMock.mockRejectedValue(new Error('network down'));

    const result = await runFn(
      { eventId: 'EVT-1', slotId: 'SLOT-1', orderId: 'USER-A-ORD' },
      { auth: { uid: 'USER-A' } },
    );

    // Did NOT throw.
    expect(result).toEqual({ success: true });

    // Local status is the authoritative signal — flip succeeded.
    expect(docs.get('paypalOrders/USER-A-ORD')?.status).toBe('voided_by_user');

    // PayPal failure logged as warning (not error/throw).
    const warnEvents = warnMock.mock.calls.map((c) => c[0]);
    expect(warnEvents).toContain('paypal_void_failed');

    // Slot lock still released.
    const slot = docs.get('events/EVT-1/slots/SLOT-1');
    expect(slot?.status).toBe('available');
  });
});

describe('releaseSlotOnCancel — preserved behavior', () => {
  test('rejects unauthenticated callers', async () => {
    let caught: unknown;
    try {
      await runFn({ eventId: 'EVT-1', slotId: 'SLOT-1' }, {});
    } catch (e) {
      caught = e;
    }
    expect((caught as { code?: string } | undefined)?.code).toBe(
      'unauthenticated',
    );
  });

  test('rejects missing args', async () => {
    let caught: unknown;
    try {
      await runFn({ eventId: 'EVT-1' }, { auth: { uid: 'USER-A' } });
    } catch (e) {
      caught = e;
    }
    expect((caught as { code?: string } | undefined)?.code).toBe(
      'invalid-argument',
    );
  });

  test('caller without lock — no slot mutation, but call succeeds (preserved)', async () => {
    // Slot exists but locked by someone else.
    seedLockedSlot('EVT-1', 'SLOT-1', 'USER-OTHER');

    const result = await runFn(
      { eventId: 'EVT-1', slotId: 'SLOT-1' },
      { auth: { uid: 'USER-A' } },
    );
    expect(result).toEqual({ success: true });

    // Slot remains locked by USER-OTHER (existing logic — no-op release).
    const slot = docs.get('events/EVT-1/slots/SLOT-1');
    expect(slot?.status).toBe('locked');
    expect(slot?.lockedBy).toBe('USER-OTHER');
  });
});
