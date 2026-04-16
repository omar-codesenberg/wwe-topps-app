import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  SectionList,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { usePurchases } from '../../hooks/usePurchases';
import { PurchaseHistoryCard } from '../../components/slots/PurchaseHistoryCard';
import { WWEButton } from '../../components/ui/WWEButton';
import { Purchase } from '../../types/purchase.types';
import { theme } from '../../constants/theme';

function groupByEvent(purchases: Purchase[]): { title: string; data: Purchase[] }[] {
  const map = new Map<string, { title: string; data: Purchase[] }>();
  for (const p of purchases) {
    if (!map.has(p.eventId)) {
      map.set(p.eventId, { title: p.eventTitle, data: [] });
    }
    map.get(p.eventId)!.data.push(p);
  }
  return Array.from(map.values());
}

export function MyPurchasesScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const { purchases, loading } = usePurchases();

  const sections = groupByEvent(purchases);
  const totalSpent = purchases.reduce((sum, p) => sum + p.price, 0);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={theme.colors.red} size="large" />
      </View>
    );
  }

  if (purchases.length === 0) {
    return (
      <View style={[styles.empty, { paddingTop: insets.top + 32 }]}>
        <Text style={styles.emptyIcon}>🎴</Text>
        <Text style={styles.emptyTitle}>NO PURCHASES YET</Text>
        <Text style={styles.emptySub}>Enter the arena and claim your slots!</Text>
        <WWEButton
          label="Enter the Arena"
          onPress={() => navigation.navigate('Events')}
          style={styles.emptyBtn}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>MY PURCHASES</Text>
        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{purchases.length}</Text>
            <Text style={styles.statLabel}>SLOTS</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.stat}>
            <Text style={[styles.statValue, { color: theme.colors.gold }]}>
              ${totalSpent.toLocaleString()}
            </Text>
            <Text style={styles.statLabel}>TOTAL SPENT</Text>
          </View>
        </View>
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <PurchaseHistoryCard purchase={item} />}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            <Text style={styles.sectionCount}>{section.data.length} slot{section.data.length !== 1 ? 's' : ''}</Text>
          </View>
        )}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  centered: { flex: 1, backgroundColor: theme.colors.background, alignItems: 'center', justifyContent: 'center' },
  empty: { flex: 1, backgroundColor: theme.colors.background, alignItems: 'center', justifyContent: 'center', padding: theme.spacing.lg },
  emptyIcon: { fontSize: 64, marginBottom: theme.spacing.lg },
  emptyTitle: { color: theme.colors.textPrimary, fontSize: theme.sizes.lg, fontWeight: '900', letterSpacing: 3, marginBottom: theme.spacing.sm, fontFamily: 'Oswald_700Bold' },
  emptySub: { color: theme.colors.textSecondary, fontSize: theme.sizes.sm, textAlign: 'center', marginBottom: theme.spacing.xl },
  emptyBtn: { width: '100%' },
  header: {
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.glassBorder,
  },
  headerTitle: { color: theme.colors.textPrimary, fontSize: theme.sizes.lg, fontWeight: '900', letterSpacing: 3, marginBottom: theme.spacing.sm, fontFamily: 'Oswald_700Bold' },
  statsRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.lg },
  stat: { alignItems: 'center' },
  statValue: { color: theme.colors.textPrimary, fontSize: theme.sizes.lg, fontWeight: '900', fontFamily: 'Oswald_700Bold' },
  statLabel: { color: theme.colors.textSecondary, fontSize: theme.sizes.xs, letterSpacing: 2 },
  divider: { width: 1, height: 32, backgroundColor: theme.colors.glassBorder },
  list: { paddingTop: theme.spacing.sm, paddingBottom: 32 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    paddingTop: theme.spacing.md,
  },
  sectionTitle: { color: theme.colors.textSecondary, fontSize: theme.sizes.xs, fontWeight: '700', letterSpacing: 2 },
  sectionCount: { color: theme.colors.textDimmed, fontSize: theme.sizes.xs },
});
