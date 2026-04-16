export type Brand = 'RAW' | 'SMACKDOWN' | 'NXT' | 'LEGENDS';
export const BRANDS: Brand[] = ['RAW', 'SMACKDOWN', 'NXT', 'LEGENDS'];
export const BRAND_CONFIG: Record<Brand, { label: string; color: string; bgColor: string }> = {
  RAW: { label: 'RAW', color: '#CC0000', bgColor: 'rgba(204,0,0,0.1)' },
  SMACKDOWN: { label: 'SMACKDOWN', color: '#0057B8', bgColor: 'rgba(0,87,184,0.1)' },
  NXT: { label: 'NXT', color: '#FFD700', bgColor: 'rgba(255,215,0,0.1)' },
  LEGENDS: { label: 'LEGENDS', color: '#6B21A8', bgColor: 'rgba(107,33,168,0.1)' },
};
