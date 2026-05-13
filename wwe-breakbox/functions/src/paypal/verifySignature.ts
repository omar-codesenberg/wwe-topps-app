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

import { request, SanitizedError } from './client';
import * as logger from '../utils/logger';

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export type VerifyResult =
  | { state: 'success' }
  | { state: 'failure'; reason?: string }
  | { state: 'verifier_unavailable'; reason?: string };

export interface PayPalWebhookHeaders {
  transmissionId: string;
  transmissionTime: string;
  certUrl: string;
  authAlgo: string;
  transmissionSig: string;
}

// ---------------------------------------------------------------------------
// Dedupe cache
// ---------------------------------------------------------------------------

interface CachedEntry {
  result: VerifyResult;
  /** Epoch ms at which the entry should be discarded. */
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000;

const cache: Map<string, CachedEntry> = new Map();

function cacheGet(transmissionId: string): VerifyResult | undefined {
  const entry = cache.get(transmissionId);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(transmissionId);
    return undefined;
  }
  return entry.result;
}

function cachePut(transmissionId: string, result: VerifyResult): void {
  cache.set(transmissionId, {
    result,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

// ---------------------------------------------------------------------------
// Verifier
// ---------------------------------------------------------------------------

interface VerifierResponse {
  verification_status: string;
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
export async function verifyWebhookSignature(
  webhookId: string,
  headers: PayPalWebhookHeaders,
  rawBody: string,
  correlationId: string,
): Promise<VerifyResult> {
  const transmissionId = headers.transmissionId;

  // 1. Cache check — dedupe within the function instance.
  const cached = cacheGet(transmissionId);
  if (cached) {
    return cached;
  }

  // 2. Build verifier request body. The webhook event must be the parsed
  //    JSON, not the raw string — PayPal's verifier re-serializes it before
  //    matching against the signature.
  let webhookEvent: unknown;
  try {
    webhookEvent = JSON.parse(rawBody);
  } catch (parseErr) {
    // A non-JSON body cannot match any legitimate PayPal-signed payload.
    // Treat as definitive failure rather than transient unavailability.
    logger.error('paypal_webhook_verifier_failure_response_count', null, {
      correlationId,
      transmissionId,
    });
    const result: VerifyResult = {
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
  let response: VerifierResponse;
  try {
    response = await request<VerifierResponse>(
      'POST',
      '/v1/notifications/verify-webhook-signature',
      body,
      {
        project: (resp) => resp as VerifierResponse,
        correlationId,
      },
    );
  } catch (err) {
    // 5. Verifier-call failure (S3): network, 5xx, 401, 429, etc. Do NOT
    //    cache — the same transmissionId should be re-attempted on retry.
    const sanitized = err as SanitizedError;
    const status = sanitized?.status;
    const reason =
      typeof status === 'number'
        ? `verifier_call_error:status=${status}`
        : `verifier_call_error:${sanitized?.message ?? 'unknown'}`;
    logger.error('paypal_webhook_verifier_call_error', sanitized, {
      correlationId,
      transmissionId,
      status,
    });
    return { state: 'verifier_unavailable', reason };
  }

  // 4. Branch on verifier response (S3).
  if (response?.verification_status === 'SUCCESS') {
    const result: VerifyResult = { state: 'success' };
    cachePut(transmissionId, result);
    logger.info('paypal_webhook_verifier_ok', { correlationId });
    return result;
  }

  // Anything that isn't `SUCCESS` is treated as a definitive failure. PayPal
  // documents `SUCCESS` and `FAILURE`; a future status string we don't
  // recognize must NOT be silently accepted.
  const result: VerifyResult = {
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
export function _clearVerifierCacheForTests(): void {
  cache.clear();
}
