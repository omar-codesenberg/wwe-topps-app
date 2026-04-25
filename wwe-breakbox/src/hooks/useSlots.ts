import { useState, useEffect } from 'react';
import { Slot } from '../types/slot.types';
import { subscribeToSlots } from '../services/slots.service';

export function useSlots(eventId: string | null) {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!eventId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsubscribe = subscribeToSlots(eventId, (incoming) => {
      setSlots(incoming);
      setLoading(false);
    });
    return unsubscribe;
  }, [eventId]);

  return { slots, loading };
}
