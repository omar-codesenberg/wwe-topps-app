import React, { useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EventsStackParamList } from '../../navigation/EventsStack';
import { StageBackground } from '../../components/ui/StageBackground';
import { WCCLogo } from '../../components/ui/WCCLogo';
import { LivePill } from '../../components/ui/LivePill';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { SlotOrbs } from '../../components/ui/SlotOrbs';
import { WWEButton } from '../../components/ui/WWEButton';
import { useEvents } from '../../hooks/useEvents';
import { useCountdown } from '../../hooks/useCountdown';
import { BreakEvent } from '../../types/event.types';
import { theme } from '../../constants/theme';

type Props = NativeStackScreenProps<EventsStackParamList, 'EventsList'>;

function fmtClock(total: number) {
  const s = Math.max(0, total);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function TimeLeftPill({ closesAt }: { closesAt: Date }) {
  const { secondsRemaining, isExpired } = useCountdown(closesAt);
  if (isExpired) return null;
  return (
    <View style={styles.timePill}>
      <Text style={styles.timePillText}>{fmtClock(secondsRemaining)} LEFT</Text>
    </View>
  );
}

export function EventsListScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { events, liveEvents, upcomingEvents, loading: eventLoading } = useEvents();
  const event = liveEvents[0] ?? events[0] ?? null;
  const eventId = event?.id ?? '';

  const upcomingToList = upcomingEvents.filter((e) => e.id !== event?.id);
  const otherLiveEvents = liveEvents.filter((e) => e.id !== event?.id);

  const canEnter = event?.status === 'live';
  const orbCount = 8;
  const claimedOrbs =
    event && event.totalSlots > 0
      ? Math.round((event.soldSlots / event.totalSlots) * orbCount)
      : 0;

  const glowAnim = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    if (canEnter) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(glowAnim, { toValue: 1, duration: 1000, useNativeDriver: false }),
          Animated.timing(glowAnim, { toValue: 0.4, duration: 1000, useNativeDriver: false }),
        ])
      );
      loop.start();
      return () => loop.stop();
    }
    glowAnim.setValue(0.4);
  }, [canEnter]);

  if (eventLoading) {
    return (
      <StageBackground>
        <View style={styles.centered}>
          <ActivityIndicator color={theme.colors.red} size="large" />
        </View>
      </StageBackground>
    );
  }

  return (
    <StageBackground>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Logo */}
        <View style={styles.logoWrap}>
          <WCCLogo width={300} />
          <Text style={styles.tagline}>WRESTLING CARDS & COLLECTIBLES</Text>
        </View>

        {event && (
          <>
            <Text style={styles.eventTitle}>{event.title.toUpperCase()}</Text>
            <Text style={styles.eventMeta}>
              {event.description ? event.description.toUpperCase() : `${event.totalSlots} SLOTS`}
            </Text>

            {/* Live + time left */}
            <View style={styles.liveRow}>
              {event.status === 'live' && <LivePill />}
              {event.status === 'live' && event.closesAt && <TimeLeftPill closesAt={event.closesAt} />}
            </View>

            {/* Progress + orbs */}
            <View style={styles.progressWrap}>
              <ProgressBar current={event.soldSlots} total={event.totalSlots} />
              <SlotOrbs count={orbCount} claimed={claimedOrbs} size={22} style={styles.orbs} />
            </View>

            {/* CTA */}
            <Animated.View
              style={[
                styles.ctaWrap,
                {
                  shadowColor: theme.colors.redBright,
                  shadowOffset: { width: 0, height: 0 },
                  shadowOpacity: glowAnim as any,
                  shadowRadius: 18,
                },
              ]}
            >
              <WWEButton
                label={event.status === 'closed' ? 'EVENT CLOSED' : 'ENTER THE ARENA'}
                onPress={() => navigation.navigate('SlotsRoster', { eventId })}
                disabled={!canEnter}
                style={styles.ctaButton}
                textStyle={styles.ctaLabel}
              />
            </Animated.View>
            <Text style={styles.ctaHint}>TAP TO HIT THE ENTRANCE RAMP</Text>
          </>
        )}

        {/* Other live events */}
        {otherLiveEvents.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>LIVE NOW</Text>
            {otherLiveEvents.map((ev) => (
              <UpNextCard key={ev.id} event={ev} live onPress={() => navigation.navigate('SlotsRoster', { eventId: ev.id })} />
            ))}
          </View>
        )}

        {/* Up next */}
        {upcomingToList.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              UP <Text style={styles.sectionTitleAccent}>NEXT</Text>
            </Text>
            {upcomingToList.map((ev) => (
              <UpNextCard key={ev.id} event={ev} />
            ))}
          </View>
        )}

        {!event && (
          <View style={styles.noEvent}>
            <Text style={styles.noEventText}>No upcoming events.</Text>
            <Text style={styles.noEventSub}>Check back soon!</Text>
          </View>
        )}
      </ScrollView>
    </StageBackground>
  );
}

