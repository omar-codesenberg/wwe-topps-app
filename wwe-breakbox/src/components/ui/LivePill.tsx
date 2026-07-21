import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, ViewStyle } from 'react-native';
import { theme } from '../../constants/theme';

interface LivePillProps {
  label?: string;
  style?: ViewStyle;
}

/** Pulsing red dot + LIVE label, framed as a subtle pill. */
export function LivePill({ label = 'LIVE', style }: LivePillProps) {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.3, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <View style={[styles.pill, style]}>
      <Animated.View style={[styles.dot, { opacity: pulse }]} />
      <Text style={styles.text}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: theme.radius.full,
    borderWidth: 1,
    borderColor: 'rgba(255,26,26,0.45)',
    backgroundColor: 'rgba(255,26,26,0.12)',
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.redBright },
  text: {
    color: theme.colors.redBright,
    fontSize: theme.sizes.xs,
    fontFamily: theme.fonts.heading,
    letterSpacing: 1.5,
  },
});
