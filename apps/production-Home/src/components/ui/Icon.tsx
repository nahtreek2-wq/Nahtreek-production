import React from 'react';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import {Colors} from '@nahtreek/design-system';
import {serviceIconography} from '../../../../../packages/mobile-ui/serviceIconography';

export const ICONS = {
  home: 'home',
  engineers: serviceIconography.engineering.icon,
  requests: 'clipboard-text',
  messages: 'message-text',
  profile: 'account-circle-outline',
  search: 'magnify',
  location: 'map-marker-outline',
  star: 'star',
  verified: 'shield-check',
  bell: 'bell-outline',
  chevronRight: 'chevron-right',
  chevronDown: 'chevron-down',
  send: 'send',
  attach: 'paperclip',
  offline: 'wifi-off',
  alert: 'alert-circle-outline',
  logout: 'logout',
  card: 'credit-card-outline',
  support: 'headset',
  shield: 'shield-outline',
  lock: 'lock-outline',
  plumbing: serviceIconography.plumbing.icon,
  electrical: serviceIconography.electrical.icon,
  painting: serviceIconography.painting.icon,
  carpentry: serviceIconography.carpentry.icon,
  masonry: 'wall',
  waterproofing: 'water-outline',
  ac: 'air-conditioner',
  cleaning: serviceIconography.cleaning.icon,
  engineerHero: serviceIconography.engineering.icon,
  serviceHero: serviceIconography.service.icon,
  calendar: 'calendar-outline',
  sort: 'sort-variant',
  clock: 'clock-outline',
  ruler: 'ruler',
  empty: 'clipboard-search-outline',
  refresh: 'refresh',
  close: 'close',
  check: 'check',
  checkCircle: 'check-circle',
  circle: 'circle-outline',
  checkboxBlank: 'checkbox-blank-outline',
  phone: 'phone-outline',
  mail: 'email-outline',
  eye: 'eye-outline',
  eyeOff: 'eye-off-outline',
  back: 'arrow-left',
  building: 'office-building-outline',
  plot: 'map-outline',
  notification: 'bell-badge-outline',
  heart: 'heart',
  heartOutline: 'heart-outline',
  quote: 'format-quote-open',
  briefcase: 'briefcase-outline',
  edit: 'pencil-outline',
  camera: 'camera-outline',
  ai: 'robot-outline',
  sparkles: 'creation',
  upload: 'file-upload-outline',
  image: 'image-outline',
  checklist: 'format-list-checks',
  mic: 'microphone-outline',
  currency: 'currency-inr',
  loans: 'bank-outline',
} as const;

export type IconName = (typeof ICONS)[keyof typeof ICONS];

interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  style?: object;
}

export function Icon({name, size = 20, color = Colors.slate600, style}: IconProps) {
  return (
    <MaterialCommunityIcons
      name={name}
      size={size}
      color={color}
      style={style as never}
    />
  );
}
