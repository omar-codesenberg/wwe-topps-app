import React from 'react';
import { Image, StyleSheet, ImageStyle } from 'react-native';

const LOGO = require('../../../assets/images/breakzone-logo.png');
const ASPECT = 474 / 264; // source crop aspect ratio

interface WCCLogoProps {
  width?: number;
  style?: ImageStyle;
}

/** The metallic "WCC BREAK ZONE" wordmark. */
export function WCCLogo({ width = 300, style }: WCCLogoProps) {
  return (
    <Image
      source={LOGO}
      resizeMode="contain"
      style={[{ width, height: width / ASPECT }, style]}
    />
  );
}

const styles = StyleSheet.create({});
