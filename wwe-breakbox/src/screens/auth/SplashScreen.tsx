import React, { useEffect, useRef } from 'react';
import { Text, StyleSheet, Animated, Easing, Platform, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as ExpoSplashScreen from 'expo-splash-screen';
import { WCCLogo } from '../../components/ui/WCCLogo';
import { theme } from '../../constants/theme';

ExpoSplashScreen.preventAutoHideAsync();

const ARENA = require('../../../assets/images/arena-stage-tall.jpg');

export function SplashScreen() {
  // background starts scaled up (larger) and settles to its normal size
  const scale = useRef(new Animated.Value(1.18)).current;

  useEffect(() => {
    ExpoSplashScreen.hideAsync();
    Animated.timing(scale, {
      toValue: 1,
      duration: 1600,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [scale]);

  return (
    <View style={styles.outer}>
      <View style={styles.container}>
        <Animated.Image
          source={ARENA}
          resizeMode="cover"
          style={[styles.bg, { transform: [{ scale }] }]}
        />
        <LinearGradient
          colors={['rgba(4,4,6,0.2)', 'rgba(4,4,6,0.65)', 'rgba(4,4,6,0.98)']}
          locations={[0, 0.55, 1]}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.content}>
          <WCCLogo width={320} />
          <Text style={styles.tagline}>CLAIM YOUR SPOT</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // dark full-bleed backdrop; centers the phone-width column on wide (web) screens
  outer: { flex: 1, backgroundColor: theme.colors.background, alignItems: 'center' },
  // one non-repeating background image, capped to phone width and centered
  container: { flex: 1, width: '100%', maxWidth: 480, alignSelf: 'center', overflow: 'hidden', backgroundColor: theme.colors.background },
  // fill the frame exactly so `cover` crops to centre (RNW would otherwise use the source's intrinsic size)
  bg: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tagline: {
    color: theme.colors.gold,
    fontSize: theme.sizes.sm,
    letterSpacing: 6,
    marginTop: theme.spacing.md,
    fontFamily: theme.fonts.heading,
  },
});
