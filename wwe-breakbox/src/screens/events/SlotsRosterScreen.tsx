import React, { useState } from 'react';
import Animated, { FadeInDown } from 'react-native-reanimated';
import {
  View,
  Text,
  StyleSheet,
  SectionList,
  ActivityIndicator,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { EventsStackParamList } from '../../navigation/EventsStack';
import { SlotCard } from '../../components/slots/SlotCard';
import { useSlots } from '../../hooks/useSlots';
import { useAuthStore } from '../../store/authStore';
import { useToastStore } from '../../store/toastStore';
import { BRAND_CONFIG } from '../../constants/brands';
import { Slot } from '../../types/slot.types';
import { theme } from '../../constants/theme';

type Props = NativeStackScreenProps<EventsStackParamList, 'SlotsRoster'>;

export function SlotsRosterScreen({ route, navigation }: Props) {
  const { eventId } = route.params;
  const { sections, loading } = useSlots(eventId);
  const { user } = useAuthStore();
  const { show } = useToastStore();
  const [lockingSlotId, setLockingSlotId] = useState<string | null>(null);

  const handleBuySpot = async (slot: Slot) => {
    if (!user) return;
    if (slot.status !== 'available') {
      show('This slot is not available.', 'error');
      return;
    }
    setLockingSlotId(slot.id);
    try {
      const lockedUntil = new Date(Date.now() + 600000).toISOString();
      navigation.navigate('Checkout', {
        eventId,
        slotId: slot.id,
        lockedUntil,
        slotData: slot,
      });
    } catch {
      show('Connection error. Please try again.', 'error');
    } finally {
      setLockingSlotId(null);
    }
  };

  if (loading) {
    return <View style={styles.centered}><ActivityIndicator color={theme.colors.red} size="large" /></View>;
  }

  return (
    <SectionList
      style={styles.container}
      sections={sections}
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
      renderSectionHeader={({ section }) => {
        const brand = section.title as keyof typeof BRAND_CONFIG;
        const config = BRAND_CONFIG[brand];
        return (
          <View style={[styles.sectionHeader, { backgroundColor: config.bgColor }]}>
            <View style={[styles.sectionBorder, { backgroundColor: config.color }]} />
            <Text style={[styles.sectionTitle, { color: config.color }]}>{config.label}</Text>
            <Text style={styles.sectionCount}>{section.data.length} SLOTS</Text>
          </View>
        );
      }}
      contentContainerStyle={styles.content}
      stickySectionHeadersEnabled
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  centered: { flex: 1, backgroundColor: theme.colors.background, alignItems: 'center', justifyContent: 'center' },
  content: { paddingBottom: 32 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: theme.spacing.md,
    gap: 8,
  },
  sectionBorder: { width: 4, height: 20, borderRadius: 2 },
  sectionTitle: { fontSize: theme.sizes.sm, fontWeight: '900', letterSpacing: 3, flex: 1 },
  sectionCount: { color: theme.colors.textDimmed, fontSize: theme.sizes.xs },
});
