import { useState, useEffect } from 'react';
import { Purchase } from '../types/purchase.types';
import { subscribeToPurchases } from '../services/purchases.service';
import { useAuthStore } from '../store/authStore';

export function usePurchases() {
  const { user } = useAuthStore();
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setPurchases([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsubscribe = subscribeToPurchases(user.uid, (incoming) => {
      setPurchases(incoming);
      setLoading(false);
    });
    return unsubscribe;
  }, [user?.uid]);

  return { purchases, loading };
}
