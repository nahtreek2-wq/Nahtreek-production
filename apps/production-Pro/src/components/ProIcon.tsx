import React from 'react';
import {StyleSheet, View} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import {ProColors} from '../theme/professionalTheme';

export type IconTone = 'navy' | 'green' | 'red' | 'blue' | 'slate';

// Plain tone glyph in the Pro natural palette: no tile, no background.
// Blue marks primary content, slate secondary rows, green/red success and
// error, navy everything else. Amber was retired: no yellow near icons.
const TONES: Record<IconTone, string> = {
  navy: ProColors.primary,
  blue: '#2563EB',
  green: ProColors.success,
  red: ProColors.error,
  slate: '#52627A',
};

export function ProIcon({name, tone = 'navy', size = 46, iconSize = 24}: {
  name: string;
  tone?: IconTone;
  size?: number;
  iconSize?: number;
}) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.frame, {width: size, height: size}]}>
      <MaterialCommunityIcons name={name} size={iconSize} color={TONES[tone]} />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {alignItems: 'center', justifyContent: 'center'},
});
