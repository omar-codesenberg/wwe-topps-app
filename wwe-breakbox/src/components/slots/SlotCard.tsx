import React, { useRef, useEffect } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Slot } from '../../types/slot.types';
import { StatusBadge } from '../ui/StatusBadge';
import { WWEButton } from '../ui/WWEButton';
import { BRAND_CONFIG } from '../../constants/brands';
import { theme } from '../../constants/theme';

interface SlotCardProps {
  slot: Slot;
  index?: number;
  currentUserId?: string;
  onBuySpot: (slot: Slot) => void;
  isLocking?: boolean;
}

export function SlotCard({ slot, index, currentUserId, onBuySpot, isLocking }: SlotCardProps) {
  const isAvailable = slot.status === 'available';
  const isSold = slot.status === 'sold';
  const isLocked = slot.status === 'locked';
  const isClosed = slot.status === 'closed';
  const isMyLock = slot.status === 'locked' && slot.lockedBy === currentUserId;
  const isDimmed = isSold || isClosed;
  const brand = BRAND_CONFIG[slot.brand];

  const subtitle =
    slot.members.length > 0 ? slot.members.join(' · ') : `${brand.label} · SINGLES`;

  // Pulse for locked-by-others
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(isDimmed ? 0.5 : 1)).current;

  useEffect(() => {
    if (isLocked && !isMyLock) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.55, duration: 700, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    }
    pulseAnim.setValue(1);
  }, [isLocked, isMyLock]);

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: isDimmed ? 0.5 : 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [isDimmed]);

  return (
    <Animated.View style={[styles.wrapper, { opacity: fadeAnim }]}>
      {/* Glowing left accent bar */}
      <Animated.View
        style={[
          styles.accent,
          { backgroundColor: brand.color, shadowColor: brand.glow, opacity: isLocked && !isMyLock ? pulseAnim : 1 },
        ]}
      />
      <LinearGradient colors={theme.gradients.card} style={styles.card}>
        <Text style={styles.index}>{(index != null ? index + 1 : 0).toString().padStart(2, '0')}</Text>

        <View style={styles.info}>
          <Text style={styles.name} numberOfLines={2}>
            {slot.wrestlerName}
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
          <View style={styles.badgeRow}>
            <StatusBadge status={slot.status} isMyLock={isMyLock} lockedUntil={slot.lockedUntil} />
          </View>
        </View>

        <View style={styles.right}>
          <Text style={[styles.price, isDimmed && styles.priceDim]}>
            ${(slot.priceCents / 100).toFixed(0)}
          </Text>
          {isAvailable && (
            <WWEButton
              label="BUY SPOT"
              onPress={() => onBuySpot(slot)}
              loading={isLocking}
              style={styles.actionBtn}
              textStyle={styles.actionLabel}
            />
          )}
          {isMyLock && (
            <WWEButton
              label="CHECKOUT"
              variant="cyan"
              onPress={() => onBuySpot(slot)}
              style={styles.actionBtn}
              textStyle={styles.actionLabel}
            />
          )}
        </View>
      </LinearGradient>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flexDirection: 'row',
    marginHorizontal: theme.spacing.md,
    marginVertical: 6,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    overflow: 'hidden',
  },
  accent: {
    width: 5,
    shadowOffset: { width: 2, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 6,
    elevation: 4,
  },
  card: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  index: {
    color: theme.colors.textDimmed,
    fontSize: 24,
    fontFamily: theme.fonts.display,
    width: 34,
  },
  info: { flex: 1 },
  name: {
    color: theme.colors.textPrimary,
    fontSize: theme.sizes.md,
    fontFamily: theme.fonts.heading,
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  subtitle: {
    color: theme.colors.textMuted,
    fontSize: theme.sizes.xs,
    fontFamily: theme.fonts.medium,
    letterSpacing: 1,
    marginBottom: 8,
  },
  badgeRow: { flexDirection: 'row' },
  right: { alignItems: 'flex-end', gap: 8, minWidth: 96 },
  price: {
    color: theme.colors.gold,
    fontSize: 22,
    fontFamily: theme.fonts.heading,
  },
  priceDim: { color: theme.colors.textDimmed },
  actionBtn: { minHeight: 38, paddingVertical: 8, paddingHorizontal: 18 },
  actionLabel: { fontSize: theme.sizes.sm, letterSpacing: 0.5 },
});
