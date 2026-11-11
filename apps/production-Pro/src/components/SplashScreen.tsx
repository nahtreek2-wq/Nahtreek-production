import React, {useEffect, useRef} from 'react';
import {Animated, Image, StyleSheet, Text, View} from 'react-native';
import {ProLoader} from './ProLoader';
import {useReducedMotion} from '../../../../packages/mobile-ui/useReducedMotion';
import {ProColors, ProType} from '../theme/professionalTheme';

export function SplashScreen({ready, onFinish, instant = false}: {ready: boolean; onFinish: () => void; instant?: boolean}) {
  const opacity = useRef(new Animated.Value(1)).current;
  const finished = useRef(false);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (!ready) {return;}
    if (instant) {
      if (finished.current) {return;}
      finished.current = true;
      onFinish();
      return;
    }
    const timer = setTimeout(() => {
      if (finished.current) {return;}
      finished.current = true;
      if (reducedMotion) {
        onFinish();
        return;
      }
      Animated.timing(opacity, {
        toValue: 0,
        duration: 280,
        useNativeDriver: true,
      }).start(({finished: didFinish}) => {
        if (didFinish) {onFinish();}
      });
    }, 0);
    return () => clearTimeout(timer);
  }, [instant, onFinish, opacity, ready, reducedMotion]);

  return (
    <Animated.View
      accessibilityLabel="Loading NAHTREEK Pro"
      style={[styles.root, {opacity}]}>
      <View style={styles.brand}>
        <Image source={require('../assets/nahtreek-logo.png')} style={styles.logo} resizeMode="contain" accessibilityLabel="NAHTREEK logo" />
        <Text style={styles.name}>NAHTREEK</Text>
        <Text style={styles.product}>PROFESSIONALS</Text>
        <Text style={styles.tagline}>FROM PLOT TO HOME</Text>
      </View>
      <View style={styles.loader}>
        <ProLoader size={34} tone="light" />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ProColors.deep,
  },
  brand: {alignItems: 'center'},
  logo: {width: 96, height: 96},
  name: {...ProType.screen, color: ProColors.surface, letterSpacing: 1.5, marginTop: 16},
  product: {...ProType.eyebrow, color: ProColors.surface, letterSpacing: 2.1, marginTop: 4},
  tagline: {...ProType.meta, color: '#C9D5E5', letterSpacing: 1.2, marginTop: 10},
  loader: {position: 'absolute', bottom: 70},
});
