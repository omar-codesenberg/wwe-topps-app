export const theme = {
  colors: {
    background: '#0A0A0A',
    backgroundSecondary: '#141414',
    red: '#CC0000',
    redDark: '#990000',
    gold: '#FFD700',
    goldDark: '#B8860B',
    textPrimary: '#FFFFFF',
    textSecondary: '#AAAAAA',
    textDimmed: '#666666',
    glassBg: 'rgba(255,255,255,0.08)',
    glassBorder: 'rgba(255,255,255,0.15)',
    lockedOverlay: 'rgba(0,0,0,0.6)',
    success: '#22C55E',
    warning: '#F59E0B',
    error: '#CC0000',
  },
  fonts: {
    heading: 'Oswald_700Bold',
    subheading: 'Oswald_400Regular',
    body: undefined as string | undefined,
  },
  sizes: { xl: 32, lg: 24, md: 18, sm: 14, xs: 12 },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  radius: { sm: 6, md: 12, lg: 20, full: 9999 },
};
export type Theme = typeof theme;
