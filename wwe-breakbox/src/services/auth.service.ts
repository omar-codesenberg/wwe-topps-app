import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as fbSignOut,
  updateProfile,
  onAuthStateChanged as fbOnAuthStateChanged,
  User,
  UserCredential,
} from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { firebaseAuth, firebaseDb } from '../config/firebase';

export async function signIn(email: string, password: string): Promise<UserCredential> {
  return signInWithEmailAndPassword(firebaseAuth, email, password);
}

export async function signUp(
  email: string,
  password: string,
  displayName: string
): Promise<UserCredential> {
  const credential = await createUserWithEmailAndPassword(firebaseAuth, email, password);
  await updateProfile(credential.user, { displayName });
  await createUserDocument(credential.user, { displayName });
  return credential;
}

export async function signOut(): Promise<void> {
  return fbSignOut(firebaseAuth);
}

export async function createUserDocument(
  user: User,
  overrides?: { displayName?: string }
): Promise<void> {
  const userRef = doc(firebaseDb, 'users', user.uid);
  const snap = await getDoc(userRef);
  if (!snap.exists()) {
    const displayName = overrides?.displayName ?? user.displayName ?? '';
    await setDoc(userRef, {
      email: user.email,
      displayName,
      firstName: '',
      lastName: '',
      username: displayName,
      shippingAddress: null,
      wantBaseCards: true,
      legacyUser: false,
      createdAt: serverTimestamp(),
      fcmToken: null,
      purchaseCount: 0,
      balance: 500,
    });
  } else if (snap.data()?.balance === undefined) {
    await setDoc(userRef, { balance: 500 }, { merge: true });
  }
}

export function onAuthStateChanged(callback: (user: User | null) => void): () => void {
  return fbOnAuthStateChanged(firebaseAuth, callback);
}
