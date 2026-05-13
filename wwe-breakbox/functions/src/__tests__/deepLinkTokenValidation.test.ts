/// <reference types="jest" />
/// <reference types="node" />

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
  defineSecret: (name: string) => ({ name, value: () => `mocked-${name}` }),
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

// In-memory Firestore for `paypalOrders/{orderId}` reads.
type DocStore = Map<string, Record<string, unknown> | undefined>;
const docs: DocStore = new Map();

interface MockDocSnap {
  exists: boolean;
  data: () => Record<string, unknown> | undefined;
}

const dbMock = {
  collection: (col: string) => ({
    doc: (id: string) => ({
      _path: `${col}/${id}`,
      get: async (): Promise<MockDocSnap> => {
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
    increment: (n: number) => ({ _inc: n }),
  },
  Timestamp: {
    now: () => ({ _now: Date.now() }),
    fromDate: (d: Date) => ({ _fromDate: d.toISOString() }),
  },
}));

import { getPayPalOrderStatus } from '../paypal/getOrderStatus';
import { request as mockRequest } from '../paypal/client';
import * as loggerMod from '../utils/logger';

const requestMock = mockRequest as unknown as jest.Mock;
const withCorrelationIdMock =
  loggerMod.withCorrelationId as unknown as jest.Mock;

// `functions.https.onCall(...)` returns an object with a `.run(data, context)`
// hook for unit tests (Runnable<T>). Type the cast loosely so we can call it.
const runFn = (getPayPalOrderStatus as unknown as {
  run: (data: unknown, context: unknown) => Promise<unknown>;
}).run;

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

interface HttpsErrorLike {
  code?: string;
  message?: string;
}

async function expectHttpsError(
  promise: Promise<unknown>,
  expectedCode: string,
): Promise<HttpsErrorLike> {
  let caught: unknown;
  try {
    await promise;
  } catch (e) {
    caught = e;
  }
  if (caught === undefined) {
    throw new Error(`Expected HttpsError(${expectedCode}) but no error thrown`);
  }
  const err = caught as HttpsErrorLike;
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

    await expectHttpsError(
      runFn({ orderId: 'ORD-A' }, { auth: { uid: 'USER-B' } }) as Promise<unknown>,
      'permission-denied',
    );

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

    const result = (await runFn(
      { orderId: 'ORD-V' },
      { auth: { uid: 'USER-A' } },
    )) as {
      orderId: string;
      status: string;
      paypalStatus: string;
      voided: boolean;
    };

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

    const result = (await runFn(
      { orderId: 'ORD-OK' },
      { auth: { uid: 'USER-A' } },
    )) as {
      orderId: string;
      status: string;
      paypalStatus: string;
      voided: boolean;
    };

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

    await expectHttpsError(
      runFn({ orderId: 'ORD-A' }, {}) as Promise<unknown>,
      'unauthenticated',
    );

    expect(requestMock).not.toHaveBeenCalled();
  });

  test('missing order doc throws not-found and never calls PayPal', async () => {
    await expectHttpsError(
      runFn(
        { orderId: 'ORD-MISSING' },
        { auth: { uid: 'USER-A' } },
      ) as Promise<unknown>,
      'not-found',
    );

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

    const result = (await runFn(
      { orderId: 'ORD-PV' },
      { auth: { uid: 'USER-A' } },
    )) as { voided: boolean; paypalStatus: string };

    expect(result.paypalStatus).toBe('VOIDED');
    expect(result.voided).toBe(true);
  });
});
