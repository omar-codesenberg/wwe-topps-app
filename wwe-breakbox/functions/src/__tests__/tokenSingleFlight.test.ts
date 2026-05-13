/// <reference types="jest" />
/// <reference types="node" />

/**
 * [S4] Token cache + single-flight refresh tests.
 *
 * Verifies that:
 *   - 30 concurrent token requests collapse to a single network fetch.
 *   - Subsequent calls reuse the cached token (no new fetch).
 *   - When the cache expires, a fresh fetch happens — but again coalesces
 *     under concurrent load.
 */

jest.mock('firebase-functions/params', () => ({
  defineSecret: (name: string) => ({
    name,
    value: () => `mocked-${name}`,
  }),
}));

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const ORIGINAL_ENV_TOK = process.env.PAYPAL_ENV;
const ORIGINAL_FETCH_TOK = global.fetch;

beforeAll(() => {
  process.env.PAYPAL_ENV = 'sandbox';
});

afterAll(() => {
  if (ORIGINAL_ENV_TOK === undefined) {
    delete process.env.PAYPAL_ENV;
  } else {
    process.env.PAYPAL_ENV = ORIGINAL_ENV_TOK;
  }
  global.fetch = ORIGINAL_FETCH_TOK;
});

beforeEach(() => {
  jest.resetModules();
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH_TOK;
});

interface TokenResponse {
  access_token: string;
  expires_in: number;
}

/** Build a fake fetch response object for the token endpoint. */
function tokenResponse(body: TokenResponse) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

/** A fetch mock that resolves with the given body after `delayMs`. */
function delayedFetchMock(body: TokenResponse, delayMs: number): jest.Mock {
  return jest.fn().mockImplementation(
    () =>
      new Promise((resolve) => {
        setTimeout(() => resolve(tokenResponse(body)), delayMs);
      }),
  );
}

describe('paypal/client — [S4] token cache + single-flight refresh', () => {
  test('30 concurrent token fetches collapse to a single network call', async () => {
    const fetchMock = delayedFetchMock({ access_token: 't1', expires_in: 32400 }, 50);
    global.fetch = fetchMock as unknown as typeof fetch;

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const client = require('../paypal/client') as typeof import('../paypal/client');
    client._resetTokenCacheForTests();

    const results = await Promise.all(
      Array.from({ length: 30 }, () => client._getAccessTokenForTests()),
    );

    expect(results).toHaveLength(30);
    for (const t of results) {
      expect(t).toBe('t1');
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('after first resolve, the 31st call hits the cache (no new fetch)', async () => {
    const fetchMock = delayedFetchMock({ access_token: 't2', expires_in: 32400 }, 10);
    global.fetch = fetchMock as unknown as typeof fetch;

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const client = require('../paypal/client') as typeof import('../paypal/client');
    client._resetTokenCacheForTests();

    // Warm the cache.
    await Promise.all(Array.from({ length: 30 }, () => client._getAccessTokenForTests()));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 31st call should reuse the cache without firing fetch again.
    const cachedTok = await client._getAccessTokenForTests();
    expect(cachedTok).toBe('t2');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('after cache expires, a refresh happens — and is itself single-flighted', async () => {
    let body: TokenResponse = { access_token: 't3', expires_in: 32400 };
    const fetchMock = jest.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(tokenResponse(body)), 30);
        }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const client = require('../paypal/client') as typeof import('../paypal/client');
    client._resetTokenCacheForTests();

    const first = await client._getAccessTokenForTests();
    expect(first).toBe('t3');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Force the cached token to be expired.
    client._setCacheExpiryForTests(Date.now() - 1);

    // Switch the mock body so the refresh produces a new token.
    body = { access_token: 't3-refreshed', expires_in: 32400 };

    // Concurrent burst on the expired cache: should issue exactly one new fetch.
    const burst = await Promise.all(
      Array.from({ length: 20 }, () => client._getAccessTokenForTests()),
    );

    for (const t of burst) {
      expect(t).toBe('t3-refreshed');
    }
    // Initial fetch (1) + exactly one refresh (1) = 2 total.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
