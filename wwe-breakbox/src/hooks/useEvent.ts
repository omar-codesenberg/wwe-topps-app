import { useState, useEffect } from 'react';
import { BreakEvent } from '../types/event.types';
import { subscribeToEvent } from '../services/events.service';

export function useEvent(eventId: string | null) {
  const [event, setEvent] = useState<BreakEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!eventId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsubscribe = subscribeToEvent(eventId, (evt) => {
      setEvent(evt);
      setLoading(false);
    });
    return unsubscribe;
  }, [eventId]);

  return { event, loading, error };
}
