import React from 'react';
import { View, StyleSheet } from 'react-native';
import { theme } from '../../constants/theme';

export function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  divider: {
    height: 1,
    backgroundColor: theme.colors.glassBorder,
    marginVertical: theme.spacing.sm,
  },
});
