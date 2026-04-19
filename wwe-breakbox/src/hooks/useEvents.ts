import { useState, useEffect, useMemo } from 'react';
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

  const liveEvents = useMemo(
    () => events.filter((e) => e.status === 'live'),
    [events]
  );

  const upcomingEvents = useMemo(
    () =>
      events
        .filter((e) => e.status === 'upcoming')
        .sort((a, b) => a.opensAt.getTime() - b.opensAt.getTime()),
    [events]
  );

  return { events, liveEvents, upcomingEvents, loading };
}
