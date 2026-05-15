"use strict";
/**
 * PayPal webhook signature verification.
 *
 * Implements:
 *   [C8]  Server-side verification via PayPal's
 *         `/v1/notifications/verify-webhook-signature` endpoint. Local
 *         certificate-chain verification is a follow-up task and is
 *         intentionally out of scope here.
 *   [S3]  Three-state result so the caller can distinguish a definitive
 *         signature failure (return 401, drop the event) from a transient
 *         verifier-call failure (return 503, allow PayPal to retry). This
 *         module NEVER throws — every code path returns a `VerifyResult`.
 *
 * A short-lived in-memory cache keyed by `transmissionId` deduplicates
 * verification calls within a single function instance. PayPal will retry
 * failed deliveries, and individual handler crashes can cause the same
 * `transmissionId` to be re-presented; the cache shaves the duplicate
 * round-trip when that happens within the TTL window.
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
exports.verifyWebhookSignature = verifyWebhookSignature;
exports._clearVerifierCacheForTests = _clearVerifierCacheForTests;
const client_1 = require("./client");
const logger = __importStar(require("../utils/logger"));
const CACHE_TTL_MS = 60000;
const cache = new Map();
function cacheGet(transmissionId) {
    const entry = cache.get(transmissionId);
    if (!entry)
        return undefined;
    if (entry.expiresAt <= Date.now()) {
        cache.delete(transmissionId);
        return undefined;
    }
    return entry.result;
}
function cachePut(transmissionId, result) {
    cache.set(transmissionId, {
        result,
        expiresAt: Date.now() + CACHE_TTL_MS,
    });
}
/**
 * Verifies a PayPal webhook event by calling PayPal's verifier endpoint.
 *
 * Caches results by `transmissionId` to dedupe duplicate verification calls
 * during retries (e.g., when a webhook handler crashes mid-processing and
 * PayPal re-delivers the same event). Cache TTL: 60s.
 *
 * NEVER throws — callers MUST branch on the discriminator:
 *   - `success`              → process the event
 *   - `failure`              → definitive forgery; caller returns 401
 *   - `verifier_unavailable` → transient; caller returns 503 so PayPal retries
 */
async function verifyWebhookSignature(webhookId, headers, rawBody, correlationId) {
    var _a;
    const transmissionId = headers.transmissionId;
    // 1. Cache check — dedupe within the function instance.
    const cached = cacheGet(transmissionId);
    if (cached) {
        return cached;
    }
    // 2. Build verifier request body. The webhook event must be the parsed
    //    JSON, not the raw string — PayPal's verifier re-serializes it before
    //    matching against the signature.
    let webhookEvent;
    try {
        webhookEvent = JSON.parse(rawBody);
    }
    catch (parseErr) {
        // A non-JSON body cannot match any legitimate PayPal-signed payload.
        // Treat as definitive failure rather than transient unavailability.
        logger.error('paypal_webhook_verifier_failure_response_count', null, {
            correlationId,
            transmissionId,
        });
        const result = {
            state: 'failure',
            reason: 'raw_body_not_json',
        };
        cachePut(transmissionId, result);
        return result;
    }
    const body = {
        auth_algo: headers.authAlgo,
        cert_url: headers.certUrl,
        transmission_id: headers.transmissionId,
        transmission_sig: headers.transmissionSig,
        transmission_time: headers.transmissionTime,
        webhook_id: webhookId,
        webhook_event: webhookEvent,
    };
    // 3. Call PayPal verifier.
    let response;
    try {
        response = await (0, client_1.request)('POST', '/v1/notifications/verify-webhook-signature', body, {
            project: (resp) => resp,
            correlationId,
        });
    }
    catch (err) {
        // 5. Verifier-call failure (S3): network, 5xx, 401, 429, etc. Do NOT
        //    cache — the same transmissionId should be re-attempted on retry.
        const sanitized = err;
        const status = sanitized === null || sanitized === void 0 ? void 0 : sanitized.status;
        const reason = typeof status === 'number'
            ? `verifier_call_error:status=${status}`
            : `verifier_call_error:${(_a = sanitized === null || sanitized === void 0 ? void 0 : sanitized.message) !== null && _a !== void 0 ? _a : 'unknown'}`;
        logger.error('paypal_webhook_verifier_call_error', sanitized, {
            correlationId,
            transmissionId,
            status,
        });
        return { state: 'verifier_unavailable', reason };
    }
    // 4. Branch on verifier response (S3).
    if ((response === null || response === void 0 ? void 0 : response.verification_status) === 'SUCCESS') {
        const result = { state: 'success' };
        cachePut(transmissionId, result);
        logger.info('paypal_webhook_verifier_ok', { correlationId });
        return result;
    }
    // Anything that isn't `SUCCESS` is treated as a definitive failure. PayPal
    // documents `SUCCESS` and `FAILURE`; a future status string we don't
    // recognize must NOT be silently accepted.
    const result = {
        state: 'failure',
        reason: 'verification_status=FAILURE',
    };
    cachePut(transmissionId, result);
    logger.error('paypal_webhook_verifier_failure_response_count', null, {
        correlationId,
        transmissionId,
    });
    return result;
}
// ---------------------------------------------------------------------------
// Test-only exports
// ---------------------------------------------------------------------------
/** Test-only: clear the in-memory dedupe cache. */
function _clearVerifierCacheForTests() {
    cache.clear();
}
//# sourceMappingURL=verifySignature.js.map