/// <reference types="jest" />
/// <reference types="node" />

/**
 * Tests for `paypal/verifySignature` covering:
 *   - [C8] verifier-endpoint-based signature verification
 *   - [S3] three-state result discriminator (success / failure / verifier_unavailable)
 *   - dedupe cache keyed by `transmissionId`
 *
 * `firebase-functions/params` is mocked because `defineSecret` would
 * otherwise try to register against the Firebase runtime under Jest. The
 * PAYPAL_ENV is forced to `'sandbox'` BEFORE imports so the strict env gate
 * in `paypal/config` passes at module load.
 */

jest.mock('firebase-functions/params', () => ({
  defineSecret: (name: string) => ({
    name,
    value: () => `mocked-${name}`,
  }),
}));

const ORIGINAL_PAYPAL_ENV = process.env.PAYPAL_ENV;
process.env.PAYPAL_ENV = 'sandbox';

// Mock the PayPal HTTP client so we can drive verifier responses from tests.
jest.mock('../paypal/client', () => ({
  request: jest.fn(),
  // SanitizedError is a type-only export (interface). Nothing to provide here.
}));

// Mock the structured logger so we can assert metric emissions.
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

// Imports MUST come after mocks + env setup.
import { request } from '../paypal/client';
import * as logger from '../utils/logger';
import {
  PayPalWebhookHeaders,
  verifyWebhookSignature,
  _clearVerifierCacheForTests,
} from '../paypal/verifySignature';

const mockedRequest = request as jest.MockedFunction<typeof request>;
const mockedLogger = logger as jest.Mocked<typeof logger>;

const WEBHOOK_ID = 'WH-TEST-12345';
const RAW_BODY = JSON.stringify({
  id: 'EVT-001',
  event_type: 'PAYMENT.CAPTURE.COMPLETED',
});
const CORRELATION_ID = 'corr-abc';

function makeHeaders(transmissionId = 'TX-1'): PayPalWebhookHeaders {
  return {
    transmissionId,
    transmissionTime: '2026-05-12T00:00:00Z',
    certUrl: 'https://api.sandbox.paypal.com/v1/notifications/certs/cert-id',
    authAlgo: 'SHA256withRSA',
    transmissionSig: 'fake-signature-bytes',
  };
}

beforeEach(() => {
  _clearVerifierCacheForTests();
  mockedRequest.mockReset();
  mockedLogger.info.mockReset();
  mockedLogger.warn.mockReset();
  mockedLogger.error.mockReset();
});

afterAll(() => {
  if (ORIGINAL_PAYPAL_ENV === undefined) {
    delete process.env.PAYPAL_ENV;
  } else {
    process.env.PAYPAL_ENV = ORIGINAL_PAYPAL_ENV;
  }
});

describe('verifyWebhookSignature — [C8] verifier endpoint, [S3] tri-state result', () => {
  test('SUCCESS verifier response → { state: "success" }', async () => {
    mockedRequest.mockResolvedValueOnce({ verification_status: 'SUCCESS' });

    const result = await verifyWebhookSignature(
      WEBHOOK_ID,
      makeHeaders(),
      RAW_BODY,
      CORRELATION_ID,
    );

    expect(result).toEqual({ state: 'success' });
    expect(mockedRequest).toHaveBeenCalledTimes(1);
    const [method, path, body] = mockedRequest.mock.calls[0];
    expect(method).toBe('POST');
    expect(path).toBe('/v1/notifications/verify-webhook-signature');
    expect(body).toMatchObject({
      auth_algo: 'SHA256withRSA',
      cert_url: 'https://api.sandbox.paypal.com/v1/notifications/certs/cert-id',
      transmission_id: 'TX-1',
      transmission_sig: 'fake-signature-bytes',
      transmission_time: '2026-05-12T00:00:00Z',
      webhook_id: WEBHOOK_ID,
      webhook_event: { id: 'EVT-001', event_type: 'PAYMENT.CAPTURE.COMPLETED' },
    });
    expect(mockedLogger.info).toHaveBeenCalledWith(
      'paypal_webhook_verifier_ok',
      expect.objectContaining({ correlationId: CORRELATION_ID }),
    );
  });

  test('FAILURE verifier response → { state: "failure" } and emits failure metric', async () => {
    mockedRequest.mockResolvedValueOnce({ verification_status: 'FAILURE' });

    const result = await verifyWebhookSignature(
      WEBHOOK_ID,
      makeHeaders('TX-failure'),
      RAW_BODY,
      CORRELATION_ID,
    );

    expect(result.state).toBe('failure');
    expect((result as { reason?: string }).reason).toBeDefined();
    expect(mockedLogger.error).toHaveBeenCalledWith(
      'paypal_webhook_verifier_failure_response_count',
      null,
      expect.objectContaining({
        correlationId: CORRELATION_ID,
        transmissionId: 'TX-failure',
      }),
    );
  });

  test('verifier 5xx (503) → { state: "verifier_unavailable" } and emits call-error metric', async () => {
    const err = Object.assign(new Error('boom'), {
      status: 503,
      name: 'PayPalAPIError',
    });
    mockedRequest.mockRejectedValueOnce(err);

    const result = await verifyWebhookSignature(
      WEBHOOK_ID,
      makeHeaders('TX-503'),
      RAW_BODY,
      CORRELATION_ID,
    );

    expect(result.state).toBe('verifier_unavailable');
    expect((result as { reason?: string }).reason).toBeDefined();
    expect(mockedLogger.error).toHaveBeenCalledWith(
      'paypal_webhook_verifier_call_error',
      err,
      expect.objectContaining({
        correlationId: CORRELATION_ID,
        transmissionId: 'TX-503',
        status: 503,
      }),
    );
  });

  test('verifier rate-limited (429) → { state: "verifier_unavailable" }', async () => {
    const err = Object.assign(new Error('rate limited'), {
      status: 429,
      name: 'PayPalAPIError',
    });
    mockedRequest.mockRejectedValueOnce(err);

    const result = await verifyWebhookSignature(
      WEBHOOK_ID,
      makeHeaders('TX-429'),
      RAW_BODY,
      CORRELATION_ID,
    );

    expect(result.state).toBe('verifier_unavailable');
    expect(mockedLogger.error).toHaveBeenCalledWith(
      'paypal_webhook_verifier_call_error',
      err,
      expect.objectContaining({ status: 429 }),
    );
  });

  test('network error (no status) → { state: "verifier_unavailable" }', async () => {
    const err = new Error('ECONNREFUSED');
    mockedRequest.mockRejectedValueOnce(err);

    const result = await verifyWebhookSignature(
      WEBHOOK_ID,
      makeHeaders('TX-net'),
      RAW_BODY,
      CORRELATION_ID,
    );

    expect(result.state).toBe('verifier_unavailable');
    expect((result as { reason?: string }).reason).toContain('ECONNREFUSED');
    expect(mockedLogger.error).toHaveBeenCalledWith(
      'paypal_webhook_verifier_call_error',
      err,
      expect.objectContaining({
        correlationId: CORRELATION_ID,
        transmissionId: 'TX-net',
        status: undefined,
      }),
    );
  });
});

