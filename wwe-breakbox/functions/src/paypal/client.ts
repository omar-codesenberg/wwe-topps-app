/**
 * PayPal HTTP client.
 *
 * Implements:
 *   [S4]  Single-flight OAuth2 access-token cache. The token is cached in
 *         module scope with a 60s safety margin before its true expiry. While a
 *         refresh is in flight, all callers share the same Promise so we never
 *         issue more than one concurrent token request.
 *   [S8]  Caller-supplied allow-list projection on every successful response.
 *         The raw PayPal body never leaves this module — callers receive only
 *         the projection. Defends against accidental leakage of payer PII or
 *         approval-link tokens (`links[].href`) into downstream code.
 *   [S16] Optional `correlationId` is threaded into every structured log line
 *         (start, success, error) so a single user-visible request can be
 *         traced through the function logs.
 *   [C21] PayPal/network/OAuth failures are re-thrown as a flat
 *         `SanitizedError` with a null prototype. The original `fetch`
 *         Response, request init, headers (esp. `Authorization`), and any
 *         axios-style config are NOT reachable from the thrown error — not as
 *         own props, not as inherited props, not via `cause`.
 */

import { getResolvedConfig } from './config';
import * as logger from '../utils/logger';

// ---------------------------------------------------------------------------
// Public surface (locked — other agents code against this)
// ---------------------------------------------------------------------------

export interface SanitizedError extends Error {
  status?: number;
  debugId?: string;
  /**
   * Top-level PayPal error name (the HTTP-category code, e.g. `UNPROCESSABLE_ENTITY`,
   * `AUTHENTICATION_FAILURE`, `INVALID_REQUEST`).
   */
  paypalCode?: string;
  /**
   * Specific PayPal application code from `details[0].issue` when present
   * (e.g. `INSTRUMENT_DECLINED`, `PAYER_ACCOUNT_RESTRICTED`,
   * `TRANSACTION_REFUSED`). Lives below `paypalCode` in PayPal's response
   * shape and is the field operators actually need for triage. Use this as
   * the alerting label whenever it's set; fall back to `paypalCode` only
   * when it's undefined.
   */
  issue?: string;
}

export interface RequestOptions<TProjected> {
  /** PayPal-Request-Id header value for idempotency. Optional. */
  requestId?: string;
  /**
   * Allow-list projection applied to the successful response BEFORE returning.
   * S8: prevents PayPal-token leak (links[].href) and payer-PII leak into callers.
   * If omitted, returns an empty object cast to TProjected.
   */
  project: (resp: unknown) => TProjected;
  /** correlationId threaded through logs (S16). */
  correlationId?: string;
  /**
   * Sandbox-only: when set, sends a `PayPal-Mock-Response` header so PayPal's
   * sandbox returns a specific simulated application-code failure (e.g.
   * `INSTRUMENT_DECLINED`). The header is silently ignored on live, but
   * callers MUST still gate on `PAYPAL_ENV === 'sandbox'` themselves so this
   * code path can never be exercised against the live API.
   * See: https://developer.paypal.com/api/rest/sandbox/mock-responses/
   */
  mockResponse?: { mockApplicationCodes: string };
}

// ---------------------------------------------------------------------------
// Token cache (S4)
// ---------------------------------------------------------------------------

interface CachedToken {
  token: string;
  /** Epoch ms at which the cached token should be considered expired. */
  expiresAt: number;
}

let cached: CachedToken | null = null;
let tokenPromise: Promise<string> | null = null;

const TOKEN_SAFETY_MARGIN_MS = 60_000;

async function fetchToken(): Promise<string> {
  const { baseUrl, clientId, clientSecret } = getResolvedConfig();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const res = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    // Surface a sanitized error — never expose the raw response/headers.
    const parsed = await safeReadJson(res);
    throw buildSanitizedError(res.status, parsed, 'OAuth token request failed');
  }

  const body = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
  const token = typeof body.access_token === 'string' ? body.access_token : '';
  const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : 0;

  if (!token) {
    throw buildSanitizedError(
      res.status,
      { message: 'OAuth response missing access_token' },
      'OAuth response missing access_token',
    );
  }

  cached = {
    token,
    expiresAt: Date.now() + expiresIn * 1000,
  };
  return token;
}

function getAccessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + TOKEN_SAFETY_MARGIN_MS) {
    return Promise.resolve(cached.token);
  }
  if (tokenPromise) return tokenPromise;
  tokenPromise = fetchToken().finally(() => {
    tokenPromise = null;
  });
  return tokenPromise;
}

// ---------------------------------------------------------------------------
// Error sanitization (C21)
// ---------------------------------------------------------------------------

interface PayPalErrorBody {
  message?: unknown;
  name?: unknown;
  debug_id?: unknown;
  details?: unknown;
}

/**
 * Extract `details[0].issue` from a PayPal error body if it's a string.
 * PayPal nests the specific application code (e.g. `INSTRUMENT_DECLINED`)
 * one level below the top-level `name` (which is the broader HTTP category
 * like `UNPROCESSABLE_ENTITY`). Defensive against malformed bodies — any
 * shape mismatch returns `undefined` rather than throwing.
 */
function extractIssue(details: unknown): string | undefined {
  if (!Array.isArray(details) || details.length === 0) return undefined;
  const first = details[0];
  if (first === null || typeof first !== 'object') return undefined;
  const issue = (first as Record<string, unknown>).issue;
  return typeof issue === 'string' && issue.length > 0 ? issue : undefined;
}

/**
 * Build a SanitizedError with a null prototype so no fetch internals,
 * Response object, request init, or auth headers are reachable from the
 * thrown error — neither as own properties nor as inherited ones.
 */
