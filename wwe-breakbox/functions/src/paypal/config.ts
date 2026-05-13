import { defineSecret } from 'firebase-functions/params';

/**
 * PayPal environment + secret resolution.
 *
 * Implements:
 *   [S7] Strict environment validation. `process.env.PAYPAL_ENV` MUST be
 *        exactly `"sandbox"` or `"live"` (case-sensitive). Any other value
 *        (unset, empty, `"Live"`, `"production"`, `"SANDBOX"`, ...) throws
 *        AT MODULE LOAD so a misconfigured deploy never reaches PayPal.
 *   [C4]  Per-environment secret references. The Secret Manager key names
 *        are suffixed with `_SANDBOX` or `_LIVE` so the same code path can
 *        target either environment without leaking cross-env credentials.
 *
 * The module is loaded once per function instance. `defineSecret` registers
 * the secret with the Firebase runtime — actual values are only materialized
 * when `.value()` is called inside an invocation that has been bound to the
 * secret via the v2 function options `{ secrets: [...] }`.
 */

export type PayPalEnv = 'sandbox' | 'live';

const RAW_ENV = process.env.PAYPAL_ENV;

if (RAW_ENV !== 'sandbox' && RAW_ENV !== 'live') {
  throw new Error(
    `PAYPAL_ENV must be exactly "sandbox" or "live", got: "${RAW_ENV ?? ''}"`
  );
}

export const PAYPAL_ENV: PayPalEnv = RAW_ENV;

export const PAYPAL_BASE_URL: string =
  PAYPAL_ENV === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';

/**
 * Suffix a base secret name with the resolved environment so sandbox and live
 * deployments pull from disjoint Secret Manager entries.
 */
function envSuffixed(base: string): string {
  return PAYPAL_ENV === 'live' ? `${base}_LIVE` : `${base}_SANDBOX`;
}

export const PAYPAL_CLIENT_ID = defineSecret(envSuffixed('PAYPAL_CLIENT_ID'));
export const PAYPAL_CLIENT_SECRET = defineSecret(
  envSuffixed('PAYPAL_CLIENT_SECRET')
);
export const PAYPAL_WEBHOOK_ID = defineSecret(envSuffixed('PAYPAL_WEBHOOK_ID'));

/**
 * Materialize all PayPal config values. MUST be called from inside a function
 * invocation whose options include these secrets in `secrets: [...]`; calling
 * at module load (or from an unbound function) will throw because
 * `defineSecret(...).value()` is only resolved at request time.
 */
export function getResolvedConfig(): {
  env: PayPalEnv;
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  webhookId: string;
} {
  return {
    env: PAYPAL_ENV,
    baseUrl: PAYPAL_BASE_URL,
    clientId: PAYPAL_CLIENT_ID.value(),
    clientSecret: PAYPAL_CLIENT_SECRET.value(),
    webhookId: PAYPAL_WEBHOOK_ID.value(),
  };
}
