import { useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { firebaseDb } from '../config/firebase';
import { useAuthStore } from '../store/authStore';
import { useWalletStore } from '../store/walletStore';
import { onAuthStateChanged, createUserDocument } from '../services/auth.service';

export function useAuth() {
  const { setUser, setLoading } = useAuthStore();
  const { setBalance } = useWalletStore();

  useEffect(() => {
    let unsubBalance: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(async (user) => {
      if (unsubBalance) {
        unsubBalance();
        unsubBalance = null;
      }
      if (user) {
        await createUserDocument(user);
        unsubBalance = onSnapshot(doc(firebaseDb, 'users', user.uid), (snap) => {
          const data = snap.data();
          setBalance(data?.balance ?? 0);
        });
      } else {
        setBalance(0);
      }
      setUser(user);
      setLoading(false);
    });

    return () => {
      unsubAuth();
      if (unsubBalance) unsubBalance();
    };
  }, []);
}
