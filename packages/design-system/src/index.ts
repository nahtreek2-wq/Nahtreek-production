// NAHTREEK Brand Design System - Production Grade
// Shared NAHTREEK palette. Both mobile apps use navy, white and construction
// yellow for brand actions; blue remains available only for semantic info UI.

export const Colors = {
  // Primary brand
  navyDeep: '#111F35',
  navyMid: '#102E52',
  navyLight: '#214A7C',
  interactiveBlue: '#2563EB',
  interactiveBluePressed: '#1D4ED8',
  softBlue: '#EAF2FF',

  // Brand action colors shared by the Client and Engineer applications.
  amber: '#E8AD43',
  amberBright: '#E8AD43',
  amberPale: '#FFF4D8',
  amberMuted: '#DCA329',
  amberDark: '#DCA329',

  gold: '#E8AD43',
  goldBright: '#E8AD43',
  goldPale: '#FFF4D8',
  goldMuted: '#DCA329',

  // Neutral surfaces
  white: '#FFFFFF',
  offWhite: '#F7F9FC',
  surface: '#FFFFFF',
  surfaceElevated: '#F7F9FC',

  slate50: '#F7F9FC',
  slate100: '#E6EAF0',
  slate200: '#E6EAF0',
  slate300: '#C9D2DE',
  slate400: '#9AA4B2',
  slate500: '#667085',
  slate600: '#667085',
  slate700: '#344054',
  slate800: '#172033',
  slate900: '#172033',

  success: '#166534',
  successBg: '#EAF7EF',
  warning: '#92400E',
  warningBg: '#FFF7ED',
  error: '#B42318',
  errorBg: '#FCEAEA',
  info: '#1D4ED8',
  infoBg: '#EAF2FF',

  verifiedBlue: '#0B2D5B',
  verifiedBg: '#EEF3FA',

  skyBlue: '#0B2D5B',
  skyBg: '#EEF3FA',
  teal: '#14756C',
  tealBg: '#EAF6F3',

  overlayDark: 'rgba(7, 31, 61, 0.86)',
  overlayLight: 'rgba(255, 255, 255, 0.08)',
  glassBorder: 'rgba(230, 234, 240, 0.28)',
  overlayWhite35: 'rgba(255, 255, 255, 0.35)',
};

// F-202: the single documented NAHTREEK yellow ramp (checked against the logo
// gold). Primary actions, selected states, and key highlights use `primary`;
// pressed feedback uses `pressed`; soft fills and borders use `soft`/`border`.
// Content on yellow is always dark navy (white fails AA). Rating stars keep
// the separate `gold` semantics above — never swap the two.
export const BrandYellow = {
  primary: '#F5B82E',
  pressed: '#D99A12',
  soft: '#FFF5D9',
  border: '#E8C66F',
  onYellow: '#111F35',
} as const;

export const Gradients = {
  navyHero: ['#111F35', '#102E52'],
  amberShimmer: ['#E8AD43', '#FFF4D8', '#E8AD43'],
  goldShimmer: ['#E8AD43', '#FFF4D8', '#E8AD43'],
  cardOverlay: ['transparent', 'rgba(7, 31, 61, 0.9)'],
};

export const Spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  xxxl: 64,
};

export const BorderRadius = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  full: 9999,
};

export const Shadows = {
  // Subtle lift for cards
  sm: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  // Standard card elevation
  md: {
    shadowColor: '#071F3D',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  // Hero / featured content
  lg: {
    shadowColor: '#071F3D',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 24,
    elevation: 8,
  },
  amber: {
    shadowColor: '#E8AD43',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  gold: {
    shadowColor: '#E8AD43',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
};

export const Typography = {
  // Display — App name, hero titles
  display: { fontSize: 30, fontWeight: '700' as const, letterSpacing: -0.6, lineHeight: 38 },
  // H1 — Screen titles
  h1: { fontSize: 24, fontWeight: '700' as const, letterSpacing: -0.4, lineHeight: 32 },
  // H2 — Section headers
  h2: { fontSize: 20, fontWeight: '700' as const, letterSpacing: -0.2, lineHeight: 28 },
  // H3 — Card titles
  h3: { fontSize: 17, fontWeight: '600' as const, lineHeight: 24 },
  // Subtitle
  subtitle: { fontSize: 15, fontWeight: '500' as const, lineHeight: 21 },
  // Body standard
  body: { fontSize: 16, fontWeight: '400' as const, lineHeight: 24 },
  // Small / Meta
  caption: { fontSize: 14, fontWeight: '400' as const, lineHeight: 20 },
  // Tags / Badges
  badge: { fontSize: 11, fontWeight: '600' as const, letterSpacing: 0.3 },
  // CTA Button text
  button: { fontSize: 16, fontWeight: '600' as const, letterSpacing: 0.1, lineHeight: 24 },
};

// Indian locale constants
export const IndiaLocale = {
  currencySymbol: '₹',
  countryCode: '+91',
  cities: [
    'Krishnagiri',
    'Coimbatore',
    'Chennai',
    'Bengaluru',
    'Hyderabad',
    'Mumbai',
    'Pune',
    'Delhi',
    'Kolkata',
    'Ahmedabad',
    'Kochi',
  ],
  dateFormat: 'DD/MM/YYYY',
  timezone: 'Asia/Kolkata',
  formatCurrency: (amount: number) => `₹${(amount ?? 0).toLocaleString('en-IN')}`,
  formatRate: (rate: number, unit = 'hr') => `₹${rate.toLocaleString('en-IN')}/${unit}`,
};
