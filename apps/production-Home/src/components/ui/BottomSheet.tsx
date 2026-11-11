import React, {useEffect} from 'react';
import {Modal, View, Text, TouchableOpacity, StyleSheet, ScrollView, useWindowDimensions} from 'react-native';
import {KeyboardAwareView} from '../../../../../packages/mobile-ui/KeyboardAwareView';
import {Colors, Typography, BorderRadius, Spacing} from '@nahtreek/design-system';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import {Icon, ICONS} from './Icon';
import {useFormKeyboardScroll} from '../../hooks/useFormKeyboardScroll';
import {useReducedMotion} from '../../../../../packages/mobile-ui/useReducedMotion';
import {Motion} from '../../../../../packages/mobile-ui/motion';

interface BottomSheetProps {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}

export function BottomSheet({visible, title, subtitle, onClose, children}: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  const {height} = useWindowDimensions();
  const progress = useSharedValue(0);
  const reducedMotion = useReducedMotion();
  const keyboardScroll = useFormKeyboardScroll(28);

  useEffect(() => {
    if (!visible) {
      progress.value = 0;
    }
  }, [progress, visible]);

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: progress.value * 0.55,
  }));
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{translateY: (1 - progress.value) * height}],
  }));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onShow={() => {
        progress.value = withTiming(1, {duration: reducedMotion ? 0 : Motion.sheet});
      }}
      onRequestClose={onClose}>
      <KeyboardAwareView style={[styles.root, {paddingTop: insets.top + Spacing.md}]}>
        <Animated.View pointerEvents="auto" style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>
        <Animated.View accessibilityViewIsModal style={[styles.sheet, {paddingBottom: insets.bottom + Spacing.md, maxHeight: height - insets.top - Spacing.md}, sheetStyle]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.titles}>
              <Text accessibilityRole="header" style={styles.title}>{title}</Text>
              {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
            </View>
            <TouchableOpacity onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel="Close sheet">
              <Icon name={ICONS.close} size={18} color={Colors.slate500} />
            </TouchableOpacity>
          </View>
            <ScrollView
              ref={keyboardScroll.scrollRef}
              onScroll={keyboardScroll.onScroll}
              scrollEventThrottle={16}
              style={styles.scroll}
              showsVerticalScrollIndicator={false}
              keyboardDismissMode={keyboardScroll.keyboardDismissMode}
              keyboardShouldPersistTaps="handled">
              {children}
            </ScrollView>
        </Animated.View>
      </KeyboardAwareView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    backgroundColor: '#000',
  },
  sheet: {
    maxHeight: '100%',
    flexShrink: 0,
    backgroundColor: Colors.surface,
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
  },
  scroll: {flexGrow: 0, flexShrink: 1, minHeight: 1},
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.slate200,
    marginBottom: Spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  titles: {
    flex: 1,
  },
  title: {
    ...Typography.h3,
    color: Colors.slate900,
  },
  subtitle: {
    ...Typography.caption,
    color: Colors.slate500,
    marginTop: 2,
  },
  close: {
    minWidth: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
