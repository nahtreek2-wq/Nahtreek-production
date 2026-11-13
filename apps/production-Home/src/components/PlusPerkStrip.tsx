import React, {useEffect, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {Colors} from '@nahtreek/design-system';
import {Icon, ICONS} from './ui';
import {fetchAiPlan, fetchAiSubscription, type AiPlanView} from '../services/aiBilling';
import {inr} from '../utils/format';
import {ClientColors} from '../design-system/tokens';
import type {RootStackParamList} from '../navigation/types';

/** Blinkit-style offer strip on booking sheets. Every number comes from the server plan card; hidden for Plus members and when offline. */
export function PlusPerkStrip({consultFeePaisa}: {consultFeePaisa?: number}) {
  const [plan, setPlan] = useState<AiPlanView | null>(null);
  const [effective, setEffective] = useState(false);
  useEffect(() => {
    fetchAiPlan().then(setPlan).catch(() => undefined);
    fetchAiSubscription().then(view => setEffective(view.effective)).catch(() => undefined);
  }, []);
  if (!plan || effective) return null;
  return <PlusPerkStripInner plan={plan} consultFeePaisa={consultFeePaisa} />;
}

function PlusPerkStripInner({plan, consultFeePaisa}: {plan: AiPlanView; consultFeePaisa?: number}) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const savings = consultFeePaisa != null
    ? Math.min(Math.floor((consultFeePaisa * plan.consultDiscountBps) / 10000), plan.consultDiscountCapPaisa)
    : 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="View NAHTREEK Plus benefits"
      onPress={() => navigation.navigate('Plus')}
      style={({pressed}) => [styles.strip, pressed && styles.pressed]}>
      <Icon name={ICONS.star} size={20} color={Colors.navyDeep} />
      <View style={styles.copy}>
        <Text style={styles.title}>
          Plus members{consultFeePaisa != null && savings > 0 ? ` save ${inr(savings)} on this booking` : ' skip the wait'}
        </Text>
        <Text style={styles.body} numberOfLines={2}>
          {Math.round(plan.acceptWindowMs / 60000)}-min accept · late pros pay {inr(plan.lateArrivalPenaltyPaisa)} · consult discounts up to {inr(plan.consultDiscountCapPaisa)}
        </Text>
      </View>
      <Icon name={ICONS.chevronRight} size={18} color={Colors.navyMid} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  strip: {flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.navyDeep},
  pressed: {opacity: 0.85},
  copy: {flex: 1, gap: 2},
  title: {fontSize: 14, fontWeight: '700', color: Colors.navyDeep},
  body: {fontSize: 12, lineHeight: 17, color: Colors.slate600},
});
