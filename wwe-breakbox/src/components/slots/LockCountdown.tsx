import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { theme } from '../../constants/theme';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const RADIUS = 48;
const STROKE_WIDTH = 6;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const TOTAL_SECONDS = 30;

interface LockCountdownProps {
  secondsRemaining: number;
}

function getArcColor(seconds: number): string {
  if (seconds > 15) return theme.colors.success;
  if (seconds > 8) return theme.colors.warning;
  return theme.colors.red;
}

export function LockCountdown({ secondsRemaining }: LockCountdownProps) {
  const progress = useSharedValue(1);
  const color = getArcColor(secondsRemaining);

  useEffect(() => {
    const target = Math.max(0, secondsRemaining) / TOTAL_SECONDS;
    progress.value = withTiming(target, {
      duration: 150,
      easing: Easing.linear,
    });
  }, [secondsRemaining]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: CIRCUMFERENCE * (1 - progress.value),
  }));

  const size = (RADIUS + STROKE_WIDTH) * 2;

  return (
    <View style={styles.container}>
      <Svg width={size} height={size} style={styles.svg}>
        {/* Track */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={RADIUS}
          stroke="rgba(255,255,255,0.1)"
          strokeWidth={STROKE_WIDTH}
          fill="none"
        />
        {/* Progress arc */}
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={RADIUS}
          stroke={color}
          strokeWidth={STROKE_WIDTH}
          fill="none"
          strokeDasharray={CIRCUMFERENCE}
          animatedProps={animatedProps}
          strokeLinecap="round"
          rotation="-90"
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <View style={styles.center}>
        <Text style={[styles.seconds, { color }]}>
          {Math.max(0, secondsRemaining)}
        </Text>
        <Text style={styles.label}>SEC</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    width: (RADIUS + STROKE_WIDTH) * 2,
    height: (RADIUS + STROKE_WIDTH) * 2,
  },
  svg: { position: 'absolute' },
  center: { alignItems: 'center' },
  seconds: { fontSize: 36, fontWeight: '900', lineHeight: 40, fontFamily: 'Oswald_700Bold' },
  label: { color: theme.colors.textSecondary, fontSize: theme.sizes.xs, letterSpacing: 2 },
});
