import { useState, useEffect } from 'react';
import { Purchase } from '../types/purchase.types';
import { subscribeToPurchases } from '../services/purchases.service';
import { useAuthStore } from '../store/authStore';

export function usePurchases() {
  const { user } = useAuthStore();
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!user) {
      setPurchases([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const unsubscribe = subscribeToPurchases(
      user.uid,
      (incoming) => {
        setPurchases(incoming);
        setLoading(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
      }
    );
    return unsubscribe;
  }, [user?.uid]);

  return { purchases, loading, error };
}
