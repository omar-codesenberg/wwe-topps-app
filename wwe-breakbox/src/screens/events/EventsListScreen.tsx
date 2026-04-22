import React, { useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EventsStackParamList } from '../../navigation/EventsStack';
import { EventCountdown } from '../../components/events/EventCountdown';
import { FeaturedSlotCard } from '../../components/slots/FeaturedSlotCard';
import { WWEButton } from '../../components/ui/WWEButton';
import { useEvents } from '../../hooks/useEvents';
import { useSlots } from '../../hooks/useSlots';
import { theme } from '../../constants/theme';

type Props = NativeStackScreenProps<EventsStackParamList, 'EventsList'>;

export function EventsListScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { events, liveEvents, upcomingEvents, loading: eventLoading } = useEvents();
  const event = liveEvents[0] ?? events[0] ?? null;
  const eventId = event?.id ?? '';
  const { slots } = useSlots(eventId);

  // Exclude the currently-featured event (if it happens to be upcoming) from the
  // separate "Upcoming" section so we don't render it twice.
  const upcomingToList = upcomingEvents.filter((e) => e.id !== event?.id);
  const otherLiveEvents = liveEvents.filter((e) => e.id !== event?.id);

  const featuredSlots = event?.featuredSlotIds
    ? slots.filter((s) => event.featuredSlotIds.includes(s.id))
    : [];

  const canEnter = event?.status === 'live';

  const glowAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (canEnter) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(glowAnim, { toValue: 1, duration: 1000, useNativeDriver: false }),
          Animated.timing(glowAnim, { toValue: 0, duration: 1000, useNativeDriver: false }),
        ])
      ).start();
    } else {
      glowAnim.stopAnimation();
      glowAnim.setValue(0);
    }
  }, [canEnter]);

  if (eventLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={theme.colors.red} size="large" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.brandTop}>BREAKBOX</Text>
        <Text style={styles.brandWwe}>WWE</Text>
      </View>

      {/* Event title */}
      {event && (
        <Text style={styles.eventTitle}>{event.title}</Text>
      )}

      {/* Countdown / Live badge */}
      {event && <EventCountdown event={event} />}

      {/* Progress */}
      {event && (
        <View style={styles.progressRow}>
          <Text style={styles.progressText}>
            {event.soldSlots}/{event.totalSlots} SLOTS CLAIMED
          </Text>
          <View style={styles.progressBar}>
            <View
              style={[
                styles.progressFill,
                { width: `${(event.soldSlots / event.totalSlots) * 100}%` },
              ]}
            />
          </View>
        </View>
      )}

      {/* CTA */}
      <Animated.View
        style={[
          styles.ctaWrapper,
          {
            shadowColor: theme.colors.red,
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: glowAnim as any,
            shadowRadius: 12,
            elevation: 6,
          },
        ]}
      >
        <WWEButton
          label={event?.status === 'closed' ? 'EVENT CLOSED' : 'ENTER THE ARENA'}
          onPress={() => navigation.navigate('SlotsRoster', { eventId: eventId })}
          disabled={!canEnter}
          style={styles.ctaButton}
        />
      </Animated.View>

      {/* Top Contenders */}
      {featuredSlots.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>TOP CONTENDERS</Text>
          <Text style={styles.sectionSubtitle}>HIGH VALUE SLOTS</Text>
          <FlatList
            data={featuredSlots}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <FeaturedSlotCard
                slot={item}
                onPress={() => navigation.navigate('SlotsRoster', { eventId: eventId })}
              />
            )}
            contentContainerStyle={styles.featuredList}
          />
        </View>
      )}

      {/* Other live events — admin may have started multiple */}
      {otherLiveEvents.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>LIVE NOW</Text>
          <Text style={styles.sectionSubtitle}>ENTER TO PICK SLOTS</Text>
          {otherLiveEvents.map((ev) => (
            <TouchableOpacity
              key={ev.id}
              style={[styles.upcomingCard, styles.liveCard]}
              onPress={() => navigation.navigate('SlotsRoster', { eventId: ev.id })}
              activeOpacity={0.8}
            >
              <View style={styles.liveBadgeRow}>
                <View style={styles.liveDot} />
                <Text style={styles.liveBadgeText}>LIVE</Text>
              </View>
              <Text style={styles.upcomingTitle}>{ev.title}</Text>
              {!!ev.description && (
                <Text style={styles.upcomingDescription} numberOfLines={2}>
                  {ev.description}
                </Text>
              )}
              <Text style={styles.upcomingMeta}>
                {ev.soldSlots}/{ev.totalSlots} CLAIMED • TAP TO ENTER
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Upcoming breaks */}
      {upcomingToList.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>UPCOMING</Text>
          <Text style={styles.sectionSubtitle}>NEXT BREAKS</Text>
          {upcomingToList.map((ev) => (
            <View key={ev.id} style={styles.upcomingCard}>
              <Text style={styles.upcomingTitle}>{ev.title}</Text>
              <Text style={styles.upcomingWhen}>{formatEventWhen(ev.opensAt)}</Text>
              {!!ev.description && (
                <Text style={styles.upcomingDescription} numberOfLines={2}>
                  {ev.description}
                </Text>
              )}
              <Text style={styles.upcomingMeta}>
                {ev.totalSlots} SLOTS
              </Text>
            </View>
          ))}
        </View>
      )}

      {!event && !eventLoading && (
        <View style={styles.noEvent}>
          <Text style={styles.noEventText}>No upcoming events.</Text>
          <Text style={styles.noEventSub}>Check back soon!</Text>
        </View>
      )}
    </ScrollView>
  );
}

