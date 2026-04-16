import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import * as ExpoSplashScreen from 'expo-splash-screen';
import { theme } from '../../constants/theme';

ExpoSplashScreen.preventAutoHideAsync();

export function SplashScreen() {
  useEffect(() => {
    ExpoSplashScreen.hideAsync();
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.brand}>BREAKBOX</Text>
      <Text style={styles.brandWwe}>WWE</Text>
      <Text style={styles.tagline}>CLAIM YOUR SPOT</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brand: {
    color: theme.colors.textPrimary,
    fontSize: 48,
    fontWeight: '900',
    letterSpacing: 4,
    fontFamily: 'Oswald_700Bold',
  },
  brandWwe: {
    color: theme.colors.red,
    fontSize: 64,
    fontWeight: '900',
    letterSpacing: 8,
    marginTop: -10,
    fontFamily: 'Oswald_700Bold',
  },
  tagline: {
    color: theme.colors.gold,
    fontSize: theme.sizes.sm,
    letterSpacing: 6,
    marginTop: 16,
    fontFamily: 'Oswald_400Regular',
  },
});