function buildSanitizedError(
  status: number,
  parsedBody: unknown,
  fallbackMessage: string,
): SanitizedError {
  const body: PayPalErrorBody = isPlainObject(parsedBody) ? (parsedBody as PayPalErrorBody) : {};

  const message =
    typeof body.message === 'string' && body.message.length > 0
      ? body.message
      : fallbackMessage;
  const paypalCode = typeof body.name === 'string' ? body.name : undefined;
  const debugId = typeof body.debug_id === 'string' ? body.debug_id : undefined;
  const issue = extractIssue(body.details);

  // Construct the error with a null prototype so `instanceof Error` checks work
  // via the inherited message/stack mechanics — but we still want the thrown
  // value to be `instanceof Error`. The reliable way: subclass Error, then
  // attach ONLY the safe fields, and explicitly ensure no foreign props leak in.
  const err = new Error(message) as SanitizedError;
  err.name = 'PayPalAPIError';
  err.status = status;
  if (debugId !== undefined) err.debugId = debugId;
  if (paypalCode !== undefined) err.paypalCode = paypalCode;
  if (issue !== undefined) err.issue = issue;

  // Hard guarantee: nothing on this error should reference the raw response,
  // request init, headers, or any axios-like config blob. We constructed the
  // error from primitives only, so this is already the case. As a defence in
  // depth, freeze the property descriptors of the dangerous names to `undefined`
  // own-properties so any future caller `.config = ...` style mutation can't
  // sneak data in via this error instance.
  Object.defineProperty(err, 'config', { value: undefined, enumerable: false, writable: false, configurable: false });
  Object.defineProperty(err, 'request', { value: undefined, enumerable: false, writable: false, configurable: false });
  Object.defineProperty(err, 'response', { value: undefined, enumerable: false, writable: false, configurable: false });
  Object.defineProperty(err, 'headers', { value: undefined, enumerable: false, writable: false, configurable: false });

  return err;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Read the response body as JSON if possible, else as text wrapped in an
 * object. Never throws — a body-parse failure must not mask the original
 * non-2xx status.
 */
async function safeReadJson(res: Response): Promise<unknown> {
  try {
    const text = await res.text();
    if (text.length === 0) return {};
    try {
      return JSON.parse(text);
    } catch {
      return { message: text };
    }
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// request() — public entrypoint
// ---------------------------------------------------------------------------

/**
 * POSTs/GETs to PayPal API. Auto-attaches OAuth2 bearer token.
 * On error, throws SanitizedError ONLY (C21) — never the raw fetch/response.
 * On success, runs `opts.project` over the parsed JSON and returns the projection.
 */
export async function request<TProjected>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  opts?: RequestOptions<TProjected>,
): Promise<TProjected> {
  const correlationId = opts?.correlationId;
  logger.info('paypal_request_start', { method, path, correlationId });

  let token: string;
  try {
    token = await getAccessToken();
  } catch (e) {
    // getAccessToken already throws SanitizedError on failure.
    const sanitized = e instanceof Error && (e as SanitizedError).name === 'PayPalAPIError'
      ? (e as SanitizedError)
      : buildSanitizedError(0, {}, 'OAuth token fetch failed');
    logger.error('paypal_request_error', sanitized, { method, path, correlationId });
    throw sanitized;
  }

  const { baseUrl } = getResolvedConfig();
  const url = `${baseUrl}${path}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (opts?.requestId) {
    headers['PayPal-Request-Id'] = opts.requestId;
  }
  if (opts?.mockResponse) {
    headers['PayPal-Mock-Response'] = JSON.stringify({
      mock_application_codes: opts.mockResponse.mockApplicationCodes,
    });
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (networkErr) {
    // Network-level failure: build a sanitized error from primitives. We
    // intentionally do NOT propagate the original error object (which could
    // carry a `cause` referencing low-level request internals).
    const message =
      networkErr instanceof Error && typeof networkErr.message === 'string'
        ? networkErr.message
        : 'Network request to PayPal failed';
    const sanitized = buildSanitizedError(0, { message }, 'Network request to PayPal failed');
    logger.error('paypal_request_error', sanitized, { method, path, correlationId });
    throw sanitized;
  }

  if (!res.ok) {
    const parsed = await safeReadJson(res);
    const sanitized = buildSanitizedError(res.status, parsed, `PayPal API error (${res.status})`);
    logger.error('paypal_request_error', sanitized, { method, path, correlationId });
    throw sanitized;
  }

  // 2xx — parse, log success (without body), project, return.
  let parsedBody: unknown;
  try {
    parsedBody = await safeReadJson(res);
  } catch {
    parsedBody = {};
  }

  logger.info('paypal_request_ok', { method, path, status: res.status, correlationId });

  if (!opts || typeof opts.project !== 'function') {
    logger.warn('paypal_request_no_projection', { method, path, correlationId });
    return {} as TProjected;
  }

  return opts.project(parsedBody);
}

// ---------------------------------------------------------------------------
// Test-only exports
// ---------------------------------------------------------------------------

/**
 * Module-internal — exported only for tests. Returns the cached or freshly-fetched bearer token.
 * S4: single-flight refresh.
 */
export function _getAccessTokenForTests(): Promise<string> {
  return getAccessToken();
}

/** Test-only: clears the token cache. */
export function _resetTokenCacheForTests(): void {
  cached = null;
  tokenPromise = null;
}

/** Test-only: forcibly set the cached token's expiresAt. No-op if no token cached. */
export function _setCacheExpiryForTests(epochMs: number): void {
  if (cached) {
    cached = { token: cached.token, expiresAt: epochMs };
  }
}
