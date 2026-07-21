import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import Svg, { Defs, RadialGradient, Stop, Circle, Ellipse } from 'react-native-svg';

interface SlotOrbsProps {
  /** Total orbs to render */
  count?: number;
  /** How many are claimed (rendered red), the rest are chrome */
  claimed?: number;
  size?: number;
  gap?: number;
  style?: ViewStyle;
}

/**
 * A row of glossy spheres. Claimed = red, available = chrome/silver.
 * Recurs on the home progress, list headers, and the checkout card.
 */
export function SlotOrbs({ count = 8, claimed = 0, size = 22, gap = 8, style }: SlotOrbsProps) {
  const orbs = Array.from({ length: count });
  return (
    <View style={[styles.row, { gap }, style]}>
      {orbs.map((_, i) => (
        <Orb key={i} size={size} variant={i < claimed ? 'red' : 'chrome'} index={i} />
      ))}
    </View>
  );
}

function Orb({ size, variant, index }: { size: number; variant: 'red' | 'chrome'; index: number }) {
  const r = size / 2;
  const gid = `orb-${variant}-${size}-${index}`;
  const hid = `hl-${variant}-${size}-${index}`;
  const colors =
    variant === 'red'
      ? { light: '#FF6B6B', mid: '#E01010', dark: '#6E0000' }
      : { light: '#FFFFFF', mid: '#C9CDD4', dark: '#4A4E58' };
  return (
    <Svg width={size} height={size}>
      <Defs>
        <RadialGradient id={gid} cx="38%" cy="32%" r="75%">
          <Stop offset="0%" stopColor={colors.light} />
          <Stop offset="45%" stopColor={colors.mid} />
          <Stop offset="100%" stopColor={colors.dark} />
        </RadialGradient>
        <RadialGradient id={hid} cx="50%" cy="50%" r="50%">
          <Stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.85} />
          <Stop offset="100%" stopColor="#FFFFFF" stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx={r} cy={r} r={r - 0.5} fill={`url(#${gid})`} stroke="rgba(0,0,0,0.5)" strokeWidth={0.5} />
      <Ellipse cx={r * 0.72} cy={r * 0.6} rx={r * 0.34} ry={r * 0.22} fill={`url(#${hid})`} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
});
