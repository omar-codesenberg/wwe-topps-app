import { useState, useCallback, useEffect, useRef } from 'react';
import { lockSlot, purchaseSlot, releaseSlotOnCancel } from '../services/functions.service';
import { useCountdown } from './useCountdown';

type LockState = 'idle' | 'locking' | 'locked' | 'expired' | 'purchasing' | 'purchased' | 'error';

interface LockData {
  slotId: string;
  eventId: string;
  lockedUntil: Date;
}

interface UseSlotLockReturn {
  state: LockState;
  lockData: LockData | null;
  secondsRemaining: number;
  errorReason: string | null;
  lock: (eventId: string, slotId: string) => Promise<void>;
  cancel: () => Promise<void>;
  purchase: () => Promise<{ purchaseId: string } | null>;
  reset: () => void;
}

export function useSlotLock(): UseSlotLockReturn {
  const [state, setState] = useState<LockState>('idle');
  const [lockData, setLockData] = useState<LockData | null>(null);
  const [errorReason, setErrorReason] = useState<string | null>(null);

  const { secondsRemaining } = useCountdown(
    state === 'locked' ? lockData?.lockedUntil ?? null : null,
    () => {
      if (state === 'locked') {
        setState('expired');
        setLockData(null);
      }
    }
  );

  const lock = useCallback(async (eventId: string, slotId: string) => {
    setState('locking');
    setErrorReason(null);
    try {
      const result = await lockSlot({ eventId, slotId });
      const data = result.data as any;
      if (data.success) {
        setLockData({ slotId, eventId, lockedUntil: new Date(data.lockedUntil) });
        setState('locked');
      } else {
        setErrorReason(data.reason);
        setState('error');
      }
    } catch (err) {
      setErrorReason('NETWORK_ERROR');
      setState('error');
    }
  }, []);

  const cancel = useCallback(async () => {
    if (lockData) {
      try {
        await releaseSlotOnCancel({ eventId: lockData.eventId, slotId: lockData.slotId });
      } catch {
        // silently ignore — server will clean up via scheduler
      }
    }
    setLockData(null);
    setState('idle');
  }, [lockData]);

  const purchase = useCallback(async () => {
    if (!lockData) return null;
    setState('purchasing');
    try {
      const result = await purchaseSlot({ eventId: lockData.eventId, slotId: lockData.slotId });
      const data = result.data as any;
      if (data.success) {
        setState('purchased');
        return { purchaseId: data.purchaseId };
      } else {
        setErrorReason(data.reason);
        setState('error');
        return null;
      }
    } catch {
      setErrorReason('NETWORK_ERROR');
      setState('error');
      return null;
    }
  }, [lockData]);

  const reset = useCallback(() => {
    setLockData(null);
    setState('idle');
    setErrorReason(null);
  }, []);

  return { state, lockData, secondsRemaining, errorReason, lock, cancel, purchase, reset };
}
