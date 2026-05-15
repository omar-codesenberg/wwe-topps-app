/// <reference types="jest" />
/// <reference types="node" />

/**
 * Tests for finalizeSlotPurchase (B1) — covers C15 (caller-owned tx) and S10
 * (decision-lock against pendingRefunds/{captureId} and purchases/{captureId}).
 */

import type { Transaction } from 'firebase-admin/firestore';

const FAKE_NOW_MS = 1_700_000_000_000;
const FAKE_FUTURE_MS = FAKE_NOW_MS + 60_000;
const FAKE_PAST_MS = FAKE_NOW_MS - 60_000;

function fakeTimestamp(ms: number) {
  return { toDate: () => new Date(ms) };
}

interface DocRef {
  path: string;
}

class MockTx {
  reads: Record<string, unknown> = {};
  writes: Record<string, unknown> = {};
  updates: Record<string, unknown> = {};

  constructor(initial: Record<string, unknown> = {}) {
    this.reads = { ...initial };
  }

  get(ref: DocRef) {
    const data = this.reads[ref.path];
    return Promise.resolve({
      exists: data !== undefined,
      data: () => data,
      ref,
    });
  }

  set(ref: DocRef, data: unknown) {
    this.writes[ref.path] = data;
  }

  update(ref: DocRef, data: unknown) {
    const prev = (this.updates[ref.path] as Record<string, unknown>) ?? {};
    this.updates[ref.path] = { ...prev, ...(data as Record<string, unknown>) };
  }
}

// Mock the admin module so we control db.collection().doc() ref construction
// and avoid initializing the Firebase Admin SDK in tests.
jest.mock('../utils/admin', () => {
  const FieldValue = {
    serverTimestamp: () => '__serverTimestamp__',
    increment: (n: number) => ({ __increment: n }),
  };

  function makeRef(path: string) {
    return {
      path,
      collection: (name: string) => makeCollection(`${path}/${name}`),
    };
  }
  function makeCollection(path: string) {
    return {
      doc: (id: string) => makeRef(`${path}/${id}`),
    };
  }
  const db = {
    collection: (name: string) => makeCollection(name),
  };
  return { db, FieldValue, Timestamp: { now: () => ({ _now: Date.now() }) } };
});

let finalize: typeof import('../purchases/finalizeSlotPurchase').finalize;

beforeAll(() => {
  ({ finalize } = require('../purchases/finalizeSlotPurchase'));
});

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(FAKE_NOW_MS);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const baseArgs = {
  captureId: 'CAP-1',
  orderId: 'ORD-1',
  eventId: 'EVT-1',
  slotId: 'SLOT-1',
  userId: 'USER-A',
  amountCents: 2500,
  correlationId: 'corr-1',
  paypalEnv: 'sandbox' as const,
};

const purchasePath = 'purchases/CAP-1';
const pendingRefundPath = 'pendingRefunds/CAP-1';
const slotPath = 'events/EVT-1/slots/SLOT-1';
const eventPath = 'events/EVT-1';
const userPath = 'users/USER-A';

function lockedSlot(userId = 'USER-A', untilMs = FAKE_FUTURE_MS) {
  return {
    status: 'locked',
    lockedBy: userId,
    lockedUntil: fakeTimestamp(untilMs),
    wrestlerName: 'Stone Cold',
    brand: 'WWE',
    tier: 'Gold',
    priceCents: 2500,
  };
}

function eventDoc(soldSlots = 0, totalSlots = 100) {
  return { title: 'WrestleMania', soldSlots, totalSlots };
}

describe('finalize() — idempotency [C15]', () => {
  test('second finalize with same captureId returns already_finalized (no writes)', async () => {
    const tx = new MockTx({
      [purchasePath]: { id: 'CAP-1', userId: 'USER-A' },
    });
    const result = await finalize(tx as unknown as Transaction, baseArgs);
    expect(result).toEqual({ status: 'already_finalized', purchaseId: 'CAP-1' });
    expect(tx.writes[purchasePath]).toBeUndefined();
    expect(tx.updates[slotPath]).toBeUndefined();
  });
});