describe('verifyWebhookSignature — dedupe cache by transmissionId', () => {
  test('cache hit: two calls with same transmissionId invoke request exactly once', async () => {
    mockedRequest.mockResolvedValueOnce({ verification_status: 'SUCCESS' });

    const headers = makeHeaders('TX-dedupe');
    const first = await verifyWebhookSignature(
      WEBHOOK_ID,
      headers,
      RAW_BODY,
      CORRELATION_ID,
    );
    const second = await verifyWebhookSignature(
      WEBHOOK_ID,
      headers,
      RAW_BODY,
      CORRELATION_ID,
    );

    expect(first).toEqual({ state: 'success' });
    expect(second).toEqual({ state: 'success' });
    expect(mockedRequest).toHaveBeenCalledTimes(1);
  });

  test('cache miss: two calls with different transmissionIds both invoke request', async () => {
    mockedRequest
      .mockResolvedValueOnce({ verification_status: 'SUCCESS' })
      .mockResolvedValueOnce({ verification_status: 'SUCCESS' });

    const a = await verifyWebhookSignature(
      WEBHOOK_ID,
      makeHeaders('TX-a'),
      RAW_BODY,
      CORRELATION_ID,
    );
    const b = await verifyWebhookSignature(
      WEBHOOK_ID,
      makeHeaders('TX-b'),
      RAW_BODY,
      CORRELATION_ID,
    );

    expect(a).toEqual({ state: 'success' });
    expect(b).toEqual({ state: 'success' });
    expect(mockedRequest).toHaveBeenCalledTimes(2);
  });

  test('verifier_unavailable result is NOT cached — retry re-invokes request', async () => {
    const err = Object.assign(new Error('boom'), {
      status: 503,
      name: 'PayPalAPIError',
    });
    mockedRequest
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce({ verification_status: 'SUCCESS' });

    const headers = makeHeaders('TX-retry');
    const first = await verifyWebhookSignature(
      WEBHOOK_ID,
      headers,
      RAW_BODY,
      CORRELATION_ID,
    );
    const second = await verifyWebhookSignature(
      WEBHOOK_ID,
      headers,
      RAW_BODY,
      CORRELATION_ID,
    );

    expect(first.state).toBe('verifier_unavailable');
    expect(second.state).toBe('success');
    expect(mockedRequest).toHaveBeenCalledTimes(2);
  });

  test('_clearVerifierCacheForTests() resets cache so next call invokes request', async () => {
    mockedRequest
      .mockResolvedValueOnce({ verification_status: 'SUCCESS' })
      .mockResolvedValueOnce({ verification_status: 'SUCCESS' });

    const headers = makeHeaders('TX-clear');
    await verifyWebhookSignature(WEBHOOK_ID, headers, RAW_BODY, CORRELATION_ID);
    expect(mockedRequest).toHaveBeenCalledTimes(1);

    _clearVerifierCacheForTests();

    await verifyWebhookSignature(WEBHOOK_ID, headers, RAW_BODY, CORRELATION_ID);
    expect(mockedRequest).toHaveBeenCalledTimes(2);
  });
});
