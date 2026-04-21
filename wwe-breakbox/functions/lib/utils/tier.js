"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deriveTier = deriveTier;
function deriveTier(price) {
    if (price >= 5000)
        return 'Gold';
    if (price >= 1000)
        return 'Silver';
    return 'Bronze';
}
//# sourceMappingURL=tier.js.map