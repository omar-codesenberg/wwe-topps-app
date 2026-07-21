import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator, SectionList } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { usePurchases } from '../../hooks/usePurchases';
import { PurchaseHistoryCard } from '../../components/slots/PurchaseHistoryCard';
import { WWEButton } from '../../components/ui/WWEButton';
import { ScreenBackground } from '../../components/ui/ScreenBackground';
import { AppHeader } from '../../components/ui/AppHeader';
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
  for (const section of map.values()) {
    section.data.sort((a, b) => a.wrestlerName.localeCompare(b.wrestlerName));
  }
  return Array.from(map.values());
}

export function MyPurchasesScreen() {
  const navigation = useNavigation<any>();
  const { purchases, loading, error } = usePurchases();

  const sections = groupByEvent(purchases);
  const totalSpentCents = purchases.reduce((sum, p) => sum + p.priceCents, 0);

  return (
    <ScreenBackground>
      <AppHeader title="MY SPOTS" />
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={theme.colors.red} size="large" />
        </View>
      ) : error ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>⚠️</Text>
          <Text style={styles.emptyTitle}>COULDN'T LOAD PURCHASES</Text>
          <Text style={styles.emptySub}>{error.message}</Text>
        </View>
      ) : purchases.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>🎴</Text>
          <Text style={styles.emptyTitle}>NO PURCHASES YET</Text>
          <Text style={styles.emptySub}>Enter the arena and claim your slots!</Text>
          <WWEButton
            label="ENTER THE ARENA"
            onPress={() => navigation.navigate('Events')}
            style={styles.emptyBtn}
          />
        </View>
      ) : (
        <>
          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <Text style={styles.statValue}>{purchases.length}</Text>
              <Text style={styles.statLabel}>SLOTS</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.stat}>
              <Text style={[styles.statValue, { color: theme.colors.gold }]}>
                ${(totalSpentCents / 100).toFixed(2)}
              </Text>
              <Text style={styles.statLabel}>TOTAL SPENT</Text>
            </View>
          </View>
          <SectionList
            sections={sections}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => <PurchaseHistoryCard purchase={item} />}
            renderSectionHeader={({ section }) => (
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{section.title}</Text>
                <Text style={styles.sectionCount}>
                  {section.data.length} slot{section.data.length !== 1 ? 's' : ''}
                </Text>
              </View>
            )}
            contentContainerStyle={styles.list}
            stickySectionHeadersEnabled={false}
            showsVerticalScrollIndicator={false}
          />
        </>
      )}
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.spacing.lg },
  emptyIcon: { fontSize: 64, marginBottom: theme.spacing.lg },
  emptyTitle: { color: theme.colors.textPrimary, fontSize: theme.sizes.lg, letterSpacing: 2, marginBottom: theme.spacing.sm, fontFamily: theme.fonts.display },
  emptySub: { color: theme.colors.textSecondary, fontSize: theme.sizes.sm, textAlign: 'center', marginBottom: theme.spacing.xl },
  emptyBtn: { width: '100%' },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.lg,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.hairline,
  },
  stat: { alignItems: 'center' },
  statValue: { color: theme.colors.textPrimary, fontSize: theme.sizes.lg, fontFamily: theme.fonts.display },
  statLabel: { color: theme.colors.textMuted, fontSize: theme.sizes.xs, letterSpacing: 2, marginTop: 2, fontFamily: theme.fonts.medium },
  divider: { width: 1, height: 32, backgroundColor: theme.colors.hairline },
  list: { paddingTop: theme.spacing.sm, paddingBottom: 32 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    paddingTop: theme.spacing.md,
  },
  sectionTitle: { color: theme.colors.textSecondary, fontSize: theme.sizes.xs, letterSpacing: 2, fontFamily: theme.fonts.heading },
  sectionCount: { color: theme.colors.textDimmed, fontSize: theme.sizes.xs },
});