describe('finalize() — decision-lock [S10]', () => {
  test('pendingRefunds.status = "requested" blocks finalize', async () => {
    const tx = new MockTx({
      [pendingRefundPath]: { status: 'requested' },
      [slotPath]: lockedSlot(),
      [eventPath]: eventDoc(),
    });
    const result = await finalize(tx as unknown as Transaction, baseArgs);
    expect(result).toEqual({ status: 'refund_decided' });
    expect(tx.writes[purchasePath]).toBeUndefined();
  });

  test('pendingRefunds.status = "in_flight" blocks finalize', async () => {
    const tx = new MockTx({
      [pendingRefundPath]: { status: 'in_flight' },
      [slotPath]: lockedSlot(),
      [eventPath]: eventDoc(),
    });
    const result = await finalize(tx as unknown as Transaction, baseArgs);
    expect(result.status).toBe('refund_decided');
  });

  test('pendingRefunds.status = "completed" blocks finalize', async () => {
    const tx = new MockTx({
      [pendingRefundPath]: { status: 'completed' },
      [slotPath]: lockedSlot(),
      [eventPath]: eventDoc(),
    });
    const result = await finalize(tx as unknown as Transaction, baseArgs);
    expect(result.status).toBe('refund_decided');
  });

  test('pendingRefunds.status = "alert_required" blocks finalize', async () => {
    const tx = new MockTx({
      [pendingRefundPath]: { status: 'alert_required' },
      [slotPath]: lockedSlot(),
      [eventPath]: eventDoc(),
    });
    const result = await finalize(tx as unknown as Transaction, baseArgs);
    expect(result.status).toBe('refund_decided');
  });

  test('pendingRefunds.status = "failed_will_retry" does NOT block finalize (recovery)', async () => {
    const tx = new MockTx({
      [pendingRefundPath]: { status: 'failed_will_retry' },
      [slotPath]: lockedSlot(),
      [eventPath]: eventDoc(),
    });
    const result = await finalize(tx as unknown as Transaction, baseArgs);
    expect(result.status).toBe('finalized');
    expect(tx.writes[purchasePath]).toBeDefined();
  });
});

describe('finalize() — happy path', () => {
  test('locked slot owned by user, lock not expired → finalize succeeds', async () => {
    const tx = new MockTx({
      [slotPath]: lockedSlot(),
      [eventPath]: eventDoc(),
    });
    const result = await finalize(tx as unknown as Transaction, baseArgs);
    expect(result).toEqual({ status: 'finalized', purchaseId: 'CAP-1' });

    const purchase = tx.writes[purchasePath] as Record<string, unknown>;
    expect(purchase).toMatchObject({
      id: 'CAP-1',
      userId: 'USER-A',
      eventId: 'EVT-1',
      slotId: 'SLOT-1',
      priceCents: 2500,
      captureId: 'CAP-1',
      paypalOrderId: 'ORD-1',
      paypalEnv: 'sandbox',
      correlationId: 'corr-1',
    });
    // Ensure no payer PII fields
    expect(purchase).not.toHaveProperty('payer');
    expect(purchase).not.toHaveProperty('payerEmail');

    expect(tx.updates[slotPath]).toMatchObject({
      status: 'sold',
      purchasedBy: 'USER-A',
      lockedBy: null,
    });
    expect(tx.updates[eventPath]).toMatchObject({
      soldSlots: { __increment: 1 },
    });
    expect(tx.updates[userPath]).toMatchObject({
      purchaseCount: { __increment: 1 },
    });
  });

  test('event closes when last slot sells', async () => {
    const tx = new MockTx({
      [slotPath]: lockedSlot(),
      [eventPath]: eventDoc(99, 100),
    });
    const result = await finalize(tx as unknown as Transaction, baseArgs);
    expect(result.status).toBe('finalized');
    expect(tx.updates[eventPath]).toMatchObject({ status: 'closed' });
  });
});

