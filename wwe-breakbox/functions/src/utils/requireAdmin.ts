import * as functions from 'firebase-functions';

/**
 * Throws an HttpsError if the caller is not authenticated as an admin.
 * Admin status comes from the `admin: true` custom claim on the user's ID token.
 * Set this claim using `functions/src/admin/grantAdmin.ts`.
 */
export function requireAdmin(context: functions.https.CallableContext): void {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be authenticated');
  }
  if (context.auth.token.admin !== true) {
    throw new functions.https.HttpsError('permission-denied', 'Admin privileges required');
  }
}
