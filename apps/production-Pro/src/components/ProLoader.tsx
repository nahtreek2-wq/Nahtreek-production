import React, {useEffect, useRef} from 'react';
import {Animated, Easing, StyleSheet, Text, View} from 'react-native';
import {ProColors, ProType} from '../theme/professionalTheme';
import {useReducedMotion} from '../../../../packages/mobile-ui/useReducedMotion';

// Modern ring loader: a navy arc sweeping a soft track around a pulsing
// amber core. One component everywhere, so loading reads as one brand
// instead of a mix of platform spinners.
export function ProLoader({size = 44, label, tone = 'navy'}: {
  size?: number;
  label?: string;
  tone?: 'navy' | 'light' | 'red';
}) {
  const spin = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0.65)).current;
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    if (reducedMotion) {
      spin.setValue(0.22);
      pulse.setValue(0.9);
      return;
    }
    const sweep = Animated.loop(
      Animated.timing(spin, {toValue: 1, duration: 950, easing: Easing.linear, useNativeDriver: true}),
    );
    const beat = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {toValue: 1, duration: 480, easing: Easing.inOut(Easing.ease), useNativeDriver: true}),
        Animated.timing(pulse, {toValue: 0.65, duration: 480, easing: Easing.inOut(Easing.ease), useNativeDriver: true}),
      ]),
    );
    sweep.start();
    beat.start();
    return () => {
      sweep.stop();
      beat.stop();
    };
  }, [spin, pulse, reducedMotion]);
  const rotation = spin.interpolate({inputRange: [0, 1], outputRange: ['0deg', '360deg']});
  const palette =
    tone === 'light'
      ? {track: 'rgba(255,255,255,0.25)', arc: '#FFFFFF'}
      : tone === 'red'
      ? {track: 'rgba(180,35,24,0.14)', arc: ProColors.error}
      : {track: 'rgba(11,45,91,0.14)', arc: ProColors.primary};
  const ring = Math.max(24, size);
  const core = Math.round(ring * 0.28);
  return (
    <View style={styles.wrap} accessibilityRole="progressbar" accessibilityLabel={label ?? 'Loading'}>
      <View style={[styles.ring, {width: ring, height: ring, borderRadius: ring / 2, borderColor: palette.track}]}>
        <Animated.View
          style={[
            styles.arc,
            {
              width: ring,
              height: ring,
              borderRadius: ring / 2,
              borderTopColor: palette.arc,
              borderRightColor: palette.arc,
              transform: [{rotate: rotation}],
            },
          ]}
        />
        <Animated.View
          style={[
            styles.core,
            {width: core, height: core, borderRadius: core / 2, backgroundColor: palette.arc, opacity: pulse,
              transform: [{scale: pulse}]},
          ]}
        />
      </View>
      {label ? <Text style={[styles.label, tone === 'light' && styles.labelLight]}>{label}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {alignItems: 'center', justifyContent: 'center', gap: 10},
  ring: {borderWidth: 4, alignItems: 'center', justifyContent: 'center'},
  arc: {position: 'absolute', borderWidth: 4, borderLeftColor: 'transparent', borderBottomColor: 'transparent'},
  core: {position: 'absolute'},
  label: {...ProType.meta, color: ProColors.secondary, textAlign: 'center'},
  labelLight: {color: '#FFFFFF'},
});
