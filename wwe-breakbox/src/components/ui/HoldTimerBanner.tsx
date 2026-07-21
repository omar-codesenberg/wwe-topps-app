import React from 'react';
import { Text, StyleSheet, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../../constants/theme';

interface HoldTimerBannerProps {
  secondsRemaining: number;
  label?: string;
  style?: ViewStyle;
}

function fmt(total: number) {
  const s = Math.max(0, total);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

/** Gold-bordered horizontal banner: "HOLD EXPIRES IN m:ss". */
export function HoldTimerBanner({ secondsRemaining, label = 'HOLD EXPIRES IN', style }: HoldTimerBannerProps) {
  return (
    <LinearGradient colors={theme.gradients.goldBanner} style={[styles.banner, style]}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.time}>{fmt(secondsRemaining)}</Text>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 16,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: 'rgba(255,196,46,0.4)',
  },
  label: {
    color: theme.colors.gold,
    fontSize: theme.sizes.sm,
    fontFamily: theme.fonts.display,
    letterSpacing: 2,
  },
  time: {
    color: theme.colors.goldBright,
    fontSize: 26,
    fontFamily: theme.fonts.display,
    letterSpacing: 1,
  },
});
