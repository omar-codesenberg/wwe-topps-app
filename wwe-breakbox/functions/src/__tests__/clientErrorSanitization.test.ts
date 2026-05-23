/// <reference types="jest" />
/// <reference types="node" />

/**
 * [C21] PayPal client error-sanitization tests.
 *
 * Verifies that:
 *   - Non-2xx PayPal responses surface as `SanitizedError` with only the
 *     allowed fields (`message`, `name`, `status`, `paypalCode`, `debugId`).
 *   - The thrown error has NO reachable reference to the raw fetch Response,
 *     request init, headers (especially `Authorization`), axios-style config,
 *     or anything else attacker-controlled. We probe via own-prop walk +
 *     `for...in` (inherited) up to a transitive depth of 5.
 *   - Successful responses go through the caller-supplied `project` function;
 *     fields outside the projection (`links`, `payer`) are not reachable from
 *     the returned value.
 */

jest.mock('firebase-functions/params', () => ({
  defineSecret: (name: string) => ({
    name,
    value: () => `mocked-${name}`,
  }),
}));

// Silence the structured logger so jest output stays readable.
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const ORIGINAL_ENV_ERR = process.env.PAYPAL_ENV;
const ORIGINAL_FETCH_ERR = global.fetch;

beforeAll(() => {
  process.env.PAYPAL_ENV = 'sandbox';
});

afterAll(() => {
  if (ORIGINAL_ENV_ERR === undefined) {
    delete process.env.PAYPAL_ENV;
  } else {
    process.env.PAYPAL_ENV = ORIGINAL_ENV_ERR;
  }
  global.fetch = ORIGINAL_FETCH_ERR;
});

beforeEach(() => {
  jest.resetModules();
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH_ERR;
});

/** Forbidden key names — must not appear anywhere reachable from the error. */
const FORBIDDEN_KEYS = new Set([
  'config',
  'headers',
  'request',
  'response',
  'Authorization',
  'authorization',
]);

/**
 * Walk the value's own + inherited keys up to `maxDepth`, asserting that no
 * forbidden key appears anywhere in the transitive graph. Cycles guarded with
 * a Set of seen objects.
 */
function assertNoForbiddenKeys(root: unknown, maxDepth: number): void {
  const seen = new WeakSet<object>();
  walk(root, 0);

  function walk(value: unknown, depth: number): void {
    if (depth > maxDepth) return;
    if (value === null || value === undefined) return;
    if (typeof value !== 'object' && typeof value !== 'function') return;
    if (seen.has(value as object)) return;
    seen.add(value as object);

    // Check both own props and inherited (for...in).
    const ownNames = Object.getOwnPropertyNames(value as object);
    for (const k of ownNames) {
      if (FORBIDDEN_KEYS.has(k)) {
        const desc = Object.getOwnPropertyDescriptor(value as object, k);
        // The defence-in-depth `defineProperty(..., { value: undefined })` on
        // SanitizedError leaves the names present but with `undefined` values.
        // Anything truthy at one of these names is a real leak.
        if (desc && desc.value !== undefined) {
          throw new Error(`Forbidden key "${k}" present on error graph at depth ${depth}`);
        }
      }
    }

    for (const k in value as object) {
      if (FORBIDDEN_KEYS.has(k)) {
        const v = (value as Record<string, unknown>)[k];
        if (v !== undefined) {
          throw new Error(`Forbidden inherited key "${k}" present on error graph at depth ${depth}`);
        }
      }
    }

    // Recurse into own enumerable values.
    for (const k of ownNames) {
      const v = (value as Record<string, unknown>)[k];
      walk(v, depth + 1);
    }
  }
}

