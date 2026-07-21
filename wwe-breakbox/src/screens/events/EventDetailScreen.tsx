import React from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { EventsStackParamList } from '../../navigation/EventsStack';
import { EventCountdown } from '../../components/events/EventCountdown';
import { WWEButton } from '../../components/ui/WWEButton';
import { ScreenBackground } from '../../components/ui/ScreenBackground';
import { AppHeader } from '../../components/ui/AppHeader';
import { useEvent } from '../../hooks/useEvent';
import { theme } from '../../constants/theme';

type Props = NativeStackScreenProps<EventsStackParamList, 'EventDetail'>;

export function EventDetailScreen({ route, navigation }: Props) {
  const { eventId } = route.params;
  const { event, loading } = useEvent(eventId);

  return (
    <ScreenBackground>
      <AppHeader title="EVENT DETAILS" onBack={() => navigation.goBack()} />
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={theme.colors.red} size="large" />
        </View>
      ) : !event ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>Event not found.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>{event.title.toUpperCase()}</Text>
          <Text style={styles.description}>{event.description}</Text>
          <EventCountdown event={event} />
          <View style={styles.stats}>
            <Stat value={event.totalSlots} label="TOTAL SLOTS" />
            <View style={styles.divider} />
            <Stat value={event.soldSlots} label="CLAIMED" />
            <View style={styles.divider} />
            <Stat value={event.totalSlots - event.soldSlots} label="AVAILABLE" />
          </View>
          <WWEButton
            label="VIEW ALL SLOTS"
            onPress={() => navigation.navigate('SlotsRoster', { eventId })}
            disabled={event.status === 'upcoming'}
            style={styles.button}
          />
        </ScrollView>
      )}
    </ScreenBackground>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: theme.spacing.lg },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { color: theme.colors.textPrimary, fontSize: theme.sizes.lg, fontFamily: theme.fonts.heading, letterSpacing: 1, marginBottom: theme.spacing.sm },
  description: { color: theme.colors.textSecondary, fontSize: theme.sizes.sm, lineHeight: 22, marginBottom: theme.spacing.lg },
  errorText: { color: theme.colors.textSecondary },
  stats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: theme.spacing.lg,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: theme.colors.hairline,
    marginVertical: theme.spacing.lg,
  },
  stat: { alignItems: 'center' },
  statValue: { color: theme.colors.textPrimary, fontSize: theme.sizes.xl, fontFamily: theme.fonts.display },
  statLabel: { color: theme.colors.textMuted, fontSize: theme.sizes.xs, letterSpacing: 2, marginTop: 4, fontFamily: theme.fonts.medium },
  divider: { width: 1, backgroundColor: theme.colors.hairline },
  button: { marginTop: theme.spacing.lg },
});
