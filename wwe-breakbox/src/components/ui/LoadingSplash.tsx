import React from 'react';
import { View, Text, StyleSheet, ImageBackground, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { WCCLogo } from './WCCLogo';
import { theme } from '../../constants/theme';

const ARENA = require('../../../assets/images/arena-stage-tall.jpg');

/** Branded launch splash: arena backdrop, WCC BREAK ZONE logo, spinner. */
export function LoadingSplash() {
  return (
    <ImageBackground source={ARENA} resizeMode="cover" style={styles.container}>
      <LinearGradient
        colors={['rgba(4,4,6,0.25)', 'rgba(4,4,6,0.7)', 'rgba(4,4,6,0.98)']}
        locations={[0, 0.55, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.content}>
        <WCCLogo width={300} />
        <Text style={styles.tagline}>CLAIM YOUR SPOT</Text>
        <ActivityIndicator color={theme.colors.redBright} size="large" style={styles.spinner} />
      </View>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  content: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 80 },
  tagline: {
    color: theme.colors.gold,
    fontSize: theme.sizes.sm,
    letterSpacing: 6,
    marginTop: theme.spacing.md,
    fontFamily: theme.fonts.heading,
  },
  spinner: { marginTop: theme.spacing.xl },
});