function UpNextCard({
  event,
  live,
  onPress,
}: {
  event: BreakEvent;
  live?: boolean;
  onPress?: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.upNextCard, live && styles.upNextLive]}
      onPress={onPress}
      activeOpacity={onPress ? 0.8 : 1}
      disabled={!onPress}
    >
      <View style={styles.upNextBadge}>
        <Text style={styles.upNextBadgeText}>WCC</Text>
      </View>
      <View style={styles.upNextInfo}>
        <Text style={styles.upNextTitle} numberOfLines={1}>
          {event.title.toUpperCase()}
        </Text>
        <Text style={styles.upNextMeta}>{event.totalSlots} SLOTS</Text>
      </View>
      <View style={styles.upNextRight}>
        {live ? (
          <LivePill />
        ) : (
          <Text style={styles.upNextWhen}>{formatEventWhen(event.opensAt)}</Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

function formatEventWhen(date: Date): string {
  const today = new Date();
  const isSameDay = date.toDateString() === today.toDateString();
  const dateStr = isSameDay
    ? 'TONIGHT'
    : date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase();
  const timeStr = date
    .toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    .toUpperCase();
  return `${dateStr}\n${timeStr}`;
}

const styles = StyleSheet.create({
  content: { paddingBottom: 40, paddingHorizontal: theme.spacing.lg },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  logoWrap: { alignItems: 'center', marginBottom: theme.spacing.md },
  tagline: {
    color: theme.colors.textSecondary,
    fontSize: theme.sizes.xs,
    letterSpacing: 3,
    marginTop: theme.spacing.sm,
    fontFamily: theme.fonts.heading,
  },
  eventTitle: {
    color: theme.colors.textPrimary,
    fontSize: theme.sizes.lg,
    textAlign: 'center',
    letterSpacing: 1,
    fontFamily: theme.fonts.heading,
  },
  eventMeta: {
    color: theme.colors.textMuted,
    fontSize: theme.sizes.xs,
    textAlign: 'center',
    letterSpacing: 2,
    marginTop: 4,
    fontFamily: theme.fonts.medium,
  },
  liveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginVertical: theme.spacing.md,
  },
  timePill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.hairlineStrong,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  timePillText: {
    color: theme.colors.textPrimary,
    fontSize: theme.sizes.sm,
    fontFamily: theme.fonts.display,
    letterSpacing: 1,
  },
  progressWrap: { marginBottom: theme.spacing.lg },
  orbs: { marginTop: theme.spacing.md },
  ctaWrap: { borderRadius: theme.radius.sm, marginBottom: theme.spacing.sm },
  ctaButton: { paddingVertical: 20 },
  ctaLabel: { fontSize: theme.sizes.lg, letterSpacing: 2 },
  ctaHint: {
    color: theme.colors.textMuted,
    fontSize: theme.sizes.xs,
    textAlign: 'center',
    letterSpacing: 2,
    fontFamily: theme.fonts.medium,
    marginBottom: theme.spacing.xl,
  },
  section: { marginTop: theme.spacing.lg },
  sectionTitle: {
    color: theme.colors.textPrimary,
    fontSize: theme.sizes.md,
    letterSpacing: 2,
    fontFamily: theme.fonts.display,
    marginBottom: theme.spacing.sm,
  },
  sectionTitleAccent: { color: theme.colors.cyan },
  upNextCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  upNextLive: { borderColor: 'rgba(255,26,26,0.4)' },
  upNextBadge: {
    width: 44,
    height: 44,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.hairlineStrong,
    backgroundColor: theme.colors.cardElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  upNextBadgeText: {
    color: theme.colors.red,
    fontSize: theme.sizes.sm,
    fontFamily: theme.fonts.display,
  },
  upNextInfo: { flex: 1 },
  upNextTitle: {
    color: theme.colors.textPrimary,
    fontSize: theme.sizes.md,
    letterSpacing: 0.5,
    fontFamily: theme.fonts.heading,
  },
  upNextMeta: {
    color: theme.colors.textMuted,
    fontSize: theme.sizes.xs,
    letterSpacing: 1.5,
    marginTop: 2,
    fontFamily: theme.fonts.medium,
  },
  upNextRight: { alignItems: 'flex-end' },
  upNextWhen: {
    color: theme.colors.gold,
    fontSize: theme.sizes.xs,
    letterSpacing: 1.5,
    textAlign: 'right',
    fontFamily: theme.fonts.heading,
  },
  noEvent: { alignItems: 'center', marginTop: 60 },
  noEventText: { color: theme.colors.textSecondary, fontSize: theme.sizes.md, fontFamily: theme.fonts.heading },
  noEventSub: { color: theme.colors.textDimmed, fontSize: theme.sizes.sm, marginTop: 4 },
});
