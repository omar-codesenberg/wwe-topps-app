import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SlotStatus } from '../../types/slot.types';
import { theme } from '../../constants/theme';

interface StatusBadgeProps {
  status: SlotStatus;
  isMyLock?: boolean;
}

export function StatusBadge({ status, isMyLock }: StatusBadgeProps) {
  if (status === 'available') {
    return (
      <View style={[styles.badge, styles.available]}>
        <View style={styles.dot} />
        <Text style={[styles.text, { color: theme.colors.success }]}>LIVE</Text>
      </View>
    );
  }
  if (status === 'locked') {
    const color = isMyLock ? theme.colors.gold : theme.colors.warning;
    return (
      <View style={[styles.badge, { backgroundColor: 'rgba(245,158,11,0.15)', borderColor: 'rgba(245,158,11,0.3)' }]}>
        <Text style={[styles.text, { color }]}>{isMyLock ? 'YOUR LOCK' : 'LOCKED'}</Text>
      </View>
    );
  }
  if (status === 'closed') {
    return (
      <View style={[styles.badge, styles.closed]}>
        <Text style={[styles.text, { color: theme.colors.textDimmed }]}>CLOSED</Text>
      </View>
    );
  }
  return (
    <View style={[styles.badge, styles.sold]}>
      <Text style={[styles.text, { color: theme.colors.textDimmed }]}>CLAIMED</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: theme.radius.full,
    borderWidth: 1,
    alignSelf: 'flex-start',
    gap: 4,
  },
  available: {
    backgroundColor: 'rgba(34,197,94,0.15)',
    borderColor: 'rgba(34,197,94,0.3)',
  },
  sold: {
    backgroundColor: 'rgba(102,102,102,0.15)',
    borderColor: 'rgba(102,102,102,0.3)',
  },
  closed: {
    backgroundColor: 'rgba(102,102,102,0.15)',
    borderColor: 'rgba(102,102,102,0.3)',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#22C55E',
  },
  text: { fontSize: theme.sizes.xs, fontWeight: '700', letterSpacing: 1 },
});
