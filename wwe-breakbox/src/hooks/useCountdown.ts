import { useState, useEffect, useRef } from 'react';

export function useCountdown(targetDate: Date | null, onExpire?: () => void) {
  const [msRemaining, setMsRemaining] = useState<number>(() => {
    if (!targetDate) return 0;
    return Math.max(0, targetDate.getTime() - Date.now());
  });
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;
  const hasExpiredRef = useRef(false);

  useEffect(() => {
    if (!targetDate) return;
    hasExpiredRef.current = false;

    const tick = () => {
      const remaining = Math.max(0, targetDate.getTime() - Date.now());
      setMsRemaining(remaining);
      if (remaining === 0 && !hasExpiredRef.current) {
        hasExpiredRef.current = true;
        onExpireRef.current?.();
      }
    };

    tick();
    const interval = setInterval(tick, 100);
    return () => clearInterval(interval);
  }, [targetDate]);

  return {
    msRemaining,
    secondsRemaining: Math.ceil(msRemaining / 1000),
    isExpired: msRemaining === 0,
  };
}
