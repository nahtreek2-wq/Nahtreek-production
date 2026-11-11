/**
 * Presentation tokens for NAHTREEK Professionals. Same visual language as the
 * Home app: navy surfaces, white cards, construction-yellow actions with navy
 * content (white fails AA on yellow). The Pro app reads picture-first:
 * ProIconChip puts big recognizable glyphs on soft tinted tiles so each row
 * is understood before its words are read. Blue marks primary content,
 * slate marks secondary rows, amber marks membership highlights, and red
 * and green appear only for semantic blocked/error and success states.
 * Tinted soft colors remain for small status badges and info bands.
 */
export const ProColors = {
  primary: '#0B2D5B',
  deep: '#071F3D',
  rich: '#103665',
  blueSoft: '#EAF2FF',
  // Brand action language shared with the Home app (F-202 BrandYellow ramp,
  // logo-checked). Blue remains for semantic info UI only.
  accent: '#F5B82E',
  accentPressed: '#D99A12',
  accentSoft: '#FFF5D9',
  accentBorder: '#E8C66F',
  accentIcon: '#7A6100',
  accentText: '#7A6100',
  onAccent: '#111F35',
  background: '#F7F9FC',
  surface: '#FFFFFF',
  text: '#172033',
  secondary: '#667085',
  muted: '#98A2B3',
  border: '#E4E9F0',
  success: '#198754',
  successSoft: '#EAF7EF',
  warning: '#B45309',
  warningSoft: '#FFF7ED',
  error: '#B42318',
  errorSoft: '#FCEAEA',
  slateSoft: '#EDF1F6',
} as const;

export const ProSpacing = {xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, section: 32, outer: 40, huge: 48} as const;
export const ProRadius = {small: 8, input: 12, card: 16, hero: 20, pill: 9999} as const;
export const ProType = {
  display: {fontSize: 29, lineHeight: 36, fontWeight: '700' as const},
  screen: {fontSize: 24, lineHeight: 31, fontWeight: '700' as const},
  section: {fontSize: 19, lineHeight: 26, fontWeight: '700' as const},
  card: {fontSize: 17, lineHeight: 23, fontWeight: '700' as const},
  body: {fontSize: 15, lineHeight: 22, fontWeight: '400' as const},
  meta: {fontSize: 13, lineHeight: 18, fontWeight: '400' as const},
  action: {fontSize: 15, lineHeight: 21, fontWeight: '700' as const},
  eyebrow: {fontSize: 11, lineHeight: 15, fontWeight: '700' as const, letterSpacing: 0.7},
} as const;
