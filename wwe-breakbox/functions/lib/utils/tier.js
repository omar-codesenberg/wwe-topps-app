"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deriveTier = deriveTier;
/**
 * Derive a tier from a price expressed in integer cents.
 * Gold = $5,000+ (>= 500_000 cents)
 * Silver = $1,000+ (>= 100_000 cents)
 * Bronze = below $1,000.
 */
function deriveTier(priceCents) {
    if (priceCents >= 500000)
        return 'Gold';
    if (priceCents >= 100000)
        return 'Silver';
    return 'Bronze';
}
//# sourceMappingURL=tier.js.map