import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { useCountdown } from '../../hooks/useCountdown';
import { theme } from '../../constants/theme';

interface CountdownTimerProps {
  targetDate: Date;
  style?: object;
  onExpire?: () => void;
}

export function CountdownTimer({ targetDate, style, onExpire }: CountdownTimerProps) {
  const { msRemaining, isExpired } = useCountdown(targetDate, onExpire);

  const totalSeconds = Math.ceil(msRemaining / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const display = [
    hours.toString().padStart(2, '0'),
    minutes.toString().padStart(2, '0'),
    seconds.toString().padStart(2, '0'),
  ].join(':');

  return (
    <Text style={[styles.timer, isExpired && styles.expired, style]}>
      {isExpired ? '00:00:00' : display}
    </Text>
  );
}

const styles = StyleSheet.create({
  timer: {
    color: theme.colors.textPrimary,
    fontSize: 36,
    fontWeight: '900',
    letterSpacing: 4,
    fontVariant: ['tabular-nums'],
  },
  expired: { color: theme.colors.textDimmed },
});
