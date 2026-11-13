import {BrandYellow, Colors} from '@nahtreek/design-system';

// Client (Home) accent: the shared BrandYellow ramp (F-202), logo-checked.
// Yellow is fill-only on action buttons with navy content (white fails AA on
// yellow). Icons are plain natural glyphs with no background: navy on light
// surfaces, white on navy, semantic colors only for status meanings.
export const ClientColors = {
  primaryNavy: '#111F35',
  deepNavy: '#111F35',
  richNavy: '#111F35',
  accent: BrandYellow.primary,
  accentPressed: BrandYellow.pressed,
  accentSoft: BrandYellow.soft,
  accentBorder: BrandYellow.border,
  accentIcon: '#7A6100',
  accentText: '#7A6100',
  onAccent: '#111F35',
  veryLightBlue: '#F3F7FD',
  lightBackground: '#F7F9FC',
  white: '#FFFFFF',
  primaryText: '#172033',
  secondaryText: '#667085',
  // Default glyph color for list/menu icons: darker than body copy so icons
  // read at small sizes without going full navy.
  iconSlate: '#52627A',
  border: '#E4E9F0',
  strongBorder: '#D0D7E2',
  success: Colors.success,
  warning: Colors.warning,
  information: Colors.info,
  error: Colors.error,
  mutedPlaceholder: '#667085',
} as const;

// F-201: ClientSpacing removed — it was referenced nowhere and its scale
// (sm: 12, lg: 24) conflicted with the design-system Spacing (sm: 8, lg: 24)
// already adopted across the app. Spacing is the single spacing system.
