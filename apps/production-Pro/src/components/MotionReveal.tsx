import React, {useEffect, useRef} from 'react';
import {Animated, type StyleProp, type ViewStyle} from 'react-native';
import {useReducedMotion} from '../../../../packages/mobile-ui/useReducedMotion';
import {Motion} from '../../../../packages/mobile-ui/motion';

export function MotionReveal({children, delay = 0, style}: {
  children: React.ReactNode;
  delay?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reducedMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(1)).current;
  const offset = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reducedMotion) {
      opacity.setValue(1);
      offset.setValue(0);
      return;
    }
    opacity.setValue(0.88);
    offset.setValue(6);
    const animation = Animated.parallel([
      Animated.timing(opacity, {toValue: 1, duration: Motion.entrance, delay, useNativeDriver: true}),
      Animated.timing(offset, {toValue: 0, duration: Motion.entrance, delay, useNativeDriver: true}),
    ]);
    animation.start();
    return () => animation.stop();
  }, [delay, offset, opacity, reducedMotion]);

  return <Animated.View style={[style, {opacity, transform: [{translateY: offset}]}]}>{children}</Animated.View>;
}
