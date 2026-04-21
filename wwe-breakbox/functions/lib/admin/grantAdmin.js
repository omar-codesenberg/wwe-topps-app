"use strict";
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
exports.grantAdmin = grantAdmin;
exports.revokeAdmin = revokeAdmin;
/**
 * One-shot script to grant the `admin: true` custom claim to a Firebase user.
 *
 * Prerequisites:
 *   1. Place your service account JSON at functions/serviceAccount.json
 *   2. From the `functions/` directory:
 *        npm run build
 *        node -e "require('./lib/admin/grantAdmin').grantAdmin('<uid-or-email>')"
 *
 * After running, the granted user must sign out + back in (or call
 * getIdToken(true)) to receive a refreshed token containing the claim.
 *
 * NOTE: This file is intentionally NOT exported from index.ts and NOT deployed
 * as a callable. It runs locally with admin SDK credentials only.
 */
const admin = __importStar(require("firebase-admin"));
const path = __importStar(require("path"));
function init() {
    if (admin.apps.length)
        return;
    const serviceAccountPath = path.join(__dirname, '..', '..', 'serviceAccount.json');
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccountPath),
    });
}
async function grantAdmin(uidOrEmail) {
    var _a;
    init();
    const user = uidOrEmail.includes('@')
        ? await admin.auth().getUserByEmail(uidOrEmail)
        : await admin.auth().getUser(uidOrEmail);
    await admin.auth().setCustomUserClaims(user.uid, { admin: true });
    console.log(`Granted admin to ${user.uid} (${(_a = user.email) !== null && _a !== void 0 ? _a : '<no email>'})`);
    console.log('User must sign out + back in to refresh their ID token.');
}
async function revokeAdmin(uidOrEmail) {
    var _a;
    init();
    const user = uidOrEmail.includes('@')
        ? await admin.auth().getUserByEmail(uidOrEmail)
        : await admin.auth().getUser(uidOrEmail);
    await admin.auth().setCustomUserClaims(user.uid, { admin: false });
    console.log(`Revoked admin from ${user.uid} (${(_a = user.email) !== null && _a !== void 0 ? _a : '<no email>'})`);
}
// Allow direct CLI invocation: node lib/admin/grantAdmin.js grant <uid-or-email>
if (require.main === module) {
    const [, , action, target] = process.argv;
    if (!target || (action !== 'grant' && action !== 'revoke')) {
        console.error('Usage: node grantAdmin.js <grant|revoke> <uid-or-email>');
        process.exit(1);
    }
    const fn = action === 'grant' ? grantAdmin : revokeAdmin;
    fn(target)
        .then(() => process.exit(0))
        .catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
//# sourceMappingURL=grantAdmin.js.map