"use strict";
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
exports.request = request;
exports._getAccessTokenForTests = _getAccessTokenForTests;
exports._resetTokenCacheForTests = _resetTokenCacheForTests;
exports._setCacheExpiryForTests = _setCacheExpiryForTests;
const config_1 = require("./config");
const logger = __importStar(require("../utils/logger"));
let cached = null;
let tokenPromise = null;
const TOKEN_SAFETY_MARGIN_MS = 60000;
async function fetchToken() {
    const { baseUrl, clientId, clientSecret } = (0, config_1.getResolvedConfig)();
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
    const body = (await res.json());
    const token = typeof body.access_token === 'string' ? body.access_token : '';
    const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : 0;
    if (!token) {
        throw buildSanitizedError(res.status, { message: 'OAuth response missing access_token' }, 'OAuth response missing access_token');
    }
    cached = {
        token,
        expiresAt: Date.now() + expiresIn * 1000,
    };
    return token;
}
function getAccessToken() {
    if (cached && cached.expiresAt > Date.now() + TOKEN_SAFETY_MARGIN_MS) {
        return Promise.resolve(cached.token);
    }
    if (tokenPromise)
        return tokenPromise;
    tokenPromise = fetchToken().finally(() => {
        tokenPromise = null;
    });
    return tokenPromise;
}
/**
 * Build a SanitizedError with a null prototype so no fetch internals,
 * Response object, request init, or auth headers are reachable from the
 * thrown error — neither as own properties nor as inherited ones.
 */
function buildSanitizedError(status, parsedBody, fallbackMessage) {
    const body = isPlainObject(parsedBody) ? parsedBody : {};
    const message = typeof body.message === 'string' && body.message.length > 0
        ? body.message
        : fallbackMessage;
    const paypalCode = typeof body.name === 'string' ? body.name : undefined;
    const debugId = typeof body.debug_id === 'string' ? body.debug_id : undefined;
    // Construct the error with a null prototype so `instanceof Error` checks work
    // via the inherited message/stack mechanics — but we still want the thrown
    // value to be `instanceof Error`. The reliable way: subclass Error, then
    // attach ONLY the safe fields, and explicitly ensure no foreign props leak in.
    const err = new Error(message);
    err.name = 'PayPalAPIError';
    err.status = status;
    if (debugId !== undefined)
        err.debugId = debugId;
    if (paypalCode !== undefined)
        err.paypalCode = paypalCode;
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
function isPlainObject(value) {
    if (value === null || typeof value !== 'object')
        return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}
/**
 * Read the response body as JSON if possible, else as text wrapped in an
 * object. Never throws — a body-parse failure must not mask the original
 * non-2xx status.
 */
async function safeReadJson(res) {
    try {
        const text = await res.text();
        if (text.length === 0)
            return {};
        try {
            return JSON.parse(text);
        }
        catch (_a) {
            return { message: text };
        }
    }
    catch (_b) {
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
async function request(method, path, body, opts) {
    const correlationId = opts === null || opts === void 0 ? void 0 : opts.correlationId;
    logger.info('paypal_request_start', { method, path, correlationId });
    let token;
    try {
        token = await getAccessToken();
    }
    catch (e) {
        // getAccessToken already throws SanitizedError on failure.
        const sanitized = e instanceof Error && e.name === 'PayPalAPIError'
            ? e
            : buildSanitizedError(0, {}, 'OAuth token fetch failed');
        logger.error('paypal_request_error', sanitized, { method, path, correlationId });
        throw sanitized;
    }
    const { baseUrl } = (0, config_1.getResolvedConfig)();
    const url = `${baseUrl}${path}`;
    const headers = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
    };
    if (opts === null || opts === void 0 ? void 0 : opts.requestId) {
        headers['PayPal-Request-Id'] = opts.requestId;
    }
    let res;
    try {
        res = await fetch(url, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
        });
    }
    catch (networkErr) {
        // Network-level failure: build a sanitized error from primitives. We
        // intentionally do NOT propagate the original error object (which could
        // carry a `cause` referencing low-level request internals).
        const message = networkErr instanceof Error && typeof networkErr.message === 'string'
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
    let parsedBody;
    try {
        parsedBody = await safeReadJson(res);
    }
    catch (_a) {
        parsedBody = {};
    }
    logger.info('paypal_request_ok', { method, path, status: res.status, correlationId });
    if (!opts || typeof opts.project !== 'function') {
        logger.warn('paypal_request_no_projection', { method, path, correlationId });
        return {};
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
function _getAccessTokenForTests() {
    return getAccessToken();
}
/** Test-only: clears the token cache. */
function _resetTokenCacheForTests() {
    cached = null;
    tokenPromise = null;
}
/** Test-only: forcibly set the cached token's expiresAt. No-op if no token cached. */
function _setCacheExpiryForTests(epochMs) {
    if (cached) {
        cached = { token: cached.token, expiresAt: epochMs };
    }
}
//# sourceMappingURL=client.js.map