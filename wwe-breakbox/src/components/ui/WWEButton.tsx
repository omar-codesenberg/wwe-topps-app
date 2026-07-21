import React from 'react';
import {
  TouchableOpacity,
  Text,
  ActivityIndicator,
  StyleSheet,
  ViewStyle,
  TextStyle,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../../constants/theme';

type Variant = 'primary' | 'cyan' | 'secondary' | 'outline';

interface WWEButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: Variant;
  style?: ViewStyle;
  textStyle?: TextStyle;
}

const GRADIENTS = {
  primary: theme.gradients.redButton,
  cyan: theme.gradients.cyanButton,
  secondary: theme.gradients.card,
};

const GLOW: Record<Variant, string> = {
  primary: theme.colors.redGlow,
  cyan: theme.colors.cyanGlow,
  secondary: 'transparent',
  outline: 'transparent',
};

export function WWEButton({
  label,
  onPress,
  disabled = false,
  loading = false,
  variant = 'primary',
  style,
  textStyle,
}: WWEButtonProps) {
  const isDisabled = disabled || loading;
  const isGradient = variant !== 'outline';
  const glowColor = GLOW[variant];

  const content = loading ? (
    <ActivityIndicator color={variant === 'outline' ? theme.colors.red : '#fff'} size="small" />
  ) : (
    <Text
      style={[styles.label, variant === 'outline' && styles.outlineLabel, textStyle]}
      numberOfLines={1}
    >
      {label}
    </Text>
  );

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.85}
      style={[
        styles.shadow,
        glowColor !== 'transparent' && { shadowColor: glowColor },
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {isGradient ? (
        <LinearGradient
          colors={GRADIENTS[variant as 'primary' | 'cyan' | 'secondary']}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={[styles.base, styles.metalBorder]}
        >
          {/* glossy top highlight */}
          <View style={styles.gloss} pointerEvents="none" />
          {content}
        </LinearGradient>
      ) : (
        <View style={[styles.base, styles.outline]}>{content}</View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  shadow: {
    borderRadius: theme.radius.sm,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 14,
    elevation: 6,
  },
  base: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: theme.radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    overflow: 'hidden',
  },
  metalBorder: {
    borderWidth: 1,
    borderColor: theme.colors.metalBorder,
  },
  gloss: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '45%',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  outline: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: theme.colors.red,
  },
  disabled: { opacity: 0.5 },
  label: {
    color: theme.colors.textPrimary,
    fontSize: theme.sizes.md,
    fontFamily: theme.fonts.display,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  outlineLabel: { color: theme.colors.red },
});
