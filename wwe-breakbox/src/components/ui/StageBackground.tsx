import React, { useEffect, useRef, useState } from 'react';
import { View, Image, Animated, Easing, Platform, StyleSheet, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../../constants/theme';

const STAGE = require('../../../assets/images/arena-stage-tall.jpg');

interface StageBackgroundProps {
  children: React.ReactNode;
  style?: ViewStyle;
  /** Play a zoom-out intro: the image starts scaled up and settles to size. */
  animateIn?: boolean;
}

/**
 * Home/arena backdrop: the WCC Nitro stage image as a full-screen background.
 * It fills a phone-width column that stays horizontally centered on wide
 * (web/desktop) screens, so the image is shown once — never tiled or
 * stretched edge-to-edge — and stays responsive down to a phone. A dark
 * gradient scrim keeps the scrolling content readable over the busy art.
 *
 * With `animateIn`, the background eases from a larger scale down to its
 * normal size when the screen appears.
 */
export function StageBackground({ children, style, animateIn = false }: StageBackgroundProps) {
  const scale = useRef(new Animated.Value(animateIn ? 1.18 : 1)).current;
  // children stay hidden while the background zooms, then fade in afterwards
  const fade = useRef(new Animated.Value(animateIn ? 0 : 1)).current;
  // once the intro finishes we drop the opacity/transform on the content wrapper
  // so the GlassCard's backdrop blur works again (backdrop-filter is disabled
  // while an ancestor has opacity < 1 or a transform).
  const [settled, setSettled] = useState(!animateIn);

  useEffect(() => {
    if (!animateIn) return;
    const useNativeDriver = Platform.OS !== 'web';
    Animated.sequence([
      // 1) background zoom-out settles to size
      Animated.timing(scale, {
        toValue: 1,
        duration: 4000,
        easing: Easing.out(Easing.cubic),
        useNativeDriver,
      }),
      // 2) once it finishes, the foreground content fades into place
      Animated.timing(fade, {
        toValue: 1,
        duration: 600,
        easing: Easing.out(Easing.quad),
        useNativeDriver,
      }),
    ]).start(({ finished }) => {
      if (finished) setSettled(true);
    });
  }, [animateIn, scale, fade]);

  return (
    <View style={styles.outer}>
      <View style={[styles.frame, style]}>
        {/* full-screen stage image (single, non-repeating, cover); the
            Animated.View wrapper is what scales for the zoom-out intro */}
        <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ scale }] }]}>
          <Image source={STAGE} resizeMode="cover" style={styles.stage} />
        </Animated.View>
        <LinearGradient
          colors={[
            'rgba(5,6,8,0.62)',
            'rgba(5,6,8,0.32)',
            'rgba(5,6,8,0.55)',
            'rgba(5,6,8,0.88)',
          ]}
          locations={[0, 0.28, 0.6, 1]}
          style={StyleSheet.absoluteFill}
        />
        <Animated.View
          style={
            // after the intro settles, use a plain style (no opacity/transform)
            // so the GlassCard backdrop blur is re-enabled
            settled
              ? styles.content
              : [
                  styles.content,
                  {
                    opacity: fade,
                    transform: [
                      { translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) },
                    ],
                  },
                ]
          }
        >
          {children}
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // full-bleed dark base; centers the phone-width column on desktop web
  outer: { flex: 1, backgroundColor: theme.colors.background, alignItems: 'center' },
  // single non-repeating background column, capped to phone width
  frame: {
    flex: 1,
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    overflow: 'hidden',
    backgroundColor: theme.colors.background,
  },
  // fill the frame exactly (RNW Image otherwise takes the source's intrinsic
  // size, which overflows and shows only a cropped corner)
  stage: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },
  content: { flex: 1 },
});
