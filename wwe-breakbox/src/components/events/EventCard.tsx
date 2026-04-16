import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { BreakEvent } from '../../types/event.types';
import { GlassCard } from '../ui/GlassCard';
import { theme } from '../../constants/theme';

interface EventCardProps {
  event: BreakEvent;
  onPress: () => void;
}

const STATUS_COLOR: Record<string, string> = {
  upcoming: theme.colors.warning,
  live: theme.colors.success,
  closed: theme.colors.textDimmed,
};

export function EventCard({ event, onPress }: EventCardProps) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8}>
      <GlassCard style={styles.card}>
        <View style={styles.row}>
          <View style={styles.statusDot(event.status)} />
          <Text style={[styles.status, { color: STATUS_COLOR[event.status] }]}>
            {event.status.toUpperCase()}
          </Text>
        </View>
        <Text style={styles.title}>{event.title}</Text>
        <Text style={styles.progress}>
          {event.soldSlots}/{event.totalSlots} slots claimed
        </Text>
      </GlassCard>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { padding: theme.spacing.md, marginBottom: theme.spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  statusDot: (status: string): any => ({
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: STATUS_COLOR[status],
  }),
  status: { fontSize: theme.sizes.xs, fontWeight: '700', letterSpacing: 2 },
  title: { color: theme.colors.textPrimary, fontSize: theme.sizes.sm, fontWeight: '700', marginBottom: 4 },
  progress: { color: theme.colors.textSecondary, fontSize: theme.sizes.xs },
});
