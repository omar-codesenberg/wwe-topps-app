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
import * as admin from 'firebase-admin';
import * as path from 'path';

function init() {
  if (admin.apps.length) return;
  const serviceAccountPath = path.join(__dirname, '..', '..', 'serviceAccount.json');
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccountPath),
  });
}

export async function grantAdmin(uidOrEmail: string): Promise<void> {
  init();
  const user = uidOrEmail.includes('@')
    ? await admin.auth().getUserByEmail(uidOrEmail)
    : await admin.auth().getUser(uidOrEmail);
  await admin.auth().setCustomUserClaims(user.uid, { admin: true });
  console.log(`Granted admin to ${user.uid} (${user.email ?? '<no email>'})`);
  console.log('User must sign out + back in to refresh their ID token.');
}

export async function revokeAdmin(uidOrEmail: string): Promise<void> {
  init();
  const user = uidOrEmail.includes('@')
    ? await admin.auth().getUserByEmail(uidOrEmail)
    : await admin.auth().getUser(uidOrEmail);
  await admin.auth().setCustomUserClaims(user.uid, { admin: false });
  console.log(`Revoked admin from ${user.uid} (${user.email ?? '<no email>'})`);
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
