/// <reference types="jest" />
/// <reference types="node" />

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

// We deliberately do NOT mock `firebase-functions/params` here: the v1
// `runWith({ secrets: [...] })` validator does an `instanceof SecretParam`
// check, so the real `defineSecret` is the simplest way to satisfy it.
// `.value()` is never invoked in these tests because the PayPal client is
// mocked.

// In-memory Firestore doc-store. Shared across `db` mock and assertions.
type DocStore = Map<string, Record<string, unknown> | undefined>;

const docs: DocStore = new Map();

interface MockDocRef {
  _path: string;
  get: () => Promise<{
    exists: boolean;
    data: () => Record<string, unknown> | undefined;
  }>;
  update: (data: Record<string, unknown>) => Promise<void>;
}

interface MockTransaction {
  get: (ref: MockDocRef) => Promise<{
    exists: boolean;
    data: () => Record<string, unknown> | undefined;
  }>;
  set: (ref: MockDocRef, data: Record<string, unknown>, opts?: { merge?: boolean }) => void;
  update: (ref: MockDocRef, data: Record<string, unknown>) => void;
}

// Capture the function passed to runTransaction so the test driver can decide
// what `finalize()` should appear to return — we mock finalize directly below
// so the actual transaction body is the mocked function call.
const dbMock = {
  collection: (col: string) => ({
    doc: (id: string): MockDocRef => {
      const path = `${col}/${id}`;
      const ref: MockDocRef = {
        _path: path,
        get: async () => {
          const data = docs.get(path);
          return {
            exists: data !== undefined,
            data: () => data,
          };
        },
        update: async (data: Record<string, unknown>): Promise<void> => {
          const cur = docs.get(path) ?? {};
          docs.set(path, { ...cur, ...data });
        },
      };
      return ref;
    },
  }),
  runTransaction: async <T>(fn: (txn: MockTransaction) => Promise<T>): Promise<T> => {
    // The body delegates to mocked `finalize()`, which doesn't actually use
    // the txn. Provide a stub.
    const txn: MockTransaction = {
      get: async () => ({ exists: false, data: () => undefined }),
      set: () => {},
      update: () => {},
    };
    return fn(txn);
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

import { request as mockRequest } from '../paypal/client';
import { refundCapture as mockRefundCapture } from '../paypal/refund';
import { finalize as mockFinalize } from '../purchases/finalizeSlotPurchase';
import * as loggerMod from '../utils/logger';

const requestMock = mockRequest as unknown as jest.Mock;
const refundCaptureMock = mockRefundCapture as unknown as jest.Mock;
const finalizeMock = mockFinalize as unknown as jest.Mock;
const withCorrelationIdMock = loggerMod.withCorrelationId as unknown as jest.Mock;
const loggerErrorMock = loggerMod.error as unknown as jest.Mock;
const loggerInfoMock = loggerMod.info as unknown as jest.Mock;
const loggerWarnMock = loggerMod.warn as unknown as jest.Mock;

// Scoped logger spies that callers see via `withCorrelationId(...)`.
let scopedInfo: jest.Mock;
let scopedWarn: jest.Mock;
let scopedError: jest.Mock;

// SUT — load AFTER all mocks so module init picks up our jest.mock factories.
// captureOrder.ts uses require('./client') indirectly via the v1 callable
// wrapper, so importing here is safe.
let capturePayPalOrder: typeof import('../paypal/captureOrder').capturePayPalOrder;

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

function seedOrder(overrides: Partial<Record<string, unknown>> = {}) {
  docs.set(`paypalOrders/${ORDER_ID}`, {
    userId: USER_A,
    status: 'created',
    expectedAmount: '10.10',
    currency: 'CAD',
    eventId: 'EVT-1',
    slotId: 'SLOT-1',
    correlationId: CORR_ID,
    ...overrides,
  });
}

function captureResponse(
  captureId: string,
  amountValue: string,
  currency = 'CAD',
): unknown {
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
function getHandler(
  callable: typeof capturePayPalOrder,
): (data: unknown, context: unknown) => Promise<unknown> {
  // firebase-functions v1 attaches the original handler at .run.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (callable as any).run as (
    data: unknown,
    context: unknown,
  ) => Promise<unknown>;
}

async function invoke(data: unknown, auth?: { uid: string }): Promise<unknown> {
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

    await expect(invoke({ orderId: ORDER_ID }, undefined)).rejects.toMatchObject(
      { code: 'unauthenticated' },
    );

    expect(requestMock).not.toHaveBeenCalled();
    expect(refundCaptureMock).not.toHaveBeenCalled();
    expect(finalizeMock).not.toHaveBeenCalled();
  });

  test('cross-user attempt [C9] → permission-denied; no PayPal call', async () => {
    seedOrder({ userId: USER_A });
    requestMock.mockResolvedValue(captureResponse('CAP1', '10.10'));

    await expect(
      invoke({ orderId: ORDER_ID }, { uid: USER_B }),
    ).rejects.toMatchObject({ code: 'permission-denied' });

    expect(requestMock).not.toHaveBeenCalled();
    expect(refundCaptureMock).not.toHaveBeenCalled();
    expect(finalizeMock).not.toHaveBeenCalled();
  });
});

describe('capturePayPalOrder — pre-capture order status', () => {
  test('order voided_by_user → throws ORDER_VOIDED; no PayPal call', async () => {
    seedOrder({ status: 'voided_by_user' });
    requestMock.mockResolvedValue(captureResponse('CAP1', '10.10'));

    let caught: unknown;
    try {
      await invoke({ orderId: ORDER_ID }, { uid: USER_A });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect((caught as { code: string }).code).toBe('failed-precondition');
    // HttpsError details carry our domain code.
    const details = (caught as { details?: { code?: string } }).details;
    expect(details?.code).toBe('ORDER_VOIDED');

    expect(requestMock).not.toHaveBeenCalled();
    expect(refundCaptureMock).not.toHaveBeenCalled();
  });
});

describe('capturePayPalOrder — amount/currency assertion [C2][S1][S9]', () => {
  test('amount mismatch → refund + AMOUNT_MISMATCH; finalize NOT called; logs paypal_amount_mismatch', async () => {
    seedOrder({ expectedAmount: '10.10' });
    requestMock.mockResolvedValue(captureResponse('CAP1', '10.11'));
    refundCaptureMock.mockResolvedValue({
      status: 'completed',
      paypalRefundId: 'REFUND-1',
    });

    let caught: unknown;
    try {
      await invoke({ orderId: ORDER_ID }, { uid: USER_A });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect((caught as { code: string }).code).toBe('failed-precondition');
    expect(
      (caught as { details?: { code?: string } }).details?.code,
    ).toBe('AMOUNT_MISMATCH');

    expect(finalizeMock).not.toHaveBeenCalled();
    expect(refundCaptureMock).toHaveBeenCalledTimes(1);
    expect(refundCaptureMock).toHaveBeenCalledWith(
      'CAP1',
      'amount_mismatch',
      CORR_ID,
    );

    // [S9] paypal_amount_mismatch event was logged with the right shape.
    const mismatchCalls = scopedError.mock.calls.filter(
      (c) => c[0] === 'paypal_amount_mismatch',
    );
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
    seedOrder({ expectedAmount: '10.10' });
    requestMock.mockResolvedValue(captureResponse('CAP1', '10.10', 'USD'));
    refundCaptureMock.mockResolvedValue({
      status: 'completed',
      paypalRefundId: 'REFUND-1',
    });

    let caught: unknown;
    try {
      await invoke({ orderId: ORDER_ID }, { uid: USER_A });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect(
      (caught as { details?: { code?: string } }).details?.code,
    ).toBe('AMOUNT_MISMATCH');

    expect(finalizeMock).not.toHaveBeenCalled();
    expect(refundCaptureMock).toHaveBeenCalledTimes(1);
    expect(refundCaptureMock).toHaveBeenCalledWith(
      'CAP1',
      'amount_mismatch',
      CORR_ID,
    );
  });

  test('[S1] string equality "10.10" vs "10.1" → mismatch (would slip past float compare)', async () => {
    seedOrder({ expectedAmount: '10.10' });
    requestMock.mockResolvedValue(captureResponse('CAP1', '10.1'));
    refundCaptureMock.mockResolvedValue({
      status: 'completed',
      paypalRefundId: 'REFUND-1',
    });

    // Sanity check that floats would treat these as equal.
    expect(parseFloat('10.10')).toBe(parseFloat('10.1'));

    let caught: unknown;
    try {
      await invoke({ orderId: ORDER_ID }, { uid: USER_A });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect(
      (caught as { details?: { code?: string } }).details?.code,
    ).toBe('AMOUNT_MISMATCH');

    expect(finalizeMock).not.toHaveBeenCalled();
    expect(refundCaptureMock).toHaveBeenCalledWith(
      'CAP1',
      'amount_mismatch',
      CORR_ID,
    );
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
    expect(stored?.status).toBe('captured');
    expect(stored?.captureId).toBe('CAP1');
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
    expect(stored?.status).toBe('captured');
    expect(stored?.captureId).toBe('CAP1');
  });

  test('finalize returns "refund_decided" → REFUND_DECIDED; NO new refund', async () => {
    seedOrder({ expectedAmount: '10.10' });
    requestMock.mockResolvedValue(captureResponse('CAP1', '10.10'));
    finalizeMock.mockResolvedValue({ status: 'refund_decided' });

    const result = await invoke({ orderId: ORDER_ID }, { uid: USER_A });
    expect(result).toEqual({ success: false, reason: 'REFUND_DECIDED' });

    expect(refundCaptureMock).not.toHaveBeenCalled();

    const stored = docs.get(`paypalOrders/${ORDER_ID}`);
    expect(stored?.status).toBe('created'); // not stamped captured
  });

  test('finalize returns "already_sold_other" → SLOT_SOLD_OTHER + refund (slot_sold_to_other)', async () => {
    seedOrder({ expectedAmount: '10.10' });
    requestMock.mockResolvedValue(captureResponse('CAP1', '10.10'));
    finalizeMock.mockResolvedValue({ status: 'already_sold_other' });
    refundCaptureMock.mockResolvedValue({
      status: 'completed',
      paypalRefundId: 'REFUND-2',
    });

    const result = (await invoke(
      { orderId: ORDER_ID },
      { uid: USER_A },
    )) as { success: boolean; reason: string };
    expect(result.success).toBe(false);
    expect(result.reason).toBe('SLOT_SOLD_OTHER');

    expect(refundCaptureMock).toHaveBeenCalledTimes(1);
    expect(refundCaptureMock).toHaveBeenCalledWith(
      'CAP1',
      'slot_sold_to_other',
      CORR_ID,
    );
  });

  test('finalize returns "lock_expired" → LOCK_EXPIRED + refund (lock_expired)', async () => {
    seedOrder({ expectedAmount: '10.10' });
    requestMock.mockResolvedValue(captureResponse('CAP1', '10.10'));
    finalizeMock.mockResolvedValue({ status: 'lock_expired' });
    refundCaptureMock.mockResolvedValue({
      status: 'completed',
      paypalRefundId: 'REFUND-3',
    });

    const result = (await invoke(
      { orderId: ORDER_ID },
      { uid: USER_A },
    )) as { success: boolean; reason: string };
    expect(result.success).toBe(false);
    expect(result.reason).toBe('LOCK_EXPIRED');

    expect(refundCaptureMock).toHaveBeenCalledTimes(1);
    expect(refundCaptureMock).toHaveBeenCalledWith(
      'CAP1',
      'lock_expired',
      CORR_ID,
    );
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
    const [captureIdArg, reasonArg, corrIdArg] =
      refundCaptureMock.mock.calls[0];
    expect(captureIdArg).toBe('CAP-XYZ-789');
    expect(reasonArg).toBe('lock_expired');
    expect(corrIdArg).toBe(CORR_ID);
  });
});
