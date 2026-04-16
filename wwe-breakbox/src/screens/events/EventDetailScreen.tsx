import React from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { EventsStackParamList } from '../../navigation/EventsStack';
import { EventCountdown } from '../../components/events/EventCountdown';
import { WWEButton } from '../../components/ui/WWEButton';
import { useEvent } from '../../hooks/useEvent';
import { theme } from '../../constants/theme';

type Props = NativeStackScreenProps<EventsStackParamList, 'EventDetail'>;

export function EventDetailScreen({ route, navigation }: Props) {
  const { eventId } = route.params;
  const { event, loading } = useEvent(eventId);

  if (loading) {
    return <View style={styles.centered}><ActivityIndicator color={theme.colors.red} size="large" /></View>;
  }
  if (!event) {
    return <View style={styles.centered}><Text style={styles.errorText}>Event not found.</Text></View>;
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{event.title}</Text>
      <Text style={styles.description}>{event.description}</Text>
      <EventCountdown event={event} />
      <View style={styles.stats}>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{event.totalSlots}</Text>
          <Text style={styles.statLabel}>TOTAL SLOTS</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.stat}>
          <Text style={styles.statValue}>{event.soldSlots}</Text>
          <Text style={styles.statLabel}>CLAIMED</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.stat}>
          <Text style={styles.statValue}>{event.totalSlots - event.soldSlots}</Text>
          <Text style={styles.statLabel}>AVAILABLE</Text>
        </View>
      </View>
      <WWEButton
        label="View All Slots"
        onPress={() => navigation.navigate('SlotsRoster', { eventId })}
        disabled={event.status === 'upcoming'}
        style={styles.button}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.spacing.lg },
  centered: { flex: 1, backgroundColor: theme.colors.background, alignItems: 'center', justifyContent: 'center' },
  title: { color: theme.colors.textPrimary, fontSize: theme.sizes.lg, fontWeight: '900', marginBottom: theme.spacing.sm },
  description: { color: theme.colors.textSecondary, fontSize: theme.sizes.sm, lineHeight: 22, marginBottom: theme.spacing.lg },
  errorText: { color: theme.colors.textSecondary },
  stats: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: theme.spacing.lg, borderTopWidth: 1, borderBottomWidth: 1, borderColor: theme.colors.glassBorder, marginVertical: theme.spacing.lg },
  stat: { alignItems: 'center' },
  statValue: { color: theme.colors.textPrimary, fontSize: theme.sizes.xl, fontWeight: '900' },
  statLabel: { color: theme.colors.textSecondary, fontSize: theme.sizes.xs, letterSpacing: 2, marginTop: 4 },
  divider: { width: 1, backgroundColor: theme.colors.glassBorder },
  button: { marginTop: theme.spacing.lg },
});
