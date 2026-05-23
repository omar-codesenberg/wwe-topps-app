/// <reference types="jest" />

import { mapPayPalIssueToUserFacing } from '../paypal/userFacingErrors';

describe('mapPayPalIssueToUserFacing', () => {
  describe('PayPal-side outage (5xx) — TEMPORARY_ERROR', () => {
    test('status 500 → TEMPORARY_ERROR even with an actionable issue', () => {
      // 5xx priority overrides any application code. Defends against PayPal
      // returning a misleading issue alongside a server-side error.
      const r = mapPayPalIssueToUserFacing('INSTRUMENT_DECLINED', 'INTERNAL_SERVER_ERROR', 500);
      expect(r.code).toBe('TEMPORARY_ERROR');
      expect(r.message).toMatch(/temporarily unavailable/);
    });

    test('status 503 → TEMPORARY_ERROR', () => {
      const r = mapPayPalIssueToUserFacing(undefined, 'SERVICE_UNAVAILABLE', 503);
      expect(r.code).toBe('TEMPORARY_ERROR');
    });

    test('paypalCode INTERNAL_SERVER_ERROR with no status → TEMPORARY_ERROR', () => {
      const r = mapPayPalIssueToUserFacing(undefined, 'INTERNAL_SERVER_ERROR', undefined);
      expect(r.code).toBe('TEMPORARY_ERROR');
    });
  });

  describe('safe specific codes', () => {
    test('INSTRUMENT_DECLINED → INSTRUMENT_DECLINED with try-different-method copy', () => {
      const r = mapPayPalIssueToUserFacing('INSTRUMENT_DECLINED', 'UNPROCESSABLE_ENTITY', 422);
      expect(r.code).toBe('INSTRUMENT_DECLINED');
      expect(r.message).toMatch(/declined/i);
      expect(r.message).toMatch(/different/i);
    });

    test('CARD_EXPIRED → CARD_EXPIRED with update-method copy', () => {
      const r = mapPayPalIssueToUserFacing('CARD_EXPIRED', 'UNPROCESSABLE_ENTITY', 422);
      expect(r.code).toBe('CARD_EXPIRED');
      expect(r.message).toMatch(/expired/i);
      expect(r.message).toMatch(/update/i);
    });
  });

  describe('CONTACT_SUPPORT — sensitive codes that must NOT leak specifics', () => {
    const sensitive = [
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
    ];

    test.each(sensitive)('%s → CONTACT_SUPPORT', (issue) => {
      const r = mapPayPalIssueToUserFacing(issue, 'UNPROCESSABLE_ENTITY', 422);
      expect(r.code).toBe('CONTACT_SUPPORT');
      // Must never leak the underlying PayPal code or risk-model hints.
      expect(r.message).not.toContain(issue);
      expect(r.message.toLowerCase()).not.toMatch(/restricted|refused|denied|compliance|fraud|locked|blocked|cancelled|attempts/);
    });

    test('CONTACT_SUPPORT copy does not give attacker any signal', () => {
      // Same message for ALL contact-support codes — attackers cannot
      // distinguish "fraud-flagged" from "account-locked" from "compliance"
      // by reading the user-facing text.
      const r1 = mapPayPalIssueToUserFacing('TRANSACTION_REFUSED', undefined, 422);
      const r2 = mapPayPalIssueToUserFacing('COMPLIANCE_VIOLATION', undefined, 422);
      const r3 = mapPayPalIssueToUserFacing('PAYER_ACCOUNT_RESTRICTED', undefined, 422);
      expect(r1.message).toBe(r2.message);
      expect(r2.message).toBe(r3.message);
    });
  });

  describe('GENERIC_DECLINE — catch-all', () => {
    test('unknown issue code → GENERIC_DECLINE', () => {
      const r = mapPayPalIssueToUserFacing('SOME_NEW_CODE_PAYPAL_INVENTED', 'UNPROCESSABLE_ENTITY', 422);
      expect(r.code).toBe('GENERIC_DECLINE');
      expect(r.message).not.toContain('SOME_NEW_CODE');
    });

    test('no issue, no paypalCode, no status → GENERIC_DECLINE', () => {
      const r = mapPayPalIssueToUserFacing(undefined, undefined, undefined);
      expect(r.code).toBe('GENERIC_DECLINE');
    });

    test('only paypalCode set (no issue) on a 4xx → GENERIC_DECLINE', () => {
      const r = mapPayPalIssueToUserFacing(undefined, 'UNPROCESSABLE_ENTITY', 422);
      expect(r.code).toBe('GENERIC_DECLINE');
    });
  });

  describe('security invariants — verified across the full mapping table', () => {
    // Spot-check the broader surface: no returned message should ever
    // contain raw PayPal codes verbatim.
    const allInputs: Array<[string | undefined, string | undefined, number | undefined]> = [
      ['INSTRUMENT_DECLINED', 'UNPROCESSABLE_ENTITY', 422],
      ['CARD_EXPIRED', 'UNPROCESSABLE_ENTITY', 422],
      ['PAYER_CANNOT_PAY', 'UNPROCESSABLE_ENTITY', 422],
      ['TRANSACTION_REFUSED', 'UNPROCESSABLE_ENTITY', 422],
      ['UNKNOWN_CODE', 'UNPROCESSABLE_ENTITY', 422],
      [undefined, 'INTERNAL_SERVER_ERROR', 500],
    ];

    test.each(allInputs)(
      'never echoes raw issue or paypalCode in user message — (%s, %s, %s)',
      (issue, paypalCode) => {
        const r = mapPayPalIssueToUserFacing(issue, paypalCode, 422);
        if (issue !== undefined) {
          // INSTRUMENT_DECLINED is the one exception — the word "declined"
          // appears intentionally in safe copy, but the full upper-snake
          // code never does.
          expect(r.message).not.toContain(issue);
        }
        if (paypalCode !== undefined) {
          expect(r.message).not.toContain(paypalCode);
        }
      },
    );

    test('every returned code is a member of the documented enum', () => {
      const validCodes = new Set([
        'INSTRUMENT_DECLINED',
        'CARD_EXPIRED',
        'TEMPORARY_ERROR',
        'CONTACT_SUPPORT',
        'GENERIC_DECLINE',
      ]);
      const samples = [
        mapPayPalIssueToUserFacing(undefined, undefined, undefined),
        mapPayPalIssueToUserFacing('INSTRUMENT_DECLINED', undefined, 422),
        mapPayPalIssueToUserFacing('PAYER_ACCOUNT_RESTRICTED', undefined, 422),
        mapPayPalIssueToUserFacing(undefined, undefined, 500),
        mapPayPalIssueToUserFacing('UNKNOWN', undefined, 422),
      ];
      for (const s of samples) {
        expect(validCodes.has(s.code)).toBe(true);
      }
    });
  });
});
