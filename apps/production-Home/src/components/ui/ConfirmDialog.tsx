import React from 'react';
import {Modal, Pressable, StyleSheet, Text, View} from 'react-native';
import {BorderRadius, Colors, Spacing, Typography} from '@nahtreek/design-system';
import {useConfirmStore} from '../../stores/confirm';

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
    paddingHorizontal: Spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  title: {...Typography.h3, color: Colors.slate900},
  message: {...Typography.body, color: Colors.slate600, lineHeight: 22},
  row: {flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm},
  single: {marginTop: Spacing.sm},
  button: {
    flex: 1,
    minHeight: 50,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  cancelButton: {backgroundColor: Colors.slate100, borderWidth: 1, borderColor: Colors.slate200},
  confirmButton: {backgroundColor: Colors.navyDeep},
  destructiveButton: {backgroundColor: Colors.error},
  pressed: {opacity: 0.85},
  cancelText: {...Typography.button, color: Colors.navyDeep},
  confirmText: {...Typography.button, color: Colors.white},
});
