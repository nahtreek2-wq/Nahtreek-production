import React, {useState} from 'react';
import {
  Animated,
  NativeModules,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import {useBottomTabBarHeight, type BottomTabNavigationProp} from '@react-navigation/bottom-tabs';
import {useNavigation} from '@react-navigation/native';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {
  BorderRadius,
  Colors,
  Spacing,
  Typography,
} from '@nahtreek/design-system';
import {ScreenHeader} from '../components/ScreenHeader';
import {ProButton} from '../components/ProButton';
import {EmptyState} from '../components/EmptyState';
import {KeyboardAwareView} from '../../../../packages/mobile-ui/KeyboardAwareView';
import {DateTimeField} from '../../../../packages/mobile-ui/DateTimeField';
import {VerificationGate} from '../components/VerificationGate';
import type {MainTabParamList} from '../navigation/types';
import {api, ApiError} from '../services/apiClient';
import {ScreenLoading} from '../components/ScreenLoading';
import {MotionReveal} from '../components/MotionReveal';
import {ScrollMotionBar, useScrollMotion} from '../components/ScrollMotionBar';
import {useSessionStore} from '../stores/session';
import {useProToast} from '../stores/proToast';
import {confirmDialog} from '../stores/confirm';
import {ProColors, ProType} from '../theme/professionalTheme';

type Slot = {
  id: string;
  startsAt: string;
  endsAt: string;
  isAvailable: boolean;
};
type Availability = {isAvailable: boolean; slots: Slot[]};

function futureSlot(days: number, startHour: number, endHour: number) {
  const start = new Date();
  start.setDate(start.getDate() + days);
  start.setHours(startHour, 0, 0, 0);
  const end = new Date(start);
  end.setHours(endHour, 0, 0, 0);
  return {startsAt: start.toISOString(), endsAt: end.toISOString()};
}

function customSlot(day: Date | null, start: Date | null, end: Date | null) {
  // Native pickers return real Dates: combine the picked day with the picked
  // start/end times, then only the future/range checks remain.
  if (!day || !start || !end) {return null;}
  const startsAt = new Date(day);
  startsAt.setHours(start.getHours(), start.getMinutes(), 0, 0);
  const endsAt = new Date(day);
  endsAt.setHours(end.getHours(), end.getMinutes(), 0, 0);
  if (startsAt <= new Date() || endsAt <= startsAt) {return null;}
  return {startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString()};
}

export function ScheduleScreen() {
  const tabBarHeight = useBottomTabBarHeight();
  const scrollMotion = useScrollMotion();
  const navigation = useNavigation<BottomTabNavigationProp<MainTabParamList>>();
  const queryClient = useQueryClient();
  const toast = useProToast();
  const [customOpen, setCustomOpen] = useState(false);
  const [customDate, setCustomDate] = useState<Date | null>(null);
  const [customStart, setCustomStart] = useState<Date | null>(null);
  const [customEnd, setCustomEnd] = useState<Date | null>(null);
  const [customError, setCustomError] = useState('');
  const serviceProvider = useSessionStore(state =>
    state.user?.roles.includes('SERVICE_PROVIDER'),
  );
  const profile = useQuery({
    queryKey: ['professional-profile'],
    queryFn: () => api.get<{profile: {verificationStatus: string} | null}>('/professionals/me'),
  });
  const verificationStatus = profile.data?.profile?.verificationStatus;
  const locked = Boolean(profile.data) && verificationStatus !== 'VERIFIED';
  const underReview = verificationStatus === 'UNDER_REVIEW' || verificationStatus === 'PENDING';
  const goVerify = () =>
    navigation.navigate('Profile', {
      screen:
        verificationStatus === 'UNDER_REVIEW' ||
        verificationStatus === 'PENDING' ||
        verificationStatus === 'REJECTED'
          ? 'VerificationDocuments'
          : 'ProfessionalSetup',
    });
  const availability = useQuery({
    queryKey: ['professional-availability'],
    queryFn: () => api.get<Availability>('/professionals/me/availability'),
  });
  const refresh = () =>
    queryClient.invalidateQueries({queryKey: ['professional-availability']});
  const create = useMutation({
    mutationFn: (slot: {startsAt: string; endsAt: string}) =>
      api.post('/professionals/me/availability', slot),
    onSuccess: () => {setCustomOpen(false); setCustomError(''); refresh(); toast('Time slot added.', 'success');},
    onError: error => {toast(error instanceof Error ? error.message : 'Could not add this slot.', 'error');},
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      api.delete(`/professionals/me/availability/${id}`),
    onSuccess: () => {refresh(); toast('Time slot removed.', 'success');},
    onError: error => {toast(error instanceof Error ? error.message : 'Could not remove this slot.', 'error');},
  });
  const status = useMutation({
    mutationFn: (isAvailable: boolean) =>
      api.patch<{isAvailable: boolean; retainLocationSharing?: boolean}>('/professionals/me/work-status', {isAvailable}),
    onSuccess: (result, isAvailable) => {
      if (serviceProvider && Platform.OS === 'android' && !isAvailable && !result.retainLocationSharing) {
        NativeModules.NahtreekRuntimeConfig.stopLiveLocation().catch(() => undefined);
      }
      toast(isAvailable ? "You're open for new work." : 'New work paused.', 'success');
      return refresh();
    },
    onError: error => {
      toast(error instanceof Error ? error.message : 'Could not update availability.', 'error');
    },
  });
  const presets = [
    {
      label: 'Tomorrow morning',
      detail: '9:00 AM – 12:00 PM',
      slot: futureSlot(1, 9, 12),
    },
    {
      label: 'Tomorrow afternoon',
      detail: '2:00 PM – 5:00 PM',
      slot: futureSlot(1, 14, 17),
    },
    {
      label: 'Day after tomorrow',
      detail: '9:00 AM – 12:00 PM',
      slot: futureSlot(2, 9, 12),
    },
  ];
  const error = create.error ?? remove.error ?? status.error;
  const today = new Date().toDateString();
  const todaySlots = availability.data?.slots.filter(slot => slot.isAvailable && new Date(slot.startsAt).toDateString() === today && new Date(slot.endsAt) > new Date()) ?? [];
  const addCustom = () => {
    const slot = customSlot(customDate, customStart, customEnd);
    if (!slot) {setCustomError('Pick a future date with an end time after the start time.'); return;}
    setCustomError('');
    create.mutate(slot);
  };
  return (
    <KeyboardAwareView style={styles.root}>
      <ScreenHeader
        title={serviceProvider ? 'My availability' : 'My time'}
        subtitle={
          serviceProvider
            ? 'Set the times when you can accept work'
            : 'Your work days and times'
        }
      />
      <ScrollMotionBar offset={scrollMotion.offset} reducedMotion={scrollMotion.reducedMotion} />
      {locked ? (
        <VerificationGate
          feature="time"
          underReview={underReview}
          onVerify={goVerify}
          bottomPadding={tabBarHeight + 24}
        />
      ) : (
      <>
      {availability.isPending ? (
        <ScreenLoading label="Loading your availability…" />
      ) : null}
      {availability.isError ? (
        <View style={styles.content}>
          <EmptyState
            icon="cloud-off-outline"
            title="Schedule could not load"
            message={
              availability.error instanceof ApiError
                ? availability.error.message
                : 'Check your connection and try again.'
            }
          />
          <ProButton label="Try again" variant="secondary" onPress={() => void availability.refetch()} />
        </View>
      ) : null}
      {availability.data ? (
        <MotionReveal style={styles.contentContainer}>
        <Animated.ScrollView
          onScroll={scrollMotion.onScroll}
          scrollEventThrottle={16}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={availability.isRefetching}
              onRefresh={availability.refetch}
              colors={[Colors.navyMid]}
            />
          }
          contentContainerStyle={[styles.content, {paddingBottom: tabBarHeight + Spacing.xxl}]}>
          <View style={styles.statusCard}>
            <View style={styles.statusTop}>
            <View style={styles.statusIcon}>
              <MaterialCommunityIcons
                name={
                  availability.data.isAvailable
                    ? 'briefcase-check-outline'
                    : 'pause-circle-outline'
                }
                size={24}
                color={
                  availability.data.isAvailable
                    ? Colors.success
                    : Colors.warning
                }
              />
            </View>
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>
                {availability.data.isAvailable
                  ? 'Open to new work'
                  : 'New work paused'}
              </Text>
              <Text style={styles.muted}>
                {availability.data.isAvailable
                  ? 'Clients can match with your approved profile.'
                  : 'Existing work stays visible; new matching is paused.'}
              </Text>
            </View>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{disabled: status.isPending}}
              disabled={status.isPending}
              onPress={() => status.mutate(!availability.data.isAvailable)}
              style={styles.toggle}>
              <Text style={styles.toggleText}>
                {status.isPending ? 'Saving…' : availability.data.isAvailable ? 'Pause' : 'Resume'}
              </Text>
            </Pressable>
          </View>
          <View style={styles.todayLine}><MaterialCommunityIcons name="calendar-today" size={20} color={ProColors.primary} /><View style={styles.flex}><Text style={styles.todayLineTitle}>Available today</Text><Text style={styles.muted}>{todaySlots.length ? `${todaySlots.length} ${todaySlots.length === 1 ? 'time slot' : 'time slots'} remaining` : 'No available time left today'}</Text></View></View>
          <Text style={styles.sectionTitle}>Add available time</Text>
          <Text style={styles.sectionHelp}>
            {serviceProvider
              ? 'Choose a time when you can accept a service job.'
              : 'Add a time you can offer for upcoming work.'}
          </Text>
          <View style={styles.presetList}>
            {presets.map(item => (
              <Pressable
                key={item.label}
                accessibilityRole="button"
                accessibilityState={{disabled: create.isPending}}
                disabled={create.isPending}
                onPress={() => create.mutate(item.slot)}
                style={({pressed}) => [
                  styles.preset,
                  pressed && styles.pressed,
                ]}>
                <View style={styles.presetIcon}>
                  <MaterialCommunityIcons
                    name="calendar-plus"
                    size={21}
                    color={Colors.navyDeep}
                  />
                </View>
                <View style={styles.flex}>
                  <Text style={styles.presetTitle}>{item.label}</Text>
                  <Text style={styles.muted}>{item.detail}</Text>
                </View>
                <MaterialCommunityIcons
                  name="plus-circle"
                  size={24}
                  color={Colors.navyDeep}
                />
              </Pressable>
            ))}
          </View>
          <Pressable accessibilityRole="button" accessibilityState={{expanded: customOpen}} onPress={() => setCustomOpen(open => !open)} style={styles.customToggle}>
            <MaterialCommunityIcons name="calendar-edit" size={22} color={ProColors.primary} /><Text style={styles.customToggleText}>Choose another date and time</Text><MaterialCommunityIcons name={customOpen ? 'chevron-up' : 'chevron-down'} size={20} color={ProColors.primary} />
          </Pressable>
          {customOpen ? <View style={styles.customForm}>
            <Text style={styles.customHelp}>Use your device’s local time.</Text>
            <DateTimeField label="Available date" accessibilityLabel="Available date, day month year" mode="date" value={customDate} onChange={setCustomDate} minimumDate={new Date()} />
            <View style={styles.customTimes}>
              <View style={styles.customTimeWrap}><DateTimeField label="Starts at" accessibilityLabel="Start time" mode="time" value={customStart} onChange={setCustomStart} /></View>
              <View style={styles.customTimeWrap}><DateTimeField label="Ends at" accessibilityLabel="End time" mode="time" value={customEnd} onChange={setCustomEnd} /></View>
            </View>
            {customError ? <Text accessibilityRole="alert" style={styles.error}>{customError}</Text> : null}
            <ProButton label="Add available time" loading={create.isPending} loadingLabel="Saving" disabled={create.isPending} onPress={addCustom} />
          </View> : null}
          {error ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {error instanceof ApiError && error.status === 409
                ? 'This time overlaps with another slot or booking. Choose another time.'
                : error instanceof Error
                ? error.message
                : 'Could not update your schedule.'}
            </Text>
          ) : null}
          <View style={styles.slotHeader}>
            <Text style={styles.sectionTitleTight}>Your available times</Text>
            {availability.data.slots.length > 1 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Remove all available times"
                disabled={remove.isPending}
                onPress={() =>
                  void confirmDialog({title: 'Remove all available times?',
                    message: 'Every upcoming slot will be removed. Existing bookings stay untouched.',
                    confirmLabel: 'Remove all', cancelLabel: 'Keep them', destructive: true}).then(async ok => {
                    if (!ok) return;
                    try {
                      for (const slot of availability.data?.slots ?? []) {
                        await api.delete(`/professionals/me/availability/${slot.id}`);
                      }
                      toast('All available times removed.', 'success');
                    } catch {
                      toast('Some slots could not be removed.', 'error');
                    } finally {
                      refresh();
                    }
                  })
                }
                style={styles.clearAll}>
                <Text style={styles.clearAllText}>{remove.isPending ? 'Removing…' : 'Clear all'}</Text>
              </Pressable>
            ) : null}
          </View>
          {availability.data.slots.length ? (
            <View style={styles.slotList}>
              {availability.data.slots.map(slot => (
                <SlotRow
                  key={slot.id}
                  slot={slot}
                  removing={remove.isPending}
                  onRemove={() =>
                    void confirmDialog({title: 'Remove available time?',
                      message: 'This time will no longer be offered for scheduling.',
                      confirmLabel: 'Remove', cancelLabel: 'Keep it', destructive: true}).then(ok => {
                      if (ok) remove.mutate(slot.id);
                    })
                  }
                />
              ))}
            </View>
          ) : (
            <EmptyState
              icon="calendar-clock-outline"
              title="No available times added"
              message="Use one of the choices above to tell clients when you can work."
            />
          )}
        </Animated.ScrollView>
        </MotionReveal>
      ) : null}
      </>
      )}
    </KeyboardAwareView>
  );
}

