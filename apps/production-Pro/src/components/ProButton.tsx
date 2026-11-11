import React from 'react';
import {Animated, StyleProp, StyleSheet, Text, TouchableOpacity, ViewStyle} from 'react-native';
import {ProLoader} from './ProLoader';
import {BorderRadius, Colors, Spacing, Typography} from '@nahtreek/design-system';
import {usePressMotion} from '../../../../packages/mobile-ui/usePressMotion';
import {ProColors} from '../theme/professionalTheme';

const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

export interface ProButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'accent';
  loading?: boolean;
  loadingLabel?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  icon?: React.ReactNode;
}

// Pro-app action button: same behavior and API as the Home app's ClientButton —
// primary actions use construction yellow with navy text.
export function ProButton({label, onPress, variant = 'primary', loading = false, loadingLabel, disabled = false, style, icon}: ProButtonProps) {
  const inactive = disabled || loading;
  const motion = usePressMotion(inactive);
  const textColor =
    disabled ? Colors.slate600 : variant === 'danger' ? Colors.error : variant === 'secondary' ? Colors.navyDeep : ProColors.onAccent;
  return (
    <AnimatedTouchable
      accessibilityRole="button"
      accessibilityLabel={loading ? loadingLabel || `${label}, in progress` : label}
      accessibilityState={{disabled: inactive, busy: loading}}
      disabled={inactive}
      onPress={onPress}
      onPressIn={motion.onPressIn}
      onPressOut={motion.onPressOut}
      activeOpacity={0.8}
      style={[styles.base, styles[variant], style, disabled && styles.disabled, motion.style]}>
      {loading ? <ProLoader size={22} tone={variant === 'danger' ? 'red' : 'navy'} /> : icon}
      <Text style={[styles.label, {color: textColor}]}>{loading && loadingLabel ? loadingLabel : label}</Text>
    </AnimatedTouchable>
  );
}

const styles = StyleSheet.create({
  base: {minHeight: 48, flexShrink: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: BorderRadius.md, paddingVertical: 12, paddingHorizontal: Spacing.lg, gap: 8},
  primary: {backgroundColor: ProColors.accent},
  accent: {backgroundColor: ProColors.accent},
  secondary: {backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.slate300},
  danger: {backgroundColor: Colors.errorBg},
  disabled: {backgroundColor: Colors.slate200, borderColor: Colors.slate200},
  label: {...Typography.button, flexShrink: 1, textAlign: 'center'},
});
