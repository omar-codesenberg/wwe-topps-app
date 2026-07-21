import React from 'react';
import { View, Text, StyleSheet, ImageBackground } from 'react-native';
import { Slot } from '../../types/slot.types';
import { BRAND_CONFIG } from '../../constants/brands';
import { SlotOrbs } from '../ui/SlotOrbs';
import { theme } from '../../constants/theme';

const BRICK = require('../../../assets/images/brick-texture.jpg');

interface SlotShowcaseCardProps {
  slot: Pick<Slot, 'wrestlerName' | 'members' | 'brand'>;
  edition?: string;
  slotNumber?: number;
}

/** Checkout "trading card": brick wall, orbs, and the reserved wrestler. */
export function SlotShowcaseCard({ slot, edition, slotNumber }: SlotShowcaseCardProps) {
  const brand = BRAND_CONFIG[slot.brand];
  const type = slot.members.length > 0 ? 'TAG TEAM' : 'SINGLES';
  const subtitle = [brand.label, type, edition].filter(Boolean).join(' · ');

  return (
    <View style={styles.frame}>
      <ImageBackground source={BRICK} resizeMode="repeat" style={styles.brick} imageStyle={styles.brickImg}>
        <View style={styles.overlay} />
        {slotNumber != null && (
          <Text style={styles.cornerNum}>#{slotNumber.toString().padStart(2, '0')}</Text>
        )}
        <SlotOrbs count={6} claimed={3} size={18} style={styles.orbs} />
        <Text style={styles.reserved}>★ SLOT RESERVED FOR YOU ★</Text>
        <Text style={styles.name}>{slot.wrestlerName.toUpperCase()}</Text>
        <Text style={styles.subtitle}>{subtitle.toUpperCase()}</Text>
        <SlotOrbs count={6} claimed={3} size={18} style={styles.orbs} />
      </ImageBackground>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.hairlineStrong,
    overflow: 'hidden',
  },
  brick: { paddingVertical: theme.spacing.lg, paddingHorizontal: theme.spacing.lg, alignItems: 'center' },
  brickImg: { opacity: 0.9 },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(8,8,12,0.45)' },
  cornerNum: {
    position: 'absolute',
    top: 10,
    right: 14,
    color: theme.colors.textMuted,
    fontSize: theme.sizes.sm,
    fontFamily: theme.fonts.display,
  },
  orbs: { marginVertical: theme.spacing.sm },
  reserved: {
    color: theme.colors.cyanBright,
    fontSize: theme.sizes.sm,
    letterSpacing: 2,
    fontFamily: theme.fonts.heading,
    marginBottom: theme.spacing.sm,
  },
  name: {
    color: theme.colors.textPrimary,
    fontSize: 40,
    lineHeight: 42,
    textAlign: 'center',
    fontFamily: theme.fonts.heading,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  subtitle: {
    color: theme.colors.textSecondary,
    fontSize: theme.sizes.xs,
    letterSpacing: 2,
    marginTop: 6,
    marginBottom: theme.spacing.sm,
    fontFamily: theme.fonts.medium,
  },
});