function SlotRow({
  slot,
  removing,
  onRemove,
}: {
  slot: Slot;
  removing: boolean;
  onRemove: () => void;
}) {
  const start = new Date(slot.startsAt);
  const end = new Date(slot.endsAt);
  return (
    <View style={styles.slot}>
      <View style={styles.dateBox}>
        <Text style={styles.day}>
          {start.toLocaleDateString('en-IN', {day: '2-digit'})}
        </Text>
        <Text style={styles.month}>
          {start.toLocaleDateString('en-IN', {month: 'short'}).toUpperCase()}
        </Text>
      </View>
      <View style={styles.flex}>
        <Text style={styles.slotTitle}>
          {start.toLocaleDateString('en-IN', {weekday: 'long'})}
        </Text>
        <Text style={styles.muted}>
          {start.toLocaleTimeString('en-IN', {
            hour: 'numeric',
            minute: '2-digit',
          })}{' '}
          –{' '}
          {end.toLocaleTimeString('en-IN', {
            hour: 'numeric',
            minute: '2-digit',
          })}
        </Text>
      </View>
      <Pressable
        accessibilityLabel="Remove available time"
        disabled={removing}
        onPress={onRemove}
        style={styles.remove}>
        <MaterialCommunityIcons
          name="trash-can-outline"
          size={21}
          color={Colors.error}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  contentContainer: {flex: 1},
  root: {flex: 1, backgroundColor: Colors.offWhite},
  content: {padding: 20, paddingBottom: Spacing.xxl},
  todayLine: {flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: ProColors.border},
  todayLineTitle: {...ProType.card, color: ProColors.text},
  customToggle: {minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, borderRadius: 12, backgroundColor: ProColors.surface, borderWidth: 1, borderColor: ProColors.border, marginTop: 12},
  customToggleText: {...ProType.action, color: ProColors.primary, flex: 1},
  customForm: {gap: 10, backgroundColor: ProColors.surface, padding: 16, borderRadius: 16, borderWidth: 1, borderColor: ProColors.border, marginTop: 8},
  customHelp: {...ProType.meta, color: ProColors.secondary},
  customTimes: {flexDirection: 'row', gap: 10},
  customTime: {flex: 1},
  customTimeWrap: {flex: 1},
  statusCard: {
    alignItems: 'stretch',
    gap: Spacing.sm,
    padding: 20,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.slate200,
    borderRadius: BorderRadius.lg,
  },
  statusTop: {flexDirection: 'row', alignItems: 'center', gap: Spacing.sm},
  statusIcon: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex: {flex: 1, minWidth: 0},
  cardTitle: {...Typography.h3, color: Colors.slate900},
  muted: {...Typography.caption, color: Colors.slate500, marginTop: 2},
  toggle: {
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.full,
    backgroundColor: ProColors.accent,
  },
  toggleText: {...Typography.button, lineHeight: 22, color: ProColors.onAccent},
  sectionTitle: {
    ...Typography.h2,
    color: Colors.slate900,
    marginTop: Spacing.lg,
  },
  slotHeader: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: Spacing.lg},
  sectionTitleTight: {...Typography.h2, color: Colors.slate900, flex: 1},
  clearAll: {paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.slate200},
  clearAllText: {...Typography.badge, lineHeight: 16, fontWeight: '700', color: Colors.error},
  sectionHelp: {
    ...Typography.body,
    color: Colors.slate600,
    marginTop: Spacing.xs,
  },
  presetList: {gap: Spacing.sm, marginTop: Spacing.md},
  preset: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: 20,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.slate200,
    borderRadius: BorderRadius.lg,
  },
  pressed: {opacity: 0.82},
  presetIcon: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  presetTitle: {...Typography.body, fontWeight: '700', color: Colors.slate800},
  error: {...Typography.body, color: Colors.error, marginTop: Spacing.md},
  slotList: {gap: Spacing.sm, marginTop: Spacing.md},
  slot: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: 20,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.slate200,
    borderRadius: BorderRadius.lg,
  },
  dateBox: {width: 46, alignItems: 'center'},
  day: {...Typography.h2, color: Colors.navyDeep},
  month: {...Typography.badge, lineHeight: 16, color: Colors.navyMid},
  slotTitle: {...Typography.body, color: Colors.slate800, fontWeight: '700'},
  remove: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
