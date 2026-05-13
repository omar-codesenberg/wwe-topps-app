/// <reference types="jest" />
/// <reference types="node" />

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
  defineSecret: (name: string) => ({ name, value: () => `mocked-${name}` }),
}));

jest.mock('../paypal/client', () => ({
  request: jest.fn(),
}));

type DocStore = Map<string, Record<string, unknown> | undefined>;

interface MockTransaction {
  get: (ref: { _path: string }) => Promise<{
    exists: boolean;
    data: () => Record<string, unknown> | undefined;
  }>;
  set: (
    ref: { _path: string },
    data: Record<string, unknown>,
    opts?: { merge?: boolean },
  ) => void;
  update: (ref: { _path: string }, data: Record<string, unknown>) => void;
}

const docs: DocStore = new Map();

const dbMock = {
  collection: (col: string) => ({
    doc: (id: string) => {
      const path = `${col}/${id}`;
      return {
        _path: path,
        update: async (data: Record<string, unknown>): Promise<void> => {
          const existing = docs.get(path);
          if (existing === undefined) {
            throw new Error(`update on missing doc: ${path}`);
          }
          // Apply increment sentinel against the existing value.
          const merged: Record<string, unknown> = { ...existing };
          for (const [k, v] of Object.entries(data)) {
            if (v && typeof v === 'object' && (v as { _inc?: number })._inc !== undefined) {
              const cur = typeof merged[k] === 'number' ? (merged[k] as number) : 0;
              merged[k] = cur + ((v as { _inc: number })._inc);
            } else {
              merged[k] = v;
            }
          }
          docs.set(path, merged);
        },
      };
    },
  }),
  runTransaction: async <T>(
    fn: (txn: MockTransaction) => Promise<T>,
  ): Promise<T> => {
    const writes: Array<() => void> = [];
    const txn: MockTransaction = {
      get: async (ref) => {
        const data = docs.get(ref._path);
        return {
          exists: data !== undefined,
          data: () => data,
        };
      },
      set: (ref, data, _opts) => {
        writes.push(() => docs.set(ref._path, { ...data }));
      },
      update: (ref, data) => {
        writes.push(() => {
          const cur = docs.get(ref._path) ?? {};
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

// Silence the structured logger. Note: jest.config.js has `restoreMocks: true`,
// so we (re)install `withCorrelationId`'s implementation in beforeEach.
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  withCorrelationId: jest.fn(),
}));

import {
  refundCapture,
  _classifyError,
  PERMANENT_REFUND_ERROR_CODES,
} from '../paypal/refund';
import { request as mockRequest } from '../paypal/client';
import * as loggerMod from '../utils/logger';

const requestMock = mockRequest as unknown as jest.Mock;
const withCorrelationIdMock =
  loggerMod.withCorrelationId as unknown as jest.Mock;

/** Build a SanitizedError-shaped object. */
function sanitizedError(
  fields: { paypalCode?: string; status?: number; message?: string },
): Error & { paypalCode?: string; status?: number } {
  const e = new Error(fields.message ?? 'sanitized error') as Error & {
    paypalCode?: string;
    status?: number;
  };
  if (fields.paypalCode !== undefined) e.paypalCode = fields.paypalCode;
  if (fields.status !== undefined) e.status = fields.status;
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
    requestMock.mockRejectedValue(
      sanitizedError({ paypalCode: 'INSUFFICIENT_FUNDS', status: 422 }),
    );

    const result = await refundCapture('CAP1', 'reason', 'corr1');
    expect(result.status).toBe('alert_required');
    expect(result.errorCode).toBe('INSUFFICIENT_FUNDS');

    const stored = docs.get('pendingRefunds/CAP1');
    expect(stored?.status).toBe('alert_required');
    expect(stored?.errorCode).toBe('INSUFFICIENT_FUNDS');
    expect(stored?.attemptCount).toBe(1);

    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  test('INSTRUMENT_DECLINED → alert_required', async () => {
    requestMock.mockRejectedValue(
      sanitizedError({ paypalCode: 'INSTRUMENT_DECLINED' }),
    );

    const result = await refundCapture('CAP1', 'reason', 'corr1');
    expect(result.status).toBe('alert_required');
    expect(result.errorCode).toBe('INSTRUMENT_DECLINED');

    const stored = docs.get('pendingRefunds/CAP1');
    expect(stored?.status).toBe('alert_required');
    expect(stored?.attemptCount).toBe(1);
  });

  test('REFUND_NOT_ALLOWED → alert_required', async () => {
    requestMock.mockRejectedValue(
      sanitizedError({ paypalCode: 'REFUND_NOT_ALLOWED' }),
    );

    const result = await refundCapture('CAP1', 'reason', 'corr1');
    expect(result.status).toBe('alert_required');
    expect(result.errorCode).toBe('REFUND_NOT_ALLOWED');
  });

  test('INTERNAL_SERVER_ERROR (500) → failed_will_retry', async () => {
    requestMock.mockRejectedValue(
      sanitizedError({ paypalCode: 'INTERNAL_SERVER_ERROR', status: 500 }),
    );

    const result = await refundCapture('CAP1', 'reason', 'corr1');
    expect(result.status).toBe('failed_will_retry');
    expect(result.errorCode).toBe('INTERNAL_SERVER_ERROR');

    const stored = docs.get('pendingRefunds/CAP1');
    expect(stored?.status).toBe('failed_will_retry');
    expect(stored?.errorCode).toBe('INTERNAL_SERVER_ERROR');
    expect(stored?.attemptCount).toBe(1); // started at 0, incremented by 1
  });

  test('TOO_MANY_REQUESTS (429) → failed_will_retry', async () => {
    requestMock.mockRejectedValue(
      sanitizedError({ paypalCode: 'TOO_MANY_REQUESTS', status: 429 }),
    );

    const result = await refundCapture('CAP1', 'reason', 'corr1');
    expect(result.status).toBe('failed_will_retry');
    expect(result.errorCode).toBe('TOO_MANY_REQUESTS');

    const stored = docs.get('pendingRefunds/CAP1');
    expect(stored?.status).toBe('failed_will_retry');
  });

  test('network error (no paypalCode, no status) → failed_will_retry', async () => {
    // A bare network-style failure: no paypalCode, no status.
    const netErr = new Error('ECONNRESET');
    requestMock.mockRejectedValue(netErr);

    const result = await refundCapture('CAP1', 'reason', 'corr1');
    expect(result.status).toBe('failed_will_retry');
    expect(result.errorCode).toBeUndefined();

    const stored = docs.get('pendingRefunds/CAP1');
    expect(stored?.status).toBe('failed_will_retry');
    expect(stored?.attemptCount).toBe(1);
  });

  describe('_classifyError direct mapping', () => {
    test.each([
      ['INSUFFICIENT_FUNDS'],
      ['INSTRUMENT_DECLINED'],
      ['REFUND_NOT_ALLOWED'],
      ['TRANSACTION_REFUSED'],
      ['CAPTURE_FULLY_REFUNDED'],
    ])('%s → permanent', (code) => {
      expect(_classifyError({ paypalCode: code })).toBe('permanent');
      expect(PERMANENT_REFUND_ERROR_CODES.has(code)).toBe(true);
    });

    test.each([
      ['INTERNAL_SERVER_ERROR'],
      ['TOO_MANY_REQUESTS'],
      ['UNKNOWN_CODE'],
    ])('%s → transient', (code) => {
      expect(_classifyError({ paypalCode: code })).toBe('transient');
    });

    test('no code → transient', () => {
      expect(_classifyError(new Error('boom'))).toBe('transient');
      expect(_classifyError(undefined)).toBe('transient');
      expect(_classifyError(null)).toBe('transient');
    });
  });
});
