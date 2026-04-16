import React, { useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { Slot } from '../../types/slot.types';
import { GlassCard } from '../ui/GlassCard';
import { TierBadge } from '../ui/TierBadge';
import { StatusBadge } from '../ui/StatusBadge';
import { WWEButton } from '../ui/WWEButton';
import { BRAND_CONFIG } from '../../constants/brands';
import { theme } from '../../constants/theme';

interface SlotCardProps {
  slot: Slot;
  currentUserId?: string;
  onBuySpot: (slot: Slot) => void;
  isLocking?: boolean;
}

export function SlotCard({ slot, currentUserId, onBuySpot, isLocking }: SlotCardProps) {
  const isAvailable = slot.status === 'available';
  const isSold = slot.status === 'sold';
  const isLocked = slot.status === 'locked';
  const isMyLock = slot.status === 'locked' && slot.lockedBy === currentUserId;
  const brandColor = BRAND_CONFIG[slot.brand].color;

  // Pulse animation for locked-by-others slots
  const pulseAnim = useRef(new Animated.Value(1)).current;
  // Fade for sold slots
  const fadeAnim = useRef(new Animated.Value(isSold ? 0.45 : 1)).current;

  useEffect(() => {
    if (isLocked && !isMyLock) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.4, duration: 700, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
    }
  }, [isLocked, isMyLock]);

  useEffect(() => {
    if (isSold) {
      Animated.timing(fadeAnim, { toValue: 0.45, duration: 400, useNativeDriver: true }).start();
    } else {
      Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    }
  }, [isSold]);

  return (
    <Animated.View style={{ opacity: fadeAnim }}>
      <GlassCard style={[styles.card, (isSold) && styles.soldCard]}>
        <View style={[styles.brandBar, { backgroundColor: brandColor }]} />
        <View style={styles.content}>
          <View style={styles.left}>
            <Text style={[styles.name, isSold && styles.dimmedText]} numberOfLines={2}>
              {slot.wrestlerName}
            </Text>
            {slot.members.length > 0 && (
              <Text style={styles.members} numberOfLines={1}>
                {slot.members.join(' • ')}
              </Text>
            )}
            <View style={styles.badges}>
              <TierBadge tier={slot.tier} />
              <StatusBadge status={slot.status} isMyLock={isMyLock} />
            </View>
          </View>
          <View style={styles.right}>
            <Text style={[styles.price, isSold && styles.dimmedText]}>
              ${slot.price.toLocaleString()}
            </Text>
            {isAvailable && (
              <WWEButton
                label="BUY SPOT"
                onPress={() => onBuySpot(slot)}
                loading={isLocking}
                style={styles.buyButton}
                textStyle={styles.buyButtonText}
              />
            )}
            {isMyLock && (
              <WWEButton
                label="CHECKOUT"
                onPress={() => onBuySpot(slot)}
                style={[styles.buyButton, styles.checkoutButton]}
                textStyle={styles.buyButtonText}
              />
            )}
          </View>
        </View>
      </GlassCard>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: theme.spacing.md,
    marginVertical: 4,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  soldCard: { opacity: 0.5 },
  brandBar: { width: 4 },
  content: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: theme.spacing.sm,
    paddingLeft: theme.spacing.md,
  },
  left: { flex: 1, marginRight: theme.spacing.sm },
  right: { alignItems: 'flex-end', gap: 6 },
  name: { color: theme.colors.textPrimary, fontSize: theme.sizes.sm, fontWeight: '700', marginBottom: 2, fontFamily: 'Oswald_700Bold' },
  members: { color: theme.colors.textDimmed, fontSize: theme.sizes.xs, marginBottom: 4 },
  dimmedText: { color: theme.colors.textDimmed },
  badges: { flexDirection: 'row', gap: 4, flexWrap: 'wrap', marginTop: 4 },
  price: { color: theme.colors.gold, fontSize: theme.sizes.md, fontWeight: '900', fontFamily: 'Oswald_700Bold' },
  buyButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    minHeight: 36,
  },
  checkoutButton: { backgroundColor: theme.colors.gold },
  buyButtonText: { fontSize: theme.sizes.xs, letterSpacing: 0.5 },
});