describe('finalize() — race outcomes', () => {
  test('slot already sold to another user → already_sold_other', async () => {
    const tx = new MockTx({
      [slotPath]: { status: 'sold', purchasedBy: 'USER-B' },
      [eventPath]: eventDoc(),
    });
    const result = await finalize(tx as unknown as Transaction, baseArgs);
    expect(result).toEqual({ status: 'already_sold_other' });
    expect(tx.writes[purchasePath]).toBeUndefined();
  });

  test('slot sold to this user but no purchase doc → already_finalized', async () => {
    const tx = new MockTx({
      [slotPath]: { status: 'sold', purchasedBy: 'USER-A' },
      [eventPath]: eventDoc(),
    });
    const result = await finalize(tx as unknown as Transaction, baseArgs);
    expect(result.status).toBe('already_finalized');
  });

  test('slot locked by another user → already_sold_other', async () => {
    const tx = new MockTx({
      [slotPath]: lockedSlot('USER-B'),
      [eventPath]: eventDoc(),
    });
    const result = await finalize(tx as unknown as Transaction, baseArgs);
    expect(result).toEqual({ status: 'already_sold_other' });
  });

  test('slot available with prior lock owned by THIS user → finalize (recovery)', async () => {
    const tx = new MockTx({
      [slotPath]: { status: 'available', lockedBy: 'USER-A', priceCents: 2500, wrestlerName: 'X', brand: 'Y', tier: 'Gold' },
      [eventPath]: eventDoc(),
    });
    const result = await finalize(tx as unknown as Transaction, baseArgs);
    expect(result.status).toBe('finalized');
  });

  test('slot available with prior lock owned by another user → lock_expired', async () => {
    const tx = new MockTx({
      [slotPath]: { status: 'available', lockedBy: 'USER-B', priceCents: 2500 },
      [eventPath]: eventDoc(),
    });
    const result = await finalize(tx as unknown as Transaction, baseArgs);
    expect(result).toEqual({ status: 'lock_expired' });
    expect(tx.writes[purchasePath]).toBeUndefined();
  });

  test('slot in unknown state (closed) → lock_expired', async () => {
    const tx = new MockTx({
      [slotPath]: { status: 'closed' },
      [eventPath]: eventDoc(),
    });
    const result = await finalize(tx as unknown as Transaction, baseArgs);
    expect(result.status).toBe('lock_expired');
  });

  test('missing slot doc → lock_expired', async () => {
    const tx = new MockTx({
      [eventPath]: eventDoc(),
    });
    const result = await finalize(tx as unknown as Transaction, baseArgs);
    expect(result.status).toBe('lock_expired');
  });

  test('locked slot but lock expired in flight (lockedUntil in past) still finalizes for owning user', async () => {
    const tx = new MockTx({
      [slotPath]: lockedSlot('USER-A', FAKE_PAST_MS),
      [eventPath]: eventDoc(),
    });
    const result = await finalize(tx as unknown as Transaction, baseArgs);
    expect(result.status).toBe('finalized');
  });
});

describe('finalize() — caller-owned transaction [C15]', () => {
  test('writes accumulate on the caller-provided handle', async () => {
    const tx = new MockTx({
      [slotPath]: lockedSlot(),
      [eventPath]: eventDoc(),
    });
    const result = await finalize(tx as unknown as Transaction, baseArgs);
    expect(result.status).toBe('finalized');
    // Confirm the tx instance we passed in has the writes — not some other tx.
    const writePaths = Object.keys(tx.writes);
    const updatePaths = Object.keys(tx.updates);
    expect(writePaths).toContain(purchasePath);
    expect(updatePaths).toEqual(expect.arrayContaining([slotPath, eventPath, userPath]));
  });
});
