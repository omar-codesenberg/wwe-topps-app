import React, { useEffect } from 'react';
import { Text, StyleSheet, ImageBackground, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as ExpoSplashScreen from 'expo-splash-screen';
import { WCCLogo } from '../../components/ui/WCCLogo';
import { theme } from '../../constants/theme';

ExpoSplashScreen.preventAutoHideAsync();

const ARENA = require('../../../assets/images/arena-stage-tall.jpg');

export function SplashScreen() {
  useEffect(() => {
    ExpoSplashScreen.hideAsync();
  }, []);

  return (
    <View style={styles.outer}>
      <ImageBackground source={ARENA} resizeMode="cover" style={styles.container}>
        <LinearGradient
          colors={['rgba(4,4,6,0.2)', 'rgba(4,4,6,0.65)', 'rgba(4,4,6,0.98)']}
          locations={[0, 0.55, 1]}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.content}>
          <WCCLogo width={320} />
          <Text style={styles.tagline}>CLAIM YOUR SPOT</Text>
        </View>
      </ImageBackground>
    </View>
  );
}

const styles = StyleSheet.create({
  // dark full-bleed backdrop; centers the phone-width column on wide (web) screens
  outer: { flex: 1, backgroundColor: theme.colors.background, alignItems: 'center' },
  // one non-repeating background image, capped to phone width and centered
  container: { flex: 1, width: '100%', maxWidth: 480, alignSelf: 'center', overflow: 'hidden', backgroundColor: theme.colors.background },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tagline: {
    color: theme.colors.gold,
    fontSize: theme.sizes.sm,
    letterSpacing: 6,
    marginTop: theme.spacing.md,
    fontFamily: theme.fonts.heading,
  },
});
