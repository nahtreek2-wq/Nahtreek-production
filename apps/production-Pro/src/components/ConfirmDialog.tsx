import React from 'react';
import {Modal, Pressable, StyleSheet, Text, View} from 'react-native';
import {useConfirmStore} from '../stores/confirm';
import {ProColors, ProRadius, ProSpacing, ProType} from '../theme/professionalTheme';

// Branded confirm dialog rendered at the app root: navy scrim, white card,
// one primary action plus an optional cancel. Backdrop tap and the Android
// back button both count as cancel.
export function ConfirmDialog() {
  const current = useConfirmStore(state => state.current);
  const answer = useConfirmStore(state => state.answer);
  return (
    <Modal
      visible={current !== null}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => answer(false)}>
      <View style={styles.scrim}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss dialog"
          onPress={() => answer(false)}
          style={StyleSheet.absoluteFill}
        />
        {current ? (
          <View accessibilityViewIsModal accessibilityRole="alert" style={styles.card}>
            <Text accessibilityRole="header" style={styles.title}>
              {current.title}
            </Text>
            <Text style={styles.message}>{current.message}</Text>
            <View style={current.cancelLabel ? styles.row : styles.single}>
              {current.cancelLabel ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={current.cancelLabel}
                  onPress={() => answer(false)}
                  style={({pressed}) => [styles.button, styles.cancelButton, pressed && styles.pressed]}>
                  <Text style={styles.cancelText}>{current.cancelLabel}</Text>
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={current.confirmLabel}
                onPress={() => answer(true)}
                style={({pressed}) => [
                  styles.button,
                  current.destructive ? styles.destructiveButton : styles.confirmButton,
                  pressed && styles.pressed,
                ]}>
                <Text style={styles.confirmText}>{current.confirmLabel}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(17, 31, 53, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: ProSpacing.xl,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: ProColors.surface,
    borderRadius: ProRadius.card,
    padding: ProSpacing.xl,
    gap: ProSpacing.sm,
  },
  title: {...ProType.card, color: ProColors.text},
  message: {...ProType.body, color: ProColors.secondary},
  row: {flexDirection: 'row', gap: ProSpacing.sm, marginTop: ProSpacing.sm},
  single: {marginTop: ProSpacing.sm},
  button: {
    flex: 1,
    minHeight: 50,
    borderRadius: ProRadius.input,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: ProSpacing.md,
  },
  cancelButton: {backgroundColor: ProColors.surface, borderWidth: 1, borderColor: ProColors.border},
  confirmButton: {backgroundColor: ProColors.primary},
  destructiveButton: {backgroundColor: ProColors.error},
  pressed: {opacity: 0.85},
  cancelText: {...ProType.action, color: ProColors.primary},
  confirmText: {...ProType.action, color: ProColors.surface},
});
