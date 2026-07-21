export const theme = {
  colors: {
    // Base surfaces
    background: '#070708',
    backgroundSecondary: '#141414',
    // Navy -> black screen gradient (top to bottom)
    bgGradientTop: '#0E1430',
    bgGradientMid: '#0A0C1A',
    bgGradientBottom: '#040406',
    // Card / panel surfaces
    card: '#0C0C0F',
    cardElevated: '#15151A',
    cardGradientTop: '#181820',
    cardGradientBottom: '#0A0A0D',
    hairline: 'rgba(255,255,255,0.08)',
    hairlineStrong: 'rgba(255,255,255,0.16)',

    // Reds (primary action)
    red: '#CC0000',
    redBright: '#FF1A1A',
    redDark: '#8E0000',
    redGlow: 'rgba(255,26,26,0.55)',

    // Cyan (reserved / checkout action)
    cyan: '#2BB8F0',
    cyanBright: '#5FD0FF',
    cyanDark: '#1683B5',
    cyanGlow: 'rgba(43,184,240,0.5)',

    // Gold (prices, timers)
    gold: '#FFC42E',
    goldBright: '#FFDA63',
    goldDark: '#B8860B',

    // Orange (progress fill, tag/faction accent)
    orange: '#FF7A1A',
    orangeDark: '#E0560A',

    // Text
    textPrimary: '#FFFFFF',
    textSecondary: '#AAAAAA',
    textDimmed: '#666666',
    textMuted: '#8A8F9C',

    // Status
    success: '#3DD06A',
    successDim: 'rgba(61,208,106,0.14)',
    warning: '#F59E0B',
    error: '#CC0000',
    claimedGray: '#5A5E68',
    claimedGrayDim: 'rgba(120,126,138,0.14)',

    // Chrome / metallic (slot orbs, borders)
    chrome: '#C9CDD4',
    chromeLight: '#F3F5F8',
    chromeDark: '#6A6E78',
    metalBorder: 'rgba(220,224,230,0.35)',

    // Legacy / misc
    glassBg: 'rgba(255,255,255,0.06)',
    glassBorder: 'rgba(255,255,255,0.12)',
    lockedOverlay: 'rgba(0,0,0,0.6)',
  },
  // Gradient stop arrays for expo-linear-gradient
  gradients: {
    screen: ['#0E1430', '#0A0C1A', '#040406'] as const,
    redButton: ['#FF2A2A', '#D40000', '#8E0000'] as const,
    cyanButton: ['#5FD0FF', '#2BB8F0', '#1683B5'] as const,
    progress: ['#FFB02E', '#FF6A00', '#E0360A'] as const,
    card: ['#181820', '#0A0A0D'] as const,
    goldBanner: ['rgba(255,196,46,0.16)', 'rgba(184,134,11,0.04)'] as const,
  },
  fonts: {
    display: 'BlackOpsOne_400Regular',
    heading: 'Oswald_700Bold',
    medium: 'Oswald_500Medium',
    subheading: 'Oswald_400Regular',
    body: undefined as string | undefined,
  },
  sizes: { xxl: 40, xl: 32, lg: 24, md: 18, sm: 14, xs: 12, xxs: 10 },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  radius: { sm: 6, md: 12, lg: 20, full: 9999 },
};
export type Theme = typeof theme;
