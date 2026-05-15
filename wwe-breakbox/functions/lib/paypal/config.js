"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PAYPAL_WEBHOOK_ID = exports.PAYPAL_CLIENT_SECRET = exports.PAYPAL_CLIENT_ID = exports.PAYPAL_BASE_URL = exports.PAYPAL_ENV = void 0;
exports.getResolvedConfig = getResolvedConfig;
const params_1 = require("firebase-functions/params");
const RAW_ENV = process.env.PAYPAL_ENV;
if (RAW_ENV !== 'sandbox' && RAW_ENV !== 'live') {
    throw new Error(`PAYPAL_ENV must be exactly "sandbox" or "live", got: "${RAW_ENV !== null && RAW_ENV !== void 0 ? RAW_ENV : ''}"`);
}
exports.PAYPAL_ENV = RAW_ENV;
exports.PAYPAL_BASE_URL = exports.PAYPAL_ENV === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
/**
 * Suffix a base secret name with the resolved environment so sandbox and live
 * deployments pull from disjoint Secret Manager entries.
 */
function envSuffixed(base) {
    return exports.PAYPAL_ENV === 'live' ? `${base}_LIVE` : `${base}_SANDBOX`;
}
exports.PAYPAL_CLIENT_ID = (0, params_1.defineSecret)(envSuffixed('PAYPAL_CLIENT_ID'));
exports.PAYPAL_CLIENT_SECRET = (0, params_1.defineSecret)(envSuffixed('PAYPAL_CLIENT_SECRET'));
exports.PAYPAL_WEBHOOK_ID = (0, params_1.defineSecret)(envSuffixed('PAYPAL_WEBHOOK_ID'));
/**
 * Materialize all PayPal config values. MUST be called from inside a function
 * invocation whose options include these secrets in `secrets: [...]`; calling
 * at module load (or from an unbound function) will throw because
 * `defineSecret(...).value()` is only resolved at request time.
 */
function getResolvedConfig() {
    return {
        env: exports.PAYPAL_ENV,
        baseUrl: exports.PAYPAL_BASE_URL,
        clientId: exports.PAYPAL_CLIENT_ID.value(),
        clientSecret: exports.PAYPAL_CLIENT_SECRET.value(),
        webhookId: exports.PAYPAL_WEBHOOK_ID.value(),
    };
}
//# sourceMappingURL=config.js.map