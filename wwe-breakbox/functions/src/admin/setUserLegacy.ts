import * as functions from 'firebase-functions';
import { db } from '../utils/admin';
import { requireAdmin } from '../utils/requireAdmin';

interface Input {
  uid: string;
  legacyUser: boolean;
}

export const setUserLegacy = functions
  .runWith({ minInstances: 0 })
  .https.onCall(async (data: Input, context) => {
    requireAdmin(context);
    const { uid, legacyUser } = data || ({} as Input);
    if (!uid || typeof legacyUser !== 'boolean') {
      throw new functions.https.HttpsError('invalid-argument', 'uid and legacyUser required');
    }
    const userRef = db.collection('users').doc(uid);
    const snap = await userRef.get();
    if (!snap.exists) {
      throw new functions.https.HttpsError('not-found', 'User not found');
    }
    await userRef.update({ legacyUser });
    return { success: true };
  });
