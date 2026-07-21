import React from 'react';
import { View, Image, StyleSheet, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../../constants/theme';

const STAGE = require('../../../assets/images/arena-stage-tall.jpg');

interface StageBackgroundProps {
  children: React.ReactNode;
  style?: ViewStyle;
}

/**
 * Home/arena backdrop: the WCC Nitro stage image as a full-screen background.
 * It fills a phone-width column that stays horizontally centered on wide
 * (web/desktop) screens, so the image is shown once — never tiled or
 * stretched edge-to-edge — and stays responsive down to a phone. A dark
 * gradient scrim keeps the scrolling content readable over the busy art.
 */
export function StageBackground({ children, style }: StageBackgroundProps) {
  return (
    <View style={styles.outer}>
      <View style={[styles.frame, style]}>
        {/* full-screen stage image (single, non-repeating, cover) */}
        <Image source={STAGE} resizeMode="cover" style={styles.stage} />
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
        <View style={styles.content}>{children}</View>
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
