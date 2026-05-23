/**
 * Maps PayPal API failures to safe user-facing messages.
 *
 * Security rationale
 * ------------------
 *
 * PayPal returns two layers of error code:
 *   - Top-level `name`        (HTTP category, e.g. `UNPROCESSABLE_ENTITY`)
 *   - `details[0].issue`      (application code, e.g. `INSTRUMENT_DECLINED`)
 *
 * Many `issue` values describe risk-model outcomes (`TRANSACTION_REFUSED`,
 * `COMPLIANCE_VIOLATION`, `PAYER_ACCOUNT_RESTRICTED`) or buyer-side account
 * state. Surfacing those verbatim to the client would:
 *   - let fraudsters confirm when they've tripped fraud detection and pivot,
 *   - leak PayPal-internal account-state info into our UI,
 *   - give phishers ready-made, recognizable error strings to reuse.
 *
 * This module compiles the raw PayPal codes down to a small enum of
 * user-facing categories. Only two categories ever surface a *specific*
 * reason to the user: `INSTRUMENT_DECLINED` and `CARD_EXPIRED`, both of
 * which the user already saw on PayPal's approval UI — so we add no new
 * information leak. Everything else (including unknown codes) returns
 * generic copy.
 *
 * The returned `code` is OUR enum, not PayPal's — callers (mobile, web)
 * can branch on it for localization or UI affordances without ever seeing
 * the raw PayPal code.
 */

export type UserFacingErrorCode =
  /** Buyer's payment instrument was declined — actionable: try another method. */
  | 'INSTRUMENT_DECLINED'
  /** Buyer's card has expired — actionable: update payment method. */
  | 'CARD_EXPIRED'
  /** PayPal-side outage (5xx). Suggest retry. */
  | 'TEMPORARY_ERROR'
  /**
   * Sensitive or unactionable PayPal state (restrictions, refusals,
   * compliance flags). We deliberately do not tell the user the underlying
   * cause — generic "contact PayPal or use a different account."
   */
  | 'CONTACT_SUPPORT'
  /** Catch-all for unknown codes; same generic copy as a non-specific decline. */
  | 'GENERIC_DECLINE';

export interface UserFacingError {
  /** Stable client-facing code. Clients may key UI affordances on this. */
  code: UserFacingErrorCode;
  /** Pre-rendered user-safe English message; safe to display verbatim. */
  message: string;
}

/**
 * PayPal `details[0].issue` values that map to `CONTACT_SUPPORT`. Each of
 * these signals account-state or risk-model information that must not be
 * echoed to the user.
 *
 * Sources:
 *   https://developer.paypal.com/api/rest/reference/orders/v2/errors/
 *   https://developer.paypal.com/api/rest/reference/payments/v2/errors/
 */
const CONTACT_SUPPORT_ISSUES: ReadonlySet<string> = new Set([
  'PAYER_CANNOT_PAY',
  'PAYER_ACCOUNT_RESTRICTED',
  'PAYEE_ACCOUNT_RESTRICTED',
  'TRANSACTION_REFUSED',
  'PAYMENT_DENIED',
  'COMPLIANCE_VIOLATION',
  'TRANSACTION_BLOCKED_BY_PAYEE',
  'AGREEMENT_ALREADY_CANCELLED',
  'PAYER_ACCOUNT_LOCKED_OR_CLOSED',
  'MAX_NUMBER_OF_PAYMENT_ATTEMPTS_EXCEEDED',
]);

/**
 * Map a sanitized PayPal error into a user-facing error.
 *
 * @param issue       Specific application code (e.g. `INSTRUMENT_DECLINED`).
 *                    Sourced from `SanitizedError.issue` (extracted from
 *                    PayPal's `details[0].issue`).
 * @param paypalCode  Top-level error name (e.g. `UNPROCESSABLE_ENTITY`,
 *                    `INTERNAL_SERVER_ERROR`). Sourced from
 *                    `SanitizedError.paypalCode`.
 * @param status      HTTP status from PayPal. Used to detect PayPal-side
 *                    outages (5xx).
 */
export function mapPayPalIssueToUserFacing(
  issue: string | undefined,
  paypalCode: string | undefined,
  status: number | undefined,
): UserFacingError {
  // PayPal-side outage gets priority over any application code — even if
  // PayPal returns a 5xx with a misleading `issue`, we surface "try again."
  if (
    (typeof status === 'number' && status >= 500) ||
    paypalCode === 'INTERNAL_SERVER_ERROR'
  ) {
    return {
      code: 'TEMPORARY_ERROR',
      message:
        'PayPal is temporarily unavailable. Please try again in a moment.',
    };
  }

  // Safe, actionable, specific codes.
  if (issue === 'INSTRUMENT_DECLINED') {
    return {
      code: 'INSTRUMENT_DECLINED',
      message:
        'Your payment method was declined. Please try a different card or funding source.',
    };
  }
  if (issue === 'CARD_EXPIRED') {
    return {
      code: 'CARD_EXPIRED',
      message:
        'The card on file has expired. Please update your payment method and try again.',
    };
  }

  // Sensitive — no specifics.
  if (issue !== undefined && CONTACT_SUPPORT_ISSUES.has(issue)) {
    return {
      code: 'CONTACT_SUPPORT',
      message:
        "Your payment couldn't be completed. Please try a different account or contact PayPal.",
    };
  }

  // Catch-all (unknown / unmapped / undefined).
  return {
    code: 'GENERIC_DECLINE',
    message:
      "Your payment couldn't be completed. Please try again or use a different payment method.",
  };
}
