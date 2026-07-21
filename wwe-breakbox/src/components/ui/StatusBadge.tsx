import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SlotStatus } from '../../types/slot.types';
import { theme } from '../../constants/theme';
import { useCountdown } from '../../hooks/useCountdown';

interface StatusBadgeProps {
  status: SlotStatus;
  isMyLock?: boolean;
  /** When this is the current user's lock, show a live "RESERVED · m:ss" countdown */
  lockedUntil?: Date | null;
}

function fmt(total: number) {
  const s = Math.max(0, total);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export function StatusBadge({ status, isMyLock, lockedUntil }: StatusBadgeProps) {
  const { secondsRemaining } = useCountdown(isMyLock && lockedUntil ? lockedUntil : null);

  if (status === 'available') {
    return (
      <View style={[styles.badge, styles.greenBorder]}>
        <View style={styles.dot} />
        <Text style={[styles.text, { color: theme.colors.success }]}>AVAILABLE</Text>
      </View>
    );
  }
  if (status === 'locked') {
    if (isMyLock) {
      return (
        <View style={[styles.badge, styles.cyanBorder]}>
          <Text style={[styles.text, { color: theme.colors.cyanBright }]}>
            RESERVED{lockedUntil ? ` · ${fmt(secondsRemaining)}` : ''}
          </Text>
        </View>
      );
    }
    return (
      <View style={[styles.badge, styles.goldBorder]}>
        <Text style={[styles.text, { color: theme.colors.gold }]}>RESERVING…</Text>
      </View>
    );
  }
  if (status === 'closed') {
    return (
      <View style={[styles.badge, styles.grayBorder]}>
        <Text style={[styles.text, { color: theme.colors.claimedGray }]}>CLOSED</Text>
      </View>
    );
  }
  return (
    <View style={[styles.badge, styles.grayBorder]}>
      <Text style={[styles.text, { color: theme.colors.claimedGray }]}>CLAIMED</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    alignSelf: 'flex-start',
    gap: 5,
  },
  greenBorder: { backgroundColor: theme.colors.successDim, borderColor: 'rgba(61,208,106,0.45)' },
  cyanBorder: { backgroundColor: 'rgba(43,184,240,0.12)', borderColor: 'rgba(43,184,240,0.5)' },
  goldBorder: { backgroundColor: 'rgba(255,196,46,0.1)', borderColor: 'rgba(255,196,46,0.45)' },
  grayBorder: { backgroundColor: theme.colors.claimedGrayDim, borderColor: 'rgba(120,126,138,0.4)' },
  dot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: theme.colors.success },
  text: { fontSize: theme.sizes.xs, fontFamily: theme.fonts.heading, letterSpacing: 1 },
});
