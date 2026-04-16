import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Tier } from '../../types/slot.types';
import { theme } from '../../constants/theme';

interface TierBadgeProps {
  tier: Tier;
  size?: 'sm' | 'md';
}

const TIER_COLORS: Record<Tier, { bg: string; text: string; border: string }> = {
  Gold: { bg: 'rgba(255,215,0,0.15)', text: '#FFD700', border: 'rgba(255,215,0,0.4)' },
  Silver: { bg: 'rgba(192,192,192,0.15)', text: '#C0C0C0', border: 'rgba(192,192,192,0.4)' },
  Bronze: { bg: 'rgba(205,127,50,0.15)', text: '#CD7F32', border: 'rgba(205,127,50,0.4)' },
};

export function TierBadge({ tier, size = 'sm' }: TierBadgeProps) {
  const colors = TIER_COLORS[tier];
  return (
    <View style={[styles.badge, { backgroundColor: colors.bg, borderColor: colors.border }, size === 'md' && styles.md]}>
      <Text style={[styles.text, { color: colors.text }, size === 'md' && styles.mdText]}>
        {tier.toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: theme.radius.full,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  md: { paddingHorizontal: 12, paddingVertical: 4 },
  text: { fontSize: theme.sizes.xs, fontWeight: '700', letterSpacing: 1 },
  mdText: { fontSize: theme.sizes.sm },
});
