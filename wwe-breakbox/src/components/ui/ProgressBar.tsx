import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../../constants/theme';

interface ProgressBarProps {
  current: number;
  total: number;
  /** Show the "X / Y SLOTS CLAIMED" + "N LEFT" labels above the track */
  showLabels?: boolean;
  style?: ViewStyle;
}

/** Orange -> red gradient fill on a dark track with claim labels. */
export function ProgressBar({ current, total, showLabels = true, style }: ProgressBarProps) {
  const pct = total > 0 ? Math.min(1, Math.max(0, current / total)) : 0;
  const left = Math.max(0, total - current);
  return (
    <View style={style}>
      {showLabels && (
        <View style={styles.labels}>
          <Text style={styles.claimed}>
            {current} / {total} SLOTS CLAIMED
          </Text>
          <Text style={styles.left}>{left} LEFT</Text>
        </View>
      )}
      <View style={styles.track}>
        <LinearGradient
          colors={theme.gradients.progress}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[styles.fill, { width: `${pct * 100}%` }]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  labels: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  claimed: {
    color: theme.colors.textSecondary,
    fontSize: theme.sizes.xs,
    fontFamily: theme.fonts.heading,
    letterSpacing: 1,
  },
  left: {
    color: theme.colors.textPrimary,
    fontSize: theme.sizes.xs,
    fontFamily: theme.fonts.heading,
    letterSpacing: 1,
  },
  track: {
    height: 8,
    borderRadius: theme.radius.full,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: theme.radius.full },
});
