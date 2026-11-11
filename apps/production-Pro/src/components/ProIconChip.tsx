import React from 'react';
import {StyleSheet, View} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import {ProColors} from '../theme/professionalTheme';

export type IconChipTone = 'navy' | 'amber' | 'green' | 'red' | 'blue' | 'slate';

// Soft-tint icon chips in the Home app's color language: a light tinted tile
// with a saturated glyph, instead of a solid navy block. Blue marks primary
// content, slate marks secondary/settings rows, amber marks membership and
// highlights, and green/red stay reserved for success and error states.
const TONES: Record<IconChipTone, {background: string; foreground: string}> = {
  navy: {background: ProColors.blueSoft, foreground: ProColors.primary},
  blue: {background: ProColors.blueSoft, foreground: '#2563EB'},
  amber: {background: ProColors.accentSoft, foreground: ProColors.accentText},
  green: {background: ProColors.successSoft, foreground: ProColors.success},
  red: {background: ProColors.errorSoft, foreground: ProColors.error},
  slate: {background: ProColors.slateSoft, foreground: '#52627A'},
};

// Tinted icon chip: the visual-first language of the Pro app. Big recognizable
// glyphs on soft tinted tiles, so each row reads by picture first and words
// second. All tone pairs keep dark-on-light contrast.
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
