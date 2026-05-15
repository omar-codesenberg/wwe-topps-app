"use strict";
/// <reference types="jest" />
/// <reference types="node" />
/**
 * [S7] Strict env validation for the PayPal config module.
 *
 * The validation runs at module top-level, so each case must:
 *   1. `jest.resetModules()` to clear the require cache.
 *   2. Set (or delete) `process.env.PAYPAL_ENV` BEFORE the require call.
 *   3. `require('../paypal/config')` and assert on throw / exported values.
 *
 * `firebase-functions/params` is mocked because `defineSecret` would
 * otherwise try to register against the Firebase runtime and fail under Jest.
 */
jest.mock('firebase-functions/params', () => ({
    defineSecret: (name) => ({
        name,
        value: () => `mocked-${name}`,
    }),
}));
describe('paypal/config — [S7] PAYPAL_ENV strict validation', () => {
    const ORIGINAL_ENV = process.env.PAYPAL_ENV;
    beforeEach(() => {
        jest.resetModules();
        delete process.env.PAYPAL_ENV;
    });
    afterAll(() => {
        if (ORIGINAL_ENV === undefined) {
            delete process.env.PAYPAL_ENV;
        }
        else {
            process.env.PAYPAL_ENV = ORIGINAL_ENV;
        }
    });
    test('throws when PAYPAL_ENV is unset', () => {
        expect(() => require('../paypal/config')).toThrow(/PAYPAL_ENV/);
    });
    test('throws when PAYPAL_ENV is empty string', () => {
        process.env.PAYPAL_ENV = '';
        expect(() => require('../paypal/config')).toThrow(/PAYPAL_ENV/);
    });
    test('throws when PAYPAL_ENV is "Live" (case-sensitive)', () => {
        process.env.PAYPAL_ENV = 'Live';
        expect(() => require('../paypal/config')).toThrow(/PAYPAL_ENV/);
    });
    test('throws when PAYPAL_ENV is "production"', () => {
        process.env.PAYPAL_ENV = 'production';
        expect(() => require('../paypal/config')).toThrow(/PAYPAL_ENV/);
    });
    test('throws when PAYPAL_ENV is "SANDBOX" (case-sensitive)', () => {
        process.env.PAYPAL_ENV = 'SANDBOX';
        expect(() => require('../paypal/config')).toThrow(/PAYPAL_ENV/);
    });
    test('loads cleanly when PAYPAL_ENV="sandbox" and exports sandbox base URL', () => {
        process.env.PAYPAL_ENV = 'sandbox';
        const mod = require('../paypal/config');
        expect(mod.PAYPAL_ENV).toBe('sandbox');
        expect(mod.PAYPAL_BASE_URL).toBe('https://api-m.sandbox.paypal.com');
    });
    test('loads cleanly when PAYPAL_ENV="live" and exports live base URL', () => {
        process.env.PAYPAL_ENV = 'live';
        const mod = require('../paypal/config');
        expect(mod.PAYPAL_ENV).toBe('live');
        expect(mod.PAYPAL_BASE_URL).toBe('https://api-m.paypal.com');
    });
});
//# sourceMappingURL=configValidation.test.js.map