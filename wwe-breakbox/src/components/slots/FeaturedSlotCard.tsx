import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import { Slot } from '../../types/slot.types';
import { GlassCard } from '../ui/GlassCard';
import { TierBadge } from '../ui/TierBadge';
import { BRAND_CONFIG } from '../../constants/brands';
import { theme } from '../../constants/theme';

const CARD_WIDTH = Dimensions.get('window').width * 0.4;

interface FeaturedSlotCardProps {
  slot: Slot;
  onPress: () => void;
}

export function FeaturedSlotCard({ slot, onPress }: FeaturedSlotCardProps) {
  const brandConfig = BRAND_CONFIG[slot.brand];
  const isSold = slot.status === 'sold';

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8} disabled={isSold}>
      <GlassCard style={[styles.card, isSold && styles.sold]}>
        <View style={[styles.brandHeader, { backgroundColor: brandConfig.bgColor }]}>
          <Text style={[styles.brand, { color: brandConfig.color }]}>{brandConfig.label}</Text>
        </View>
        <View style={styles.body}>
          <Text style={styles.name} numberOfLines={2}>{slot.wrestlerName}</Text>
          <TierBadge tier={slot.tier} />
          <Text style={styles.price}>${slot.price.toLocaleString()}</Text>
          {isSold && <Text style={styles.claimedLabel}>CLAIMED</Text>}
        </View>
      </GlassCard>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { width: CARD_WIDTH, marginRight: theme.spacing.sm },
  sold: { opacity: 0.5 },
  brandHeader: { paddingHorizontal: 10, paddingVertical: 4 },
  brand: { fontSize: theme.sizes.xs, fontWeight: '700', letterSpacing: 2 },
  body: { padding: 10, gap: 4 },
  name: { color: theme.colors.textPrimary, fontSize: theme.sizes.xs, fontWeight: '700' },
  price: { color: theme.colors.gold, fontSize: theme.sizes.md, fontWeight: '900', marginTop: 4 },
  claimedLabel: { color: theme.colors.textDimmed, fontSize: theme.sizes.xs, fontWeight: '700', letterSpacing: 2 },
});
