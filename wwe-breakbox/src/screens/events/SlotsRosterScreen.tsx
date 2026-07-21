import React, { useState } from 'react';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { View, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { EventsStackParamList } from '../../navigation/EventsStack';
import { SlotCard } from '../../components/slots/SlotCard';
import { ScreenBackground } from '../../components/ui/ScreenBackground';
import { AppHeader } from '../../components/ui/AppHeader';
import { SlotOrbs } from '../../components/ui/SlotOrbs';
import { useSlots } from '../../hooks/useSlots';
import { useEvents } from '../../hooks/useEvents';
import { lockSlot } from '../../services/functions.service';
import { useAuthStore } from '../../store/authStore';
import { useToastStore } from '../../store/toastStore';
import { Slot } from '../../types/slot.types';
import { theme } from '../../constants/theme';

type Props = NativeStackScreenProps<EventsStackParamList, 'SlotsRoster'>;

export function SlotsRosterScreen({ route, navigation }: Props) {
  const { eventId } = route.params;
  const { slots, loading } = useSlots(eventId);
  const { events } = useEvents();
  const event = events.find((e) => e.id === eventId) ?? null;
  const { user } = useAuthStore();
  const { show } = useToastStore();
  const [lockingSlotId, setLockingSlotId] = useState<string | null>(null);

  const claimedCount = slots.filter((s) => s.status === 'sold').length;

  const handleBuySpot = async (slot: Slot) => {
    if (!user) return;
    if (slot.status === 'sold') {
      show('This slot has been claimed.', 'error');
      return;
    }
    if (slot.status === 'locked' && slot.lockedBy !== user.uid) {
      show('This slot is being reserved by another user.', 'error');
      return;
    }
    setLockingSlotId(slot.id);
    try {
      const result = await lockSlot({ eventId, slotId: slot.id });
      const data = result.data as { success: boolean; lockedUntil?: string; reason?: string };
      if (!data.success) {
        const message =
          data.reason === 'SLOT_LOCKED' ? 'This slot is being reserved by another user.' :
          data.reason === 'SLOT_SOLD' ? 'This slot has been claimed.' :
          data.reason === 'SLOT_CLOSED' ? 'This slot is closed.' :
          data.reason === 'EVENT_NOT_LIVE' ? 'This event is not live.' :
          data.reason === 'ALREADY_HAS_ACTIVE_LOCK' ? 'You already have an active reservation. Finish checkout or release it first.' :
          'Could not reserve slot. Try again.';
        show(message, 'error');
        return;
      }
      navigation.navigate('Checkout', {
        eventId,
        slotId: slot.id,
        lockedUntil: data.lockedUntil!,
        slotData: { ...slot, status: 'locked', lockedBy: user.uid },
      });
    } catch {
      show('Could not reserve slot. Try again.', 'error');
    } finally {
      setLockingSlotId(null);
    }
  };

  return (
    <ScreenBackground>
      <AppHeader
        title="PICK YOUR SLOT"
        subtitle={event ? event.title.toUpperCase() : undefined}
        onBack={() => navigation.goBack()}
        showLive={event?.status === 'live'}
      />
      <SlotOrbs
        count={Math.min(9, slots.length || 9)}
        claimed={claimedCount}
        size={20}
        style={styles.orbs}
      />
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={theme.colors.red} size="large" />
        </View>
      ) : (
        <FlatList
          data={slots}
          keyExtractor={(item) => item.id}
          renderItem={({ item, index }) => (
            <Animated.View entering={FadeInDown.delay(index * 30).duration(300)}>
              <SlotCard
                slot={item}
                index={index}
                currentUserId={user?.uid}
                onBuySpot={handleBuySpot}
                isLocking={lockingSlotId === item.id}
              />
            </Animated.View>
          )}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        />
      )}
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  orbs: { marginVertical: theme.spacing.md },
  content: { paddingBottom: 32, paddingTop: 4 },
});
