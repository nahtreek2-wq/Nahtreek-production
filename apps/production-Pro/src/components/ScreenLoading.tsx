import React, {useEffect, useRef} from 'react';
import {Animated, Dimensions, Easing, StyleSheet, Text, View} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import {BorderRadius, Colors, Spacing, Typography} from '@nahtreek/design-system';
import {useReducedMotion} from '../../../../packages/mobile-ui/useReducedMotion';

const SWEEP_WIDTH = 140;

// One skeleton card with a light band sweeping across it: the modern
// shimmer read instead of a whole-screen blink. Cards stagger so the wave
// travels down the list. Reduced motion renders static placeholders.
function ShimmerCard({children, style, index}: {children: React.ReactNode; style?: object; index: number}) {
  const sweep = useRef(new Animated.Value(0)).current;
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    if (reducedMotion) {return;}
    const animation = Animated.loop(
      Animated.sequence([
        Animated.delay(index * 220),
        Animated.timing(sweep, {toValue: 1, duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: true}),
        Animated.delay(Math.max(0, 600 - index * 120)),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [sweep, index, reducedMotion]);
  const translateX = sweep.interpolate({inputRange: [0, 1], outputRange: [-SWEEP_WIDTH, Dimensions.get('window').width]});
  return (
    <View style={[styles.card, style]}>
      {children}
      {reducedMotion ? null : (
        <Animated.View style={[styles.sweep, {width: SWEEP_WIDTH, transform: [{translateX}]}]}>
          <LinearGradient
            colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.85)', 'rgba(255,255,255,0)']}
            start={{x: 0, y: 0.5}}
            end={{x: 1, y: 0.5}}
            style={styles.sweepFill}
          />
        </Animated.View>
      )}
    </View>
  );
}

export function ScreenLoading({label = 'Loading your workspace…', rows = 3, variant = 'list'}: {label?: string; rows?: number; variant?: 'list' | 'dashboard'}) {
  const cards = variant === 'dashboard' ? Math.min(rows, 2) : rows;
  return <View style={styles.root} accessibilityRole="progressbar" accessibilityLabel={label}>
    <Text accessibilityLiveRegion="polite" style={styles.label}>{label}</Text>
    {variant === 'dashboard' ? <ShimmerCard index={0} style={styles.overview}>{[0, 1, 2].map(index => <View key={index} style={styles.overviewCell}><View style={styles.overviewIcon} /><View style={styles.overviewValue} /><View style={styles.overviewCaption} /></View>)}</ShimmerCard> : null}
    {Array.from({length: cards}, (_, index) => <ShimmerCard key={index} index={index + (variant === 'dashboard' ? 1 : 0)}><View style={styles.icon} /><View style={styles.copy}><View style={[styles.title, index % 2 ? styles.titleShort : null]} /><View style={styles.line} /><View style={styles.shortLine} /></View></ShimmerCard>)}
  </View>;
}

const styles = StyleSheet.create({
  root: {flex: 1, padding: Spacing.lg, backgroundColor: Colors.offWhite}, label: {...Typography.caption, color: Colors.slate600, marginBottom: Spacing.md},
  overview: {minHeight: 112, flexDirection: 'row', backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.slate200, borderRadius: BorderRadius.lg, marginBottom: Spacing.md, paddingVertical: 14, overflow: 'hidden'},
  overviewCell: {flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8},
  overviewIcon: {width: 22, height: 22, borderRadius: 7, backgroundColor: Colors.slate100},
  overviewValue: {width: 30, height: 18, borderRadius: 8, backgroundColor: Colors.slate200},
  overviewCaption: {width: '65%', height: 11, borderRadius: 6, backgroundColor: Colors.slate100},
  card: {minHeight: 94, flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.md, padding: Spacing.md, borderRadius: BorderRadius.lg, backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.slate200, overflow: 'hidden'},
  sweep: {position: 'absolute', top: 0, bottom: 0, left: 0},
  sweepFill: {flex: 1},
  icon: {width: 48, height: 48, borderRadius: 24, backgroundColor: Colors.slate100}, copy: {flex: 1, gap: Spacing.sm}, title: {width: '62%', height: 15, borderRadius: 8, backgroundColor: Colors.slate200}, titleShort: {width: '44%'}, line: {width: '92%', height: 11, borderRadius: 6, backgroundColor: Colors.slate100}, shortLine: {width: '48%', height: 11, borderRadius: 6, backgroundColor: Colors.slate100},
});
