import React from 'react';
import {StyleSheet, View} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import {ProColors} from '../theme/professionalTheme';

export type IconChipTone = 'navy' | 'amber' | 'green' | 'red' | 'blue' | 'slate';

// One natural icon color across the Pro app: navy. Red and green survive only
// for semantic states (blocked/error, success/active). The retired decorative
// tones stay accepted for API compatibility but render as navy.
const TONES: Record<IconChipTone, {background: string; foreground: string}> = {
  navy: {background: ProColors.primary, foreground: '#FFFFFF'},
  amber: {background: ProColors.primary, foreground: '#FFFFFF'},
  green: {background: ProColors.success, foreground: '#FFFFFF'},
  red: {background: ProColors.error, foreground: '#FFFFFF'},
  blue: {background: ProColors.primary, foreground: '#FFFFFF'},
  slate: {background: ProColors.primary, foreground: '#FFFFFF'},
};

// Filled icon chip: the visual-first language of the Pro app. Big recognizable
// glyphs on solid navy blocks, so each row reads by picture first and words
// second. All tone pairs are solid-on-solid for contrast.
export function ProIconChip({name, tone = 'navy', size = 46, iconSize = 24}: {
  name: string;
  tone?: IconChipTone;
  size?: number;
  iconSize?: number;
}) {
  const colors = TONES[tone];
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.chip, {width: size, height: size, borderRadius: Math.round(size / 3.2), backgroundColor: colors.background}]}>
      <MaterialCommunityIcons name={name} size={iconSize} color={colors.foreground} />
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {alignItems: 'center', justifyContent: 'center'},
});
