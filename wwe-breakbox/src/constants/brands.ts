export type Brand = 'RAW' | 'SMACKDOWN' | 'NXT' | 'LEGENDS';
export const BRANDS: Brand[] = ['RAW', 'SMACKDOWN', 'NXT', 'LEGENDS'];
export const BRAND_CONFIG: Record<
  Brand,
  { label: string; color: string; bgColor: string; glow: string }
> = {
  RAW: { label: 'RAW', color: '#FF1A1A', bgColor: 'rgba(255,26,26,0.12)', glow: 'rgba(255,26,26,0.6)' },
  SMACKDOWN: { label: 'SMACKDOWN', color: '#1E8BFF', bgColor: 'rgba(30,139,255,0.12)', glow: 'rgba(30,139,255,0.6)' },
  NXT: { label: 'NXT', color: '#FF7A1A', bgColor: 'rgba(255,122,26,0.12)', glow: 'rgba(255,122,26,0.6)' },
  LEGENDS: { label: 'LEGENDS', color: '#A855F7', bgColor: 'rgba(168,85,247,0.12)', glow: 'rgba(168,85,247,0.6)' },
};
