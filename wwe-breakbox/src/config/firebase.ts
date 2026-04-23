import { Platform } from 'react-native';
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  initializeAuth,
  // @ts-ignore – exported at runtime
  getReactNativePersistence,
  browserLocalPersistence,
  Auth,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import AsyncStorage from '@react-native-async-storage/async-storage';

const firebaseConfig = {
  apiKey: 'AIzaSyAZO6W0qeIz67TFpaCjOrdr2nXYVwZKRwI',
  authDomain: 'breakbox-wwe.firebaseapp.com',
  projectId: 'breakbox-wwe',
  storageBucket: 'breakbox-wwe.firebasestorage.app',
  messagingSenderId: '109982631461',
  appId: '1:109982631461:web:f60df4e23a1c539e0961cc',
  measurementId: 'G-KRR2MRCZDZ',
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

let authInstance: Auth;
if (Platform.OS === 'web') {
  authInstance = getAuth(app);
  authInstance.setPersistence?.(browserLocalPersistence).catch(() => {});
} else {
  try {
    authInstance = initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch {
    authInstance = getAuth(app);
  }
}

export const firebaseApp = app;
export const firebaseAuth = authInstance;
export const firebaseDb = getFirestore(app);
export const firebaseFunctions = getFunctions(app);

if (Platform.OS === 'web' && process.env.EXPO_PUBLIC_USE_EMULATORS === '1') {
  connectFunctionsEmulator(firebaseFunctions, 'localhost', 5001);
}

export default {
  app,
  auth: firebaseAuth,
  db: firebaseDb,
  functions: firebaseFunctions,
};