describe('paypal/client — [C21] error sanitization', () => {
  test('401 from PayPal: error is sanitized, no raw response/headers reachable', async () => {
    // Sequence: first call is the OAuth token (succeeds), second is the API call (401).
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ access_token: 'tok-1', expires_in: 32400 }),
        json: async () => ({ access_token: 'tok-1', expires_in: 32400 }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () =>
          JSON.stringify({
            name: 'AUTHENTICATION_FAILURE',
            message: 'Auth failed',
            debug_id: 'abc123',
          }),
        json: async () => ({
          name: 'AUTHENTICATION_FAILURE',
          message: 'Auth failed',
          debug_id: 'abc123',
        }),
      });

    global.fetch = fetchMock as unknown as typeof fetch;

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const client = require('../paypal/client') as typeof import('../paypal/client');
    client._resetTokenCacheForTests();

    let thrown: unknown;
    try {
      await client.request('POST', '/v2/checkout/orders', { intent: 'CAPTURE' }, {
        project: (r: unknown) => r as Record<string, unknown>,
      });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeDefined();
    expect(thrown).toBeInstanceOf(Error);

    const err = thrown as import('../paypal/client').SanitizedError;
    expect(err.name).toBe('PayPalAPIError');
    expect(err.message).toBe('Auth failed');
    expect(err.status).toBe(401);
    expect(err.paypalCode).toBe('AUTHENTICATION_FAILURE');
    expect(err.debugId).toBe('abc123');

    // The error message must not embed the debug_id.
    expect(err.message.includes('abc123')).toBe(false);

    // No forbidden references reachable through any path of depth <= 5.
    assertNoForbiddenKeys(err, 5);
  });

  test('422 with details[0].issue: specific application code is extracted onto `issue`', async () => {
    // Real-shape PayPal 422 — INSTRUMENT_DECLINED nested under details.
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ access_token: 'tok-iss', expires_in: 32400 }),
        json: async () => ({ access_token: 'tok-iss', expires_in: 32400 }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 422,
        text: async () =>
          JSON.stringify({
            name: 'UNPROCESSABLE_ENTITY',
            message: 'The requested action could not be performed.',
            debug_id: 'deadbeef',
            details: [
              {
                issue: 'INSTRUMENT_DECLINED',
                description: 'The instrument was declined by the processor.',
              },
            ],
          }),
        json: async () => ({}),
      });

    global.fetch = fetchMock as unknown as typeof fetch;

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const client = require('../paypal/client') as typeof import('../paypal/client');
    client._resetTokenCacheForTests();

    let thrown: unknown;
    try {
      await client.request('POST', '/v2/checkout/orders/ABC/capture', {}, {
        project: (r: unknown) => r as Record<string, unknown>,
      });
    } catch (e) {
      thrown = e;
    }

    const err = thrown as import('../paypal/client').SanitizedError;
    expect(err.paypalCode).toBe('UNPROCESSABLE_ENTITY');
    expect(err.issue).toBe('INSTRUMENT_DECLINED');
    expect(err.status).toBe(422);
    expect(err.debugId).toBe('deadbeef');

    // The full details array must NOT have been attached to the error.
    expect((err as unknown as Record<string, unknown>).details).toBeUndefined();

    // Still nothing forbidden reachable from the error graph.
    assertNoForbiddenKeys(err, 5);
  });

  test('422 without details: `issue` is undefined; other fields still set', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ access_token: 'tok-no-iss', expires_in: 32400 }),
        json: async () => ({ access_token: 'tok-no-iss', expires_in: 32400 }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 422,
        text: async () =>
          JSON.stringify({
            name: 'UNPROCESSABLE_ENTITY',
            message: 'Generic failure with no details.',
            debug_id: 'no-details',
          }),
        json: async () => ({}),
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const client = require('../paypal/client') as typeof import('../paypal/client');
    client._resetTokenCacheForTests();

    let thrown: unknown;
    try {
      await client.request('POST', '/v2/checkout/orders/XYZ/capture', {}, {
        project: (r: unknown) => r as Record<string, unknown>,
      });
    } catch (e) {
      thrown = e;
    }

    const err = thrown as import('../paypal/client').SanitizedError;
    expect(err.paypalCode).toBe('UNPROCESSABLE_ENTITY');
    expect(err.issue).toBeUndefined();
    expect(err.debugId).toBe('no-details');
  });

  test('Malformed details (not an array / non-object first element / no string issue) → issue undefined, no throw', async () => {
    const malformedShapes = [
      { details: 'not-an-array' },
      { details: [] },
      { details: [null] },
      { details: [{ issue: 42 }] },
      { details: [{ description: 'has no issue field' }] },
      { details: [{ issue: '' }] }, // empty string treated as absent
    ];

    for (const body of malformedShapes) {
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ access_token: 'tok-mal', expires_in: 32400 }),
          json: async () => ({ access_token: 'tok-mal', expires_in: 32400 }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 422,
          text: async () =>
            JSON.stringify({
              name: 'UNPROCESSABLE_ENTITY',
              message: 'malformed',
              debug_id: 'mal',
              ...body,
            }),
          json: async () => ({}),
        });
      global.fetch = fetchMock as unknown as typeof fetch;

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const client = require('../paypal/client') as typeof import('../paypal/client');
      client._resetTokenCacheForTests();

      let thrown: unknown;
      try {
        await client.request('POST', '/v2/checkout/orders/MAL/capture', {}, {
          project: (r: unknown) => r as Record<string, unknown>,
        });
      } catch (e) {
        thrown = e;
      }

      const err = thrown as import('../paypal/client').SanitizedError;
      expect(err.issue).toBeUndefined();
      expect(err.paypalCode).toBe('UNPROCESSABLE_ENTITY');
      jest.resetModules();
    }
  });

  test('Success: caller projection applied; raw body fields not reachable', async () => {
    const successBody = {
      id: 'ORD-1',
      status: 'CREATED',
      links: [{ rel: 'approve', href: 'https://approve.example/secret-token' }],
      payer: { email_address: 'x@y.com' },
    };

    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ access_token: 'tok-2', expires_in: 32400 }),
        json: async () => ({ access_token: 'tok-2', expires_in: 32400 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        text: async () => JSON.stringify(successBody),
        json: async () => successBody,
      });

    global.fetch = fetchMock as unknown as typeof fetch;

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const client = require('../paypal/client') as typeof import('../paypal/client');
    client._resetTokenCacheForTests();

    interface Projected {
      id: string;
      status: string;
    }

    const out = await client.request<Projected>('POST', '/v2/checkout/orders', undefined, {
      project: (r: unknown) => {
        const body = r as Record<string, unknown>;
        return { id: body.id as string, status: body.status as string };
      },
    });

    expect(out).toEqual({ id: 'ORD-1', status: 'CREATED' });
    expect((out as unknown as Record<string, unknown>).links).toBeUndefined();
    expect((out as unknown as Record<string, unknown>).payer).toBeUndefined();

    // Walk the projection: ensure no forbidden keys leaked through.
    assertNoForbiddenKeys(out, 5);
  });
});
