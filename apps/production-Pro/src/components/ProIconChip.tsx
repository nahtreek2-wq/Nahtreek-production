import React from 'react';
import {StyleSheet, View} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import {ProColors} from '../theme/professionalTheme';

export type IconChipTone = 'navy' | 'amber' | 'green' | 'red' | 'blue' | 'slate';

const TONES: Record<IconChipTone, {background: string; foreground: string}> = {
  navy: {background: ProColors.primary, foreground: '#FFFFFF'},
  amber: {background: ProColors.accent, foreground: ProColors.onAccent},
  green: {background: ProColors.success, foreground: '#FFFFFF'},
  red: {background: ProColors.error, foreground: '#FFFFFF'},
  blue: {background: ProColors.rich, foreground: '#FFFFFF'},
  slate: {background: ProColors.secondary, foreground: '#FFFFFF'},
};

// Filled icon chip: the visual-first language of the Pro app. Big recognizable
// glyphs on solid color blocks, so each row reads by picture first and words
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
