import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, browserLocalPersistence, setPersistence } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';

// Same config as the mobile app's wwe-breakbox/src/config/firebase.ts.
// Web API keys are public; security comes from Auth + Firestore rules + the
// admin custom claim, not from key secrecy.
const firebaseConfig = {
  apiKey: 'AIzaSyAZO6W0qeIz67TFpaCjOrdr2nXYVwZKRwI',
  authDomain: 'breakbox-wwe.firebaseapp.com',
  projectId: 'breakbox-wwe',
  storageBucket: 'breakbox-wwe.firebasestorage.app',
  messagingSenderId: '109982631461',
  appId: '1:109982631461:web:f60df4e23a1c539e0961cc',
  measurementId: 'G-KRR2MRCZDZ',
};

export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const firebaseAuth = getAuth(firebaseApp);
setPersistence(firebaseAuth, browserLocalPersistence).catch(() => {});
export const firebaseDb = getFirestore(firebaseApp);
export const firebaseFunctions = getFunctions(firebaseApp);
