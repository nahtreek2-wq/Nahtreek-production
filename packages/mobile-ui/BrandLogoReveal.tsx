import React, {useEffect, useRef} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Image,
  ImageSourcePropType,
  StyleSheet,
  Text,
  View,
} from 'react-native';

type BrandLogoRevealProps = {
  mark: ImageSourcePropType;
  name: string;
  product: string;
  tagline: string;
  accentColor?: string;
  size?: number;
  durationScale?: number;
};

const DOTS = [
  {left: 47, top: 1},
  {left: 78, top: 18},
  {left: 78, top: 54},
  {left: 47, top: 71},
  {left: 16, top: 54},
  {left: 16, top: 18},
];

const DOT_CENTER = {x: 47.5, y: 36.5};

/** Six orbiting points converge into the brand mark before the wordmark appears. */
export function BrandLogoReveal({
  mark,
  name,
  product,
  tagline,
  accentColor = '#C4A639',
  size = 112,
  durationScale = 1,
}: BrandLogoRevealProps) {
  const orbitOpacity = useRef(new Animated.Value(0)).current;
  const orbitRotation = useRef(new Animated.Value(0)).current;
  const dotProgress = useRef(DOTS.map(() => new Animated.Value(0))).current;
  const markOpacity = useRef(new Animated.Value(0)).current;
  const markScale = useRef(new Animated.Value(0.94)).current;
  const copyOpacity = useRef(new Animated.Value(0)).current;
  const copyOffset = useRef(new Animated.Value(12)).current;
  const animation = useRef<Animated.CompositeAnimation | null>(null);
  const duration = (milliseconds: number) => Math.round(milliseconds * durationScale);

  useEffect(() => {
    let active = true;
    let preferenceChanged = false;
    const showFinal = () => {
      animation.current?.stop();
      orbitOpacity.setValue(0);
      dotProgress.forEach(progress => progress.setValue(1));
      markOpacity.setValue(1);
      markScale.setValue(1);
      copyOpacity.setValue(1);
      copyOffset.setValue(0);
    };
    const playReveal = () => {
      animation.current?.stop();
      orbitOpacity.setValue(0);
      orbitRotation.setValue(0);
      dotProgress.forEach(progress => progress.setValue(0));
      markOpacity.setValue(0);
      markScale.setValue(0.94);
      copyOpacity.setValue(0);
      copyOffset.setValue(12);
      animation.current = Animated.sequence([
        Animated.timing(orbitOpacity, {
          toValue: 1,
          duration: duration(140),
          useNativeDriver: true,
        }),
        Animated.parallel([
          Animated.timing(orbitRotation, {
            toValue: 1,
            duration: duration(560),
            easing: Easing.linear,
            useNativeDriver: true,
          }),
          Animated.sequence([
            Animated.delay(duration(330)),
            Animated.timing(orbitOpacity, {toValue: 0, duration: duration(230), useNativeDriver: true}),
          ]),
          Animated.stagger(
            duration(28),
            dotProgress.map(progress =>
              Animated.timing(progress, {
                toValue: 1,
                duration: duration(430),
                easing: Easing.inOut(Easing.cubic),
                useNativeDriver: true,
              }),
            ),
          ),
        ]),
        Animated.parallel([
          Animated.timing(markOpacity, {
            toValue: 1,
            duration: duration(300),
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(markScale, {
            toValue: 1,
            duration: duration(360),
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(copyOpacity, {
            toValue: 1,
            duration: duration(340),
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(copyOffset, {
            toValue: 0,
            duration: duration(340),
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
        ]),
      ]);
      animation.current.start();
    };
    const applyMotionPreference = (reduced: boolean) => {
      if (!active) return;
      if (reduced) showFinal();
      else playReveal();
    };

    const listener = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      reduced => {
        preferenceChanged = true;
        applyMotionPreference(reduced);
      },
    );
    void AccessibilityInfo.isReduceMotionEnabled()
      .then(reduced => {
        if (!preferenceChanged) applyMotionPreference(reduced);
      })
      .catch(showFinal);

    return () => {
      active = false;
      listener.remove();
      animation.current?.stop();
    };
  }, [
    copyOffset,
    copyOpacity,
    markOpacity,
    markScale,
    orbitOpacity,
    orbitRotation,
    dotProgress,
    durationScale,
  ]);

  const spin = orbitRotation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '150deg'],
  });

  return (
    <View style={[styles.content, {transform: [{scale: size / 112}]}]}>
      <View
        style={styles.markArea}
        accessible
        accessibilityRole="image"
        accessibilityLabel={`${name} logo`}>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.orbit,
            {opacity: orbitOpacity, transform: [{rotate: spin}]},
          ]}>
          {DOTS.map((dot, index) => {
            const dx = DOT_CENTER.x - dot.left;
            const dy = DOT_CENTER.y - dot.top;
            const progress = dotProgress[index];
            const translateX = progress.interpolate({
              inputRange: [0, 1],
              outputRange: [0, dx],
            });
            const translateY = progress.interpolate({
              inputRange: [0, 1],
              outputRange: [0, dy],
            });
            const scale = progress.interpolate({
              inputRange: [0, 1],
              outputRange: [1, 0.16],
            });
            return (
              <Animated.View
                key={index}
                style={[
                  styles.dotPosition,
                  {left: dot.left, top: dot.top},
                  {transform: [{translateX}, {translateY}, {scale}]},
                ]}>
                <View style={[styles.dot, {backgroundColor: accentColor}]} />
              </Animated.View>
            );
          })}
        </Animated.View>
        <Animated.View
          style={{
            opacity: markOpacity,
            transform: [{scale: markScale}],
          }}>
          <Image source={mark} style={styles.mark} resizeMode="contain" />
        </Animated.View>
      </View>
      <Animated.View
        style={[
          styles.copy,
          {opacity: copyOpacity, transform: [{translateY: copyOffset}]},
        ]}>
        <View style={styles.nameRow}>
          <Text style={styles.name}>{name}</Text>
          <Text style={[styles.product, {color: accentColor}]}>{product}</Text>
        </View>
        <Text style={styles.tagline}>{tagline}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {alignItems: 'center'},
  markArea: {
    width: 112,
    height: 112,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbit: {position: 'absolute', width: 104, height: 82, top: 15, left: 4},
  dotPosition: {position: 'absolute'},
  dot: {width: 9, height: 9, borderRadius: 4.5},
  mark: {width: 104, height: 104},
  copy: {alignItems: 'center', marginTop: 18},
  nameRow: {flexDirection: 'row', alignItems: 'baseline'},
  name: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 2.4,
  },
  product: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginLeft: 7,
  },
  tagline: {
    color: '#D7DFEA',
    fontSize: 12,
    fontWeight: '400',
    letterSpacing: 0.15,
    marginTop: 9,
  },
});
