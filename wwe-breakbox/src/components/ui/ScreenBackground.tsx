import React from 'react';
import { View, StyleSheet, ViewStyle, Dimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, Pattern, Line, Rect } from 'react-native-svg';
import { theme } from '../../constants/theme';

interface ScreenBackgroundProps {
  children: React.ReactNode;
  style?: ViewStyle;
  /** Faint diagonal pinstripe overlay (default true) */
  pinstripe?: boolean;
}

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

/**
 * Full-screen navy -> black gradient with an optional subtle diagonal
 * pinstripe texture. Wraps every screen for a consistent arena backdrop.
 */
export function ScreenBackground({ children, style, pinstripe = true }: ScreenBackgroundProps) {
  return (
    <View style={[styles.root, style]}>
      <LinearGradient
        colors={theme.gradients.screen}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFill}
      />
      {pinstripe && (
        <Svg
          style={StyleSheet.absoluteFill}
          width={SCREEN_W}
          height={SCREEN_H}
          pointerEvents="none"
        >
          <Defs>
            <Pattern id="stripe" patternUnits="userSpaceOnUse" width={10} height={10}>
              <Line x1={0} y1={10} x2={10} y2={0} stroke="#FFFFFF" strokeOpacity={0.025} strokeWidth={1} />
            </Pattern>
          </Defs>
          <Rect x={0} y={0} width={SCREEN_W} height={SCREEN_H} fill="url(#stripe)" />
        </Svg>
      )}
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  content: { flex: 1 },
});
