import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {Colors} from '@nahtreek/design-system';
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

/** Persistent live-booking bar: the client always sees an active booking and can jump straight to tracking. */
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
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={pickService ? `Track ${service!.category.title} booking` : `Track ${engineer!.projectTitle} request`}
      onPress={() => pickService
        ? navigation.navigate('ServiceRequestDetail', {requestId: service!.id})
        : navigation.navigate('RequestDetail', {requestId: engineer!.id})}
      style={({pressed}) => [styles.bar, pressed && styles.pressed]}>
      <View style={styles.liveDot} />
      {pickService ? (
        <Avatar name={service!.provider.fullName} uri={service!.provider.avatarUrl} size={40} />
      ) : (
        <Avatar name={engineer!.engineerName} uri={engineer!.engineerAvatarUrl} size={40} />
      )}
      <View style={styles.copy}>
        <Text style={styles.stage} numberOfLines={1}>{STAGE_LABELS[stage] ?? stage.replace(/_/g, ' ')}</Text>
        <Text style={styles.title} numberOfLines={1}>
          {pickService ? `${service!.category.title} · ${service!.provider.fullName}` : `${engineer!.projectTitle} · ${engineer!.engineerName}`}
        </Text>
      </View>
      <Text style={styles.track}>Track</Text>
      <Icon name={ICONS.chevronRight} size={18} color={Colors.white} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 20, marginTop: 12, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 16, backgroundColor: Colors.navyDeep},
  pressed: {opacity: 0.88},
  liveDot: {width: 8, height: 8, borderRadius: 4, backgroundColor: '#4ADE80'},
  copy: {flex: 1, gap: 2},
  stage: {fontSize: 12, fontWeight: '700', color: '#4ADE80'},
  title: {fontSize: 14, fontWeight: '600', color: Colors.white},
  track: {fontSize: 14, fontWeight: '700', color: Colors.white},
});
