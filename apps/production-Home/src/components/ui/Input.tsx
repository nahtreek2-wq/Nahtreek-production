import React, {useState} from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  StyleProp,
  TextStyle,
  ViewStyle,
  TextInputProps,
} from 'react-native';
import {
  Colors,
  Typography,
  BorderRadius,
  Spacing,
} from '@nahtreek/design-system';
import {Icon, IconName} from './Icon';

interface InputProps {
  accessibilityLabel?: string;
  label?: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: 'default' | 'numeric' | 'email-address' | 'phone-pad';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  secureTextEntry?: boolean;
  autoCorrect?: boolean;
  icon?: IconName;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
  dark?: boolean;
  maxLength?: number;
  onFocus?: TextInputProps['onFocus'];
  autoComplete?: TextInputProps['autoComplete'];
  textContentType?: TextInputProps['textContentType'];
}

export function Input({
  accessibilityLabel,
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  keyboardType,
  autoCapitalize,
  secureTextEntry,
  autoCorrect,
  icon,
  leading,
  trailing,
  style,
  inputStyle,
  dark,
  maxLength,
  onFocus,
  autoComplete,
  textContentType,
}: InputProps) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.wrap, style]}>
      {!!label && (
        <Text style={[styles.label, dark && styles.labelDark]}>{label}</Text>
      )}
      <View style={[styles.field, focused && styles.fieldFocused]}>
        {icon && (
          <Icon
            name={icon}
            size={18}
            color={Colors.slate500}
            style={styles.icon}
          />
        )}
        {leading}
        <TextInput
          value={value}
          maxLength={maxLength}
          accessibilityLabel={accessibilityLabel ?? label ?? placeholder}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={Colors.slate500}
          multiline={multiline}
          keyboardType={keyboardType ?? 'default'}
          autoCapitalize={autoCapitalize}
          secureTextEntry={secureTextEntry}
          selectionColor={Colors.navyMid}
          autoCorrect={
            autoCorrect ??
            (keyboardType !== 'email-address' && !secureTextEntry)
          }
          autoComplete={autoComplete}
          textContentType={textContentType}
          onFocus={event => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={() => setFocused(false)}
          style={[styles.input, multiline && styles.inputMultiline, inputStyle]}
        />
        {trailing}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: Spacing.md,
  },
  label: {
    ...Typography.body,
    fontWeight: '600',
    color: Colors.slate700,
    marginBottom: Spacing.sm,
  },
  labelDark: {
    color: Colors.slate200,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    minHeight: 52,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.slate300,
    paddingHorizontal: Spacing.md,
  },
  fieldFocused: {
    borderColor: Colors.navyMid,
    backgroundColor: Colors.surface,
  },
  icon: {
    marginRight: Spacing.xs,
  },
  input: {
    flex: 1,
    minWidth: 0,
    ...Typography.body,
    color: Colors.slate900,
    paddingVertical: Spacing.md - 2,
  },
  inputMultiline: {
    minHeight: 104,
    textAlignVertical: 'top',
  },
});
