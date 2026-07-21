import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../../constants/theme';
import { LivePill } from './LivePill';

interface AppHeaderProps {
  title?: string;
  subtitle?: string;
  eyebrow?: string;
  onBack?: () => void;
  showLive?: boolean;
  /** Right-aligned custom content (overrides the LIVE pill) */
  right?: React.ReactNode;
}

/**
 * Standard screen header: WCC eyebrow, a back chevron + stencil title row,
 * and an optional LIVE pill on the right.
 */
export function AppHeader({
  title,
  subtitle,
  eyebrow = 'WCC · WRESTLING CARDS & COLLECTIBLES',
  onBack,
  showLive,
  right,
}: AppHeaderProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingTop: insets.top + 6 }]}>
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      {(title || onBack || showLive || right) && (
        <View style={styles.row}>
          <View style={styles.left}>
            {onBack && (
              <TouchableOpacity onPress={onBack} hitSlop={12} style={styles.back}>
                <Text style={styles.chevron}>‹</Text>
              </TouchableOpacity>
            )}
            <View style={styles.titleCol}>
              {title ? <Text style={styles.title}>{title}</Text> : null}
              {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
            </View>
          </View>
          {right ?? (showLive ? <LivePill /> : null)}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.sm },
  eyebrow: {
    color: theme.colors.textMuted,
    fontSize: theme.sizes.xs,
    fontFamily: theme.fonts.heading,
    letterSpacing: 2,
    textAlign: 'center',
    marginBottom: theme.spacing.sm,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  left: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 4 },
  back: { marginRight: 4 },
  chevron: { color: theme.colors.textPrimary, fontSize: 34, fontWeight: '300', lineHeight: 34 },
  titleCol: { flex: 1 },
  title: {
    color: theme.colors.textPrimary,
    fontSize: 26,
    fontFamily: theme.fonts.display,
    letterSpacing: 1,
  },
  subtitle: {
    color: theme.colors.textMuted,
    fontSize: theme.sizes.xs,
    fontFamily: theme.fonts.medium,
    letterSpacing: 1.5,
    marginTop: 2,
  },
});
