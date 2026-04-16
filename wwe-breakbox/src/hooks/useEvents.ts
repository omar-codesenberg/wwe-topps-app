import { useState, useEffect } from 'react';
import { BreakEvent } from '../types/event.types';
import { subscribeToEvents } from '../services/events.service';

export function useEvents() {
  const [events, setEvents] = useState<BreakEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = subscribeToEvents((incoming) => {
      setEvents(incoming);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  return { events, loading };
}
