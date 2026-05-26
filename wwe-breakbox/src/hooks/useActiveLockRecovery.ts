import { useEffect, useRef } from 'react';
import { useAuthStore } from '../store/authStore';
import { getMyActiveLock } from '../services/functions.service';
import { navigationRef } from '../navigation/navigationRef';
import { Slot } from '../types/slot.types';

// On the first auth-resolve for a given uid, ask the server whether this user
// is holding a non-expired slot lock. If so, deep-link to Checkout so the user
// resumes their reservation without having to navigate back to the event.
export function useActiveLockRecovery() {
  const { user, isLoading } = useAuthStore();
  const recoveredForUid = useRef<string | null>(null);

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      recoveredForUid.current = null;
      return;
    }
    if (recoveredForUid.current === user.uid) return;
    recoveredForUid.current = user.uid;

    let cancelled = false;
    (async () => {
      try {
        const result = await getMyActiveLock();
        const data = result.data;
        if (cancelled || !data.active) return;

        // Navigator may not be ready on the very first render tick.
        for (let i = 0; i < 20 && !navigationRef.isReady(); i++) {
          await new Promise((r) => setTimeout(r, 50));
        }
        if (!navigationRef.isReady()) return;

        const slotData: Slot = {
          ...data.slot,
          lockedAt: data.slot.lockedAt ? new Date(data.slot.lockedAt) : null,
          lockedUntil: new Date(data.slot.lockedUntil),
          purchasedAt: null,
        } as Slot;

        navigationRef.navigate('Events', {
          screen: 'Checkout',
          params: {
            eventId: data.eventId,
            slotId: data.slotId,
            lockedUntil: data.lockedUntil,
            slotData,
          },
        });
      } catch {
        // Recovery is best-effort: lock will still expire server-side, and
        // the SlotCard's "CHECKOUT" button gives the user a manual path back.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.uid, isLoading]);
}