function formatEventWhen(date: Date): string {
  const dateStr = date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const timeStr = date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${dateStr} • ${timeStr}`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  content: { paddingBottom: 32 },
  centered: { flex: 1, backgroundColor: theme.colors.background, alignItems: 'center', justifyContent: 'center' },
  header: { alignItems: 'center', marginBottom: theme.spacing.sm },
  brandTop: { color: theme.colors.textPrimary, fontSize: 22, fontWeight: '900', letterSpacing: 6, fontFamily: 'Oswald_700Bold' },
  brandWwe: { color: theme.colors.red, fontSize: 38, fontWeight: '900', letterSpacing: 8, marginTop: -6, fontFamily: 'Oswald_700Bold' },
  eventTitle: {
    color: theme.colors.textSecondary,
    fontSize: theme.sizes.xs,
    textAlign: 'center',
    letterSpacing: 2,
    marginBottom: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    fontFamily: 'Oswald_400Regular',
  },
  progressRow: { paddingHorizontal: theme.spacing.lg, marginBottom: theme.spacing.md },
  progressText: { color: theme.colors.textSecondary, fontSize: theme.sizes.xs, letterSpacing: 2, marginBottom: 6, textAlign: 'center' },
  progressBar: { height: 4, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 2 },
  progressFill: { height: 4, backgroundColor: theme.colors.red, borderRadius: 2 },
  ctaWrapper: { marginHorizontal: theme.spacing.lg, marginBottom: theme.spacing.lg },
  ctaButton: {},
  section: { paddingHorizontal: theme.spacing.lg },
  sectionTitle: { color: theme.colors.textPrimary, fontSize: theme.sizes.sm, fontWeight: '900', letterSpacing: 3, fontFamily: 'Oswald_700Bold' },
  sectionSubtitle: { color: theme.colors.gold, fontSize: theme.sizes.xs, letterSpacing: 3, marginBottom: theme.spacing.sm, fontFamily: 'Oswald_700Bold' },
  featuredList: { paddingRight: theme.spacing.lg },
  noEvent: { alignItems: 'center', marginTop: 60 },
  noEventText: { color: theme.colors.textSecondary, fontSize: theme.sizes.md },
  noEventSub: { color: theme.colors.textDimmed, fontSize: theme.sizes.sm, marginTop: 4 },
  upcomingCard: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: theme.spacing.md,
    marginTop: theme.spacing.sm,
  },
  upcomingTitle: {
    color: theme.colors.textPrimary,
    fontSize: theme.sizes.md,
    fontWeight: '900',
    letterSpacing: 1,
    fontFamily: 'Oswald_700Bold',
    marginBottom: 4,
  },
  upcomingWhen: {
    color: theme.colors.gold,
    fontSize: theme.sizes.xs,
    letterSpacing: 2,
    fontFamily: 'Oswald_700Bold',
    marginBottom: 6,
  },
  upcomingDescription: {
    color: theme.colors.textSecondary,
    fontSize: theme.sizes.sm,
    marginBottom: 6,
  },
  upcomingMeta: {
    color: theme.colors.textDimmed,
    fontSize: theme.sizes.xs,
    letterSpacing: 2,
  },
  liveCard: {
    borderColor: theme.colors.red,
    backgroundColor: 'rgba(229, 9, 20, 0.08)',
  },
  liveBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.red,
    marginRight: 6,
  },
  liveBadgeText: {
    color: theme.colors.red,
    fontSize: theme.sizes.xs,
    fontWeight: '900',
    letterSpacing: 3,
    fontFamily: 'Oswald_700Bold',
  },
});
