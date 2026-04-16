import React, { useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { BreakEvent } from '../../types/event.types';
import { CountdownTimer } from '../ui/CountdownTimer';
import { theme } from '../../constants/theme';

interface EventCountdownProps {
  event: BreakEvent;
}

export function EventCountdown({ event }: EventCountdownProps) {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  React.useEffect(() => {
    if (event.status === 'live') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.3, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        ])
      ).start();
    }
  }, [event.status]);

  if (event.status === 'live') {
    return (
      <View style={styles.liveContainer}>
        <Animated.View style={[styles.liveDot, { opacity: pulseAnim }]} />
        <Text style={styles.liveText}>LIVE NOW</Text>
      </View>
    );
  }

  if (event.status === 'closed') {
    return (
      <View style={styles.closedContainer}>
        <Text style={styles.closedText}>EVENT CLOSED</Text>
      </View>
    );
  }

  return (
    <View style={styles.countdownContainer}>
      <Text style={styles.label}>LIVE BREAK IN</Text>
      <CountdownTimer targetDate={event.opensAt} style={styles.timer} />
    </View>
  );
}

const styles = StyleSheet.create({
  countdownContainer: { alignItems: 'center', paddingVertical: theme.spacing.md },
  label: {
    color: theme.colors.textSecondary,
    fontSize: theme.sizes.xs,
    letterSpacing: 4,
    marginBottom: theme.spacing.xs,
    fontFamily: 'Oswald_400Regular',
  },
  timer: { fontSize: 42, letterSpacing: 6, fontFamily: 'Oswald_700Bold' },
  liveContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: theme.spacing.md,
  },
  liveDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: theme.colors.red,
  },
  liveText: {
    color: theme.colors.red,
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 6,
    fontFamily: 'Oswald_700Bold',
  },
  closedContainer: { alignItems: 'center', paddingVertical: theme.spacing.md },
  closedText: { color: theme.colors.textDimmed, fontSize: theme.sizes.md, letterSpacing: 4 },
});
