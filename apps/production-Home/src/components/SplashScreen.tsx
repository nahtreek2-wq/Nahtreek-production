import React, {useEffect, useRef} from 'react';
import {Animated, Image, StatusBar, StyleSheet, Text, View} from 'react-native';
import {BrandLogoReveal} from '../../../../packages/mobile-ui/BrandLogoReveal';
import {useReducedMotion} from '../../../../packages/mobile-ui/useReducedMotion';
import {BRAND} from '../theme/brand';
import {Colors} from '@nahtreek/design-system';

const MINIMUM_SPLASH_MS = 800;

interface SplashScreenProps {
  isReady?: boolean;
  onFinish: () => void;
  // Resume path: the app is reopening onto the last-used screen (the OS
  // recreated the view), so the logo animation must not replay — show a
  // static brand mark and dismiss immediately once ready.
  instant?: boolean;
}

export function SplashScreen({isReady = false, onFinish, instant = false}: SplashScreenProps) {
  const opacity = useRef(new Animated.Value(1)).current;
  const startedAt = useRef(Date.now());
  const finished = useRef(false);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (!isReady) return;
    if (instant) {
      if (finished.current) return;
      finished.current = true;
      onFinish();
      return;
    }
    const remaining = reducedMotion ? 0 : Math.max(
      0,
      MINIMUM_SPLASH_MS - (Date.now() - startedAt.current),
    );
    const timer = setTimeout(() => {
      if (finished.current) return;
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
        if (didFinish) onFinish();
      });
    }, remaining);
    return () => clearTimeout(timer);
  }, [isReady, instant, onFinish, opacity, reducedMotion]);

  if (instant) {
    return (
      <View style={styles.root}>
        <StatusBar barStyle="light-content" backgroundColor={BRAND.splashBackground} />
        <Image source={require('../assets/nahtreek_home_mark.png')} style={styles.mark} resizeMode="contain" />
        <Text style={styles.name}>{BRAND.name}</Text>
        <Text style={styles.product}>HOME</Text>
      </View>
    );
  }

  return (
    <Animated.View style={[styles.root, {opacity}]}>
      <StatusBar barStyle="light-content" backgroundColor={BRAND.splashBackground} />
      <BrandLogoReveal
        mark={require('../assets/nahtreek_home_mark.png')}
        name={BRAND.name}
        product="HOME"
        tagline="Find the right help for your home"
        size={132}
        durationScale={0.5}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BRAND.splashBackground,
  },
  mark: {width: 132, height: 132},
  name: {color: Colors.white, fontSize: 26, fontWeight: '800', letterSpacing: 4, marginTop: 16},
  product: {color: Colors.gold, fontSize: 15, fontWeight: '700', letterSpacing: 6, marginTop: 6},
});
