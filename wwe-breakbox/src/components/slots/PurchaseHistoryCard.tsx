import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Purchase } from '../../types/purchase.types';
import { GlassCard } from '../ui/GlassCard';
import { TierBadge } from '../ui/TierBadge';
import { BRAND_CONFIG } from '../../constants/brands';
import { formatPurchaseDate } from '../../utils/time.utils';
import { theme } from '../../constants/theme';

interface PurchaseHistoryCardProps {
  purchase: Purchase;
}

export function PurchaseHistoryCard({ purchase }: PurchaseHistoryCardProps) {
  const brandConfig = BRAND_CONFIG[purchase.brand];

  return (
    <GlassCard style={styles.card}>
      <View style={[styles.brandBar, { backgroundColor: brandConfig.color }]} />
      <View style={styles.content}>
        <View style={styles.topRow}>
          <View style={styles.left}>
            <Text style={styles.wrestlerName} numberOfLines={1}>
              {purchase.wrestlerName}
            </Text>
            <Text style={styles.eventTitle} numberOfLines={1}>
              {purchase.eventTitle}
            </Text>
          </View>
          <Text style={styles.price}>${purchase.price.toLocaleString()}</Text>
        </View>
        <View style={styles.bottomRow}>
          <View style={styles.badges}>
            <View style={[styles.brandBadge, { backgroundColor: brandConfig.bgColor }]}>
              <Text style={[styles.brandLabel, { color: brandConfig.color }]}>
                {brandConfig.label}
              </Text>
            </View>
            <TierBadge tier={purchase.tier} />
          </View>
          <Text style={styles.date}>{formatPurchaseDate(purchase.purchasedAt)}</Text>
        </View>
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    marginHorizontal: theme.spacing.md,
    marginVertical: 4,
    overflow: 'hidden',
  },
  brandBar: { width: 4 },
  content: { flex: 1, padding: theme.spacing.sm, paddingLeft: theme.spacing.md, gap: 6 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  left: { flex: 1, marginRight: theme.spacing.sm },
  wrestlerName: { color: theme.colors.textPrimary, fontSize: theme.sizes.sm, fontWeight: '700' },
  eventTitle: { color: theme.colors.textSecondary, fontSize: theme.sizes.xs, marginTop: 2 },
  price: { color: theme.colors.gold, fontSize: theme.sizes.md, fontWeight: '900' },
  bottomRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  badges: { flexDirection: 'row', gap: 4 },
  brandBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: theme.radius.full,
    alignSelf: 'flex-start',
  },
  brandLabel: { fontSize: theme.sizes.xs, fontWeight: '700', letterSpacing: 1 },
  date: { color: theme.colors.textDimmed, fontSize: theme.sizes.xs },
});
