import React, { useState } from 'react';
import Animated, { FadeInDown } from 'react-native-reanimated';
import {
  View,
  StyleSheet,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { EventsStackParamList } from '../../navigation/EventsStack';
import { SlotCard } from '../../components/slots/SlotCard';
import { useSlots } from '../../hooks/useSlots';
import { lockSlot } from '../../services/functions.service';
import { useAuthStore } from '../../store/authStore';
import { useToastStore } from '../../store/toastStore';
import { Slot } from '../../types/slot.types';
import { theme } from '../../constants/theme';

type Props = NativeStackScreenProps<EventsStackParamList, 'SlotsRoster'>;

export function SlotsRosterScreen({ route, navigation }: Props) {
  const { eventId } = route.params;
  const { slots, loading } = useSlots(eventId);
  const { user } = useAuthStore();
  const { show } = useToastStore();
  const [lockingSlotId, setLockingSlotId] = useState<string | null>(null);

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

  if (loading) {
    return <View style={styles.centered}><ActivityIndicator color={theme.colors.red} size="large" /></View>;
  }

  return (
    <FlatList
      style={styles.container}
      data={slots}
      keyExtractor={(item) => item.id}
      renderItem={({ item, index }) => (
        <Animated.View entering={FadeInDown.delay(index * 30).duration(300)}>
          <SlotCard
            slot={item}
            currentUserId={user?.uid}
            onBuySpot={handleBuySpot}
            isLocking={lockingSlotId === item.id}
          />
        </Animated.View>
      )}
      contentContainerStyle={styles.content}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  centered: { flex: 1, backgroundColor: theme.colors.background, alignItems: 'center', justifyContent: 'center' },
  content: { paddingBottom: 32 },
});
