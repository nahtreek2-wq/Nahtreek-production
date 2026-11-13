import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {BorderRadius, Colors, Spacing, Typography} from '@nahtreek/design-system';
import {Avatar, Icon, ICONS} from '../ui';
import {useRequestsData} from '../../services/queries';
import {usePlatformHistory, type ServiceRequest} from '../../services/platformQueries';
import type {RootStackParamList} from '../../navigation/types';

const TERMINAL = ['COMPLETED', 'CANCELLED', 'DECLINED', 'EXPIRED'];
const STAGE_LABELS: Record<string, string> = {
  PENDING: 'Waiting for acceptance',
  ACCEPTED: 'Accepted',
  EN_ROUTE: 'On the way',
  ARRIVED: 'Arrived',
  IN_PROGRESS: 'Work in progress',
  AWAITING_CONFIRMATION: 'Ready for your review',
};

// A booking that still needs a pro reads amber; everything live reads green.
const waitingStage = (stage: string) => stage === 'PENDING';

/** Persistent live-booking card: status pill up top, the job below, one Track action. */
export function ActiveBookingBar() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const services = usePlatformHistory('service-requests');
  const engineers = useRequestsData();
  if (!services.data && !engineers.data) return null;
  const activeServices = (services.data?.pages.flatMap(page => page.data) ?? [])
    .filter((item): item is ServiceRequest => 'status' in item && !TERMINAL.includes((item.journey?.stage ?? item.status) ?? ''));
  const activeEngineers = (engineers.data ?? [])
    .filter(item => !TERMINAL.includes(item.status));
  const service = activeServices[0];
  const engineer = activeEngineers[0];
  const pickService = service && (!engineer || Date.parse(service.createdAt) >= Date.parse(engineer.createdAt));
  if (!service && !engineer) return null;
  const stage = pickService ? (service!.journey?.stage ?? service!.status) : engineer!.status;
  const stageLabel = STAGE_LABELS[stage] ?? stage.replace(/_/g, ' ');
  const waiting = waitingStage(stage);
  const title = pickService ? service!.category.title : engineer!.projectTitle;
  const proName = pickService ? service!.provider.fullName : engineer!.engineerName;
  const avatarUri = pickService ? service!.provider.avatarUrl : engineer!.engineerAvatarUrl;
  const go = () => pickService
    ? navigation.navigate('ServiceRequestDetail', {requestId: service!.id})
    : navigation.navigate('RequestDetail', {requestId: engineer!.id});
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Track ${title} booking, ${stageLabel}`}
      onPress={go}
      style={({pressed}) => [styles.card, pressed && styles.pressed]}>
      <View style={styles.topRow}>
        <View style={[styles.pill, waiting ? styles.waitingPill : styles.livePill]}>
          <View style={[styles.dot, waiting ? styles.waitingDot : styles.liveDot]} />
          <Text style={[styles.pillText, waiting ? styles.waitingText : styles.liveText]} numberOfLines={1}>
            {stageLabel}
          </Text>
        </View>
        <View style={styles.trackButton}>
          <Text style={styles.trackText}>Track</Text>
          <Icon name={ICONS.chevronRight} size={16} color={Colors.white} />
        </View>
      </View>
      <View style={styles.jobRow}>
        <Avatar name={proName} uri={avatarUri} size={40} />
        <View style={styles.jobCopy}>
          <Text style={styles.jobTitle} numberOfLines={1}>{title}</Text>
          <Text style={styles.proName} numberOfLines={1}>{proName}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {marginHorizontal: 20, marginTop: Spacing.sm + 4, padding: Spacing.md, gap: Spacing.sm,
    borderRadius: BorderRadius.lg, backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.slate200},
  pressed: {opacity: 0.88},
  topRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm},
  pill: {flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: BorderRadius.full, flexShrink: 1},
  livePill: {backgroundColor: Colors.successBg},
  waitingPill: {backgroundColor: Colors.warningBg},
  dot: {width: 7, height: 7, borderRadius: 4},
  liveDot: {backgroundColor: Colors.success},
  waitingDot: {backgroundColor: Colors.warning},
  pillText: {fontSize: 12, fontWeight: '700', flexShrink: 1},
  liveText: {color: Colors.success},
  waitingText: {color: Colors.warning},
  trackButton: {flexDirection: 'row', alignItems: 'center', gap: 2, paddingLeft: 14, paddingRight: 10,
    paddingVertical: 8, minHeight: 44, borderRadius: BorderRadius.full, backgroundColor: Colors.navyDeep},
  trackText: {...Typography.button, fontSize: 14, color: Colors.white},
  jobRow: {flexDirection: 'row', alignItems: 'center', gap: Spacing.sm},
  jobCopy: {flex: 1, minWidth: 0},
  jobTitle: {fontSize: 15, fontWeight: '700', color: Colors.slate900},
  proName: {...Typography.caption, color: Colors.slate500, marginTop: 1},
});
