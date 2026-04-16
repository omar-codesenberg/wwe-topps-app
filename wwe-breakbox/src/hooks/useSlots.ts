import { useState, useEffect, useMemo } from 'react';
import { Slot } from '../types/slot.types';
import { Brand, BRANDS } from '../constants/brands';
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

  const slotsByBrand = useMemo(() => {
    const grouped: Record<Brand, Slot[]> = { RAW: [], SMACKDOWN: [], NXT: [], LEGENDS: [] };
    for (const slot of slots) {
      if (grouped[slot.brand]) {
        grouped[slot.brand].push(slot);
      }
    }
    return grouped;
  }, [slots]);

  const sections = useMemo(() => {
    return BRANDS
      .map((brand) => ({ title: brand, data: slotsByBrand[brand] }))
      .filter((section) => section.data.length > 0);
  }, [slotsByBrand]);

  return { slots, slotsByBrand, sections, loading };
}
