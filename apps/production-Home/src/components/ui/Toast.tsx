import React, {useCallback, useEffect, useState} from 'react';
import {Keyboard, Pressable, StyleSheet, Text, View, useWindowDimensions} from 'react-native';
import {Gesture, GestureDetector} from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Motion} from '../../../../../packages/mobile-ui/motion';
import {
  Colors,
  Typography,
  Spacing,
  BorderRadius,
} from '@nahtreek/design-system';
import {Icon, ICONS} from './Icon';
import {ToastItem, useToastStore} from '../../stores/toast';
import {navigationRef} from '../../navigation/usePushNavigation';

const DURATIONS = {
  success: 2800,
  info: 3400,
  warning: 4000,
  error: 4800,
} as const;

export function Toast() {
  const current = useToastStore(s => s.current);
  const hide = useToastStore(s => s.hide);
  const insets = useSafeAreaInsets();
  const {fontScale} = useWindowDimensions();
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', event => setKeyboardHeight(event.endCoordinates.height));
    const hidden = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => {shown.remove(); hidden.remove();};
  }, []);
  if (!current) return null;
  // Mirror the tab bar height formula in AppNavigator so the toast parks just
  // above the tabs on tab screens and near the bottom edge elsewhere.
  const rootState = navigationRef.isReady() ? navigationRef.getRootState() : undefined;
  const onTabRoute = rootState?.routes[rootState.index]?.name === 'MainTabs';
  const tabOffset = 68 + Math.max(insets.bottom, 2) + Math.max(0, fontScale - 1) * 24 + 10 + Spacing.sm;
  const restOffset = insets.bottom + Spacing.md;
  return (
    <ToastCard
      item={current}
      bottom={Math.max(onTabRoute ? tabOffset : restOffset, keyboardHeight + Spacing.sm)}
      onDismiss={() => hide(current.id)}
    />
  );
}

function ToastCard({
  item,
  bottom,
  onDismiss,
}: {
  item: ToastItem;
  bottom: number;
  onDismiss: () => void;
}) {
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(24);
  const opacity = useSharedValue(0);
  const dismiss = useCallback(() => onDismiss(), [onDismiss]);
  useEffect(() => {
    opacity.value = withTiming(1, {duration: Motion.feedback});
    translateY.value = withSpring(0, {damping: 20, stiffness: 260});
    const timer = setTimeout(() => {
      opacity.value = withTiming(0, {duration: Motion.feedback}, finished => {
        if (finished) runOnJS(dismiss)();
      });
      translateY.value = withTiming(12, {duration: Motion.feedback});
    }, DURATIONS[item.kind]);
    return () => clearTimeout(timer);
  }, [dismiss, item.id, item.kind, opacity, translateY]);

  const pan = Gesture.Pan()
    .activeOffsetX([-8, 8])
    .onUpdate(event => {
      translateX.value = event.translationX;
    })
    .onEnd(event => {
      const shouldDismiss =
        Math.abs(event.translationX) > 110 || Math.abs(event.velocityX) > 900;
      if (shouldDismiss) {
        translateX.value = withTiming(
          event.translationX < 0 ? -420 : 420,
          {duration: 150},
          finished => {
            if (finished) runOnJS(dismiss)();
          },
        );
      } else {
        translateX.value = withSpring(0, {damping: 16, stiffness: 190});
      }
    });
  const style = useAnimatedStyle(() => ({
    opacity:
      opacity.value * (1 - Math.min(Math.abs(translateX.value) / 360, 0.7)),
    transform: [{translateX: translateX.value}, {translateY: translateY.value}],
  }));
  const tap = Gesture.Tap().onEnd(() => runOnJS(dismiss)());
  const tone =
    item.kind === 'success'
      ? Colors.success
      : item.kind === 'error'
      ? Colors.error
      : item.kind === 'warning'
      ? Colors.warning
      : Colors.navyMid;
  const icon =
    item.kind === 'success'
      ? ICONS.check
      : item.kind === 'error'
      ? ICONS.close
      : ICONS.alert;
  const heading = item.kind === 'success' ? 'Done' : item.kind === 'error' ? 'Something went wrong' : item.kind === 'warning' ? 'Please check' : 'Update';
  return (
    <View style={[styles.wrap, {bottom}]} pointerEvents="box-none">
      <GestureDetector gesture={Gesture.Race(pan, tap)}>
        <Animated.View
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          style={[styles.toast, style]}>
          <View style={[styles.icon, {backgroundColor: tone + '18'}]}>
            <Icon name={icon} size={18} color={tone} />
          </View>
          <View style={styles.copy}>
            <Text style={[styles.heading, {color: tone}]}>{heading}</Text>
            <Text style={styles.label} numberOfLines={3}>{item.message}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss notification"
            hitSlop={10}
            onPress={onDismiss}
            style={styles.close}>
            <Icon name={ICONS.close} size={18} color={Colors.slate500} />
          </Pressable>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {position: 'absolute', left: Spacing.md, right: Spacing.md, zIndex: 50},
  toast: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.slate200,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    shadowColor: Colors.navyDeep,
    shadowOpacity: 0.16,
    shadowRadius: 12,
    shadowOffset: {width: 0, height: 4},
    elevation: 8,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {flex: 1},
  heading: {fontSize: 12, fontWeight: '800', marginBottom: 2},
  label: {
    ...Typography.caption,
    fontWeight: '500',
    color: Colors.slate800,
  },
  close: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
