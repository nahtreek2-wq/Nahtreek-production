import {ScreenHeader} from '../components/ScreenHeader';
import {CollectPaymentCard} from '../components/CollectPaymentCard';
import React, {useState} from 'react';
import {JourneyPanel} from '../../../../packages/mobile-booking/JourneyPanel';
import {KeyboardAwareView} from '../../../../packages/mobile-ui/KeyboardAwareView';
import {publishCurrentLocation, startJourneyLocationSharing, stopJourneyLocationSharing} from '../services/liveLocation';
import {currentLocation} from '../services/location';
import {
  Animated,
  NativeModules,
  Platform,
  RefreshControl,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import {useNavigation, useRoute} from '@react-navigation/native';
import type {
  NativeStackNavigationProp,
  NativeStackScreenProps,
} from '@react-navigation/native-stack';
import type {BottomTabNavigationProp} from '@react-navigation/bottom-tabs';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {
  BorderRadius,
  Colors,
  Spacing,
  Typography,
} from '@nahtreek/design-system';
import type {
  MainTabParamList,
  RequestsStackParamList,
} from '../navigation/types';
import {api, ApiError} from '../services/apiClient';
import {PrimaryButton} from '../components/PrimaryButton';
import {EmptyState} from '../components/EmptyState';
import {useSessionStore} from '../stores/session';
import {useProToast} from '../stores/proToast';
import {confirmDialog} from '../stores/confirm';
import {ScrollMotionBar, useScrollMotion} from '../components/ScrollMotionBar';
import {JobContextVisual} from '../components/JobContextVisual';
import {ClientAvatar} from '../components/ClientAvatar';
import {ProLoader} from '../components/ProLoader';
import {TravelToJobCard} from '../components/TravelToJobCard';
import {ProIcon} from '../components/ProIcon';
import type {IconTone} from '../components/ProIcon';
import {ProColors, ProRadius, ProType} from '../theme/professionalTheme';

type Props = NativeStackScreenProps<RequestsStackParamList, 'RequestDetail'>;
type Status =
  | 'PENDING'
  | 'ACCEPTED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'DECLINED'
  | 'CANCELLED';
type History = {
  id?: string;
  fromStatus?: Status | null;
  toStatus: Status;
  reason?: string | null;
  createdAt: string;
};
type Detail = {
  journey?: {stage: string} | null;
  id: string;
  title: string;
  description: string;
  clientName?: string;
  clientAvatarUrl?: string;
  clientPlus?: boolean;
  location: string;
  latitude?: number;
  longitude?: number;
  status: Status;
  createdAt: string;
  history: History[];
};
type EngineerRequestDetailResponse = {
  id: string;
  projectTitle: string;
  projectDescription: string;
  clientName?: string;
  clientAvatarUrl?: string;
  clientPlus?: boolean;
  locationAddress: string;
  latitude: number;
  longitude: number;
  status: Status;
  createdAt: string;
  statusHistory?: History[];
};
type ServiceRequestDetailResponse = {
  journey?: {stage: string} | null;
  id: string;
  category?: {title: string} | null;
  description: string;
  clientPlus?: boolean;
  client?: {fullName: string; avatarUrl?: string | null} | null;
  locationAddress: string;
  latitude: number;
  longitude: number;
  status: Status;
  createdAt: string;
  statusHistory?: History[];
};

function statusCopy(status: Status) {
  switch (status) {
    case 'PENDING':
      return {
        label: 'Reply needed',
        icon: 'bell-ring-outline',
        color: Colors.warning,
        background: Colors.warningBg,
        next: 'Read the job and check the place. Accept only if you can do this work.',
      };
    case 'ACCEPTED':
      return {
        label: 'You accepted this job',
        icon: 'handshake-outline',
        color: Colors.navyMid,
        background: Colors.softBlue,
        next: 'Talk to the customer if needed. Tap “Start this job” when you begin work.',
      };
    case 'IN_PROGRESS':
      return {
        label: 'Work has started',
        icon: 'progress-wrench',
        color: Colors.navyMid,
        background: Colors.softBlue,
        next: 'Complete the work. Mark the job as complete only after all agreed work is finished.',
      };
    case 'COMPLETED':
      return {
        label: 'Job finished',
        icon: 'check-circle-outline',
        color: Colors.success,
        background: Colors.successBg,
        next: 'No action is needed. This job is saved in your finished work.',
      };
    default:
      return {
        label: 'Job closed',
        icon: 'archive-outline',
        color: Colors.slate600,
        background: Colors.slate100,
        next: 'No action is needed for this job.',
      };
  }
}

export function RequestDetailScreen() {
  const route = useRoute<Props['route']>();
  const navigation =
    useNavigation<NativeStackNavigationProp<RequestsStackParamList>>();
  const queryClient = useQueryClient();
  const toast = useProToast();
  const {id, kind} = route.params;
  const serviceProvider = useSessionStore(state =>
    state.user?.roles.includes('SERVICE_PROVIDER'),
  );
  // Engineering completion needs the 6-digit code only the customer sees.
  const [codeEntry, setCodeEntry] = useState(false);
  const [code, setCode] = useState('');
  const detail = useQuery({
    queryKey: ['professional-request-detail', kind, id],
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      if (kind === 'engineering') {
        const item = await api.get<EngineerRequestDetailResponse>(`/engineer-requests/${id}`);
        return {
          id: item.id,
          title: item.projectTitle,
          description: item.projectDescription,
          clientName: item.clientName,
          clientAvatarUrl: item.clientAvatarUrl,
          clientPlus: item.clientPlus,
          location: item.locationAddress,
          latitude: item.latitude,
          longitude: item.longitude,
          status: item.status,
          createdAt: item.createdAt,
          history: item.statusHistory ?? [],
        };
      }
      const item = await api.get<ServiceRequestDetailResponse>(`/service-requests/${id}`);
      return {
        journey: item.journey,
        id: item.id,
        title: item.category?.title ?? 'Service request',
        description: item.description,
        clientName: item.client?.fullName,
        clientAvatarUrl: item.client?.avatarUrl ?? undefined,
        clientPlus: item.clientPlus,
        location: item.locationAddress,
        latitude: item.latitude,
        longitude: item.longitude,
        status: item.status,
        createdAt: item.createdAt,
        history: item.statusHistory ?? [],
      };
    },
  });
  const transition = useMutation({
    mutationFn: async (input: {status: Status; code?: string}) => {
      // Engineering start/complete carry best-effort GPS for the audit
      // trail. A missing fix never blocks the action — the completion code
      // is the hard proof, location is supporting evidence.
      let coords: {latitude?: number; longitude?: number} = {};
      if (kind === 'engineering' && (input.status === 'IN_PROGRESS' || input.status === 'COMPLETED')) {
        try {
          const fix = await currentLocation();
          coords = {latitude: fix.latitude, longitude: fix.longitude};
        } catch {
          coords = {};
        }
      }
      return api.patch(
        kind === 'engineering'
          ? `/engineer-requests/${id}/status`
          : `/service-requests/${id}/status`,
        {status: input.status, ...(input.code ? {code: input.code} : {}), ...coords},
      );
    },
    onSuccess: async (_, input) => {
      const status = input.status;
      if (status === 'COMPLETED') {
        setCodeEntry(false);
        setCode('');
      }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['professional-request-detail', kind, id],
        }),
        queryClient.invalidateQueries({queryKey: ['professional-requests']}),
        queryClient.invalidateQueries({
          queryKey: ['professional-request-summary'],
        }),
      ]);
      toast(
        status === 'ACCEPTED'
          ? 'Customer notified that you accepted this job.'
          : status === 'IN_PROGRESS'
          ? 'Job started. Customer notified.'
          : status === 'COMPLETED'
          ? 'Job marked complete. Customer notified.'
          : 'Customer told that you cannot take this job.',
        'success',
      );
      // A declined job leaves nothing to do on this screen — return to the
      // inbox instead of stranding the pro on a dead "no action" box.
      if (status === 'DECLINED') {
        navigation.goBack();
      }
    },
    onError: error => {
      toast(error instanceof Error ? error.message : 'Could not update this job.', 'error');
    },
  });
  const cancelJob = useMutation({
    mutationFn: () => api.patch(`/engineer-requests/${id}/cancel`, {}),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({queryKey: ['professional-request-detail', kind, id]}),
        queryClient.invalidateQueries({queryKey: ['professional-requests']}),
        queryClient.invalidateQueries({queryKey: ['professional-request-summary']}),
      ]);
      toast('Request cancelled. Customer notified.', 'success');
      navigation.goBack();
    },
    onError: error => {
      toast(error instanceof Error ? error.message : 'Could not cancel this job.', 'error');
    },
  });
  const onCancelJob = () => {
    void confirmDialog({title: 'Cancel request', message: 'Cancel this job? The customer will be notified and any payment is refunded automatically.',
      confirmLabel: 'Cancel request', cancelLabel: 'Keep job', destructive: true}).then(ok => {
      if (ok) cancelJob.mutate();
    });
  };
  const conversation = useMutation({
    mutationFn: () =>
      api.post<{id: string; title: string; subtitle: string; otherAvatarUrl?: string}>(
        '/conversations',
        kind === 'engineering'
          ? {engineerRequestId: id}
          : {serviceRequestId: id},
      ),
    onSuccess: created =>
      navigation
        .getParent<BottomTabNavigationProp<MainTabParamList>>()
        ?.navigate('Messages', {
          screen: 'Chat',
          params: {
            conversationId: created.id,
            title: created.title,
            subtitle: created.subtitle,
            avatarUrl: created.otherAvatarUrl,
            requestId: id,
            requestKind: kind,
          },
        }),
    onError: error => {
      toast(error instanceof Error ? error.message : 'Could not open chat.', 'error');
    },
  });

  const changeStatus = (status: Status, label: string) => {
    // Engineering completion is code-gated: the customer holds the 6-digit
    // code, so the engineer collects it in person instead of tapping through.
    if (kind === 'engineering' && status === 'COMPLETED') {
      setCode('');
      setCodeEntry(true);
      return;
    }
    const confirmation =
      status === 'ACCEPTED'
        ? 'The customer will be told that you accepted this job.'
        : status === 'IN_PROGRESS'
        ? 'Use this only when you have started the work.'
        : status === 'COMPLETED'
        ? 'Use this only after all agreed work is finished.'
        : 'The customer will be told that you cannot take this job.';
    void confirmDialog({title: label, message: confirmation, confirmLabel: label, cancelLabel: 'Not now',
      destructive: status === 'DECLINED'}).then(ok => {
      if (ok) transition.mutate({status});
    });
  };
  const confirmCompletion = () => {
    const trimmed = code.trim();
    if (trimmed.length !== 6) {
      toast('Enter the 6-digit code from the customer.', 'error');
      return;
    }
    transition.mutate({status: 'COMPLETED', code: trimmed});
  };
  const openMap = (request: Detail) => {
    navigation.navigate('MapPreview', {
      latitude: request.latitude,
      longitude: request.longitude,
      address: request.location,
      title: request.title,
      clientName: request.clientName,
    });
  };

  return (
    <KeyboardAwareView style={styles.root}>
      <ScreenHeader
        title={serviceProvider ? 'Service job' : 'Job details'}
        subtitle={
          kind === 'engineering' ? 'Engineering job' : 'Follow each step below'
        }
        onBack={() => navigation.goBack()}
      />
      {detail.isPending ? (
        <View style={styles.center}>
          <ProLoader size={52} label="Loading request…" />
        </View>
      ) : null}
      {detail.isError ? (
        <View style={styles.errorWrap}>
          <EmptyState
            icon="cloud-off-outline"
            title="Request could not load"
            message={
              detail.error instanceof ApiError
                ? detail.error.message
                : 'Check your connection and try again.'
            }
          />
          <PrimaryButton label="Try again" onPress={() => detail.refetch()} />
        </View>
      ) : null}
      {detail.data ? (
        <RequestContent
          request={detail.data}
          busy={transition.isPending}
          messaging={conversation.isPending}
          actionError={
            (transition.error ?? conversation.error) instanceof Error
              ? (transition.error ?? (conversation.error as Error)).message
              : ''
          }
          onMap={() => openMap(detail.data)}
          onMessage={() => conversation.mutate()}
          onTransition={changeStatus}
          onCancelJob={onCancelJob}
          cancelling={cancelJob.isPending}
          serviceProvider={Boolean(serviceProvider && kind === 'service')}
          kind={kind}
          onViewDues={() =>
            navigation
              .getParent<BottomTabNavigationProp<MainTabParamList>>()
              ?.navigate('Profile', {screen: 'Dues'})
          }
          onShowQr={() =>
            navigation
              .getParent<BottomTabNavigationProp<MainTabParamList>>()
              ?.navigate('Profile', {screen: 'MyQr'})
          }
          onBackToJobs={() => navigation.goBack()}
          codeEntry={kind === 'engineering' && codeEntry}
          code={code}
          onCodeChange={setCode}
          onConfirmCode={confirmCompletion}
          onCancelCode={() => {
            setCodeEntry(false);
            setCode('');
          }}
          refreshing={detail.isRefetching}
          onRefresh={() => void detail.refetch()}
        />
      ) : null}
    </KeyboardAwareView>
  );
}

function RequestContent({
  request,
  busy,
  messaging,
  actionError,
  onMap,
  onMessage,
  onTransition,
  onCancelJob,
  cancelling,
  serviceProvider,
  kind,
  onViewDues,
  onShowQr,
  onBackToJobs,
  codeEntry,
  code,
  onCodeChange,
  onConfirmCode,
  onCancelCode,
  refreshing,
  onRefresh,
}: {
  request: Detail;
  busy: boolean;
  messaging: boolean;
  actionError: string;
  onMap: () => void;
  onMessage: () => void;
  onTransition: (status: Status, label: string) => void;
  onCancelJob: () => void;
  cancelling: boolean;
  serviceProvider: boolean;
  kind: 'engineering' | 'service';
  onViewDues: () => void;
  onShowQr: () => void;
  onBackToJobs: () => void;
  codeEntry: boolean;
  code: string;
  onCodeChange: (value: string) => void;
  onConfirmCode: () => void;
  onCancelCode: () => void;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const scrollMotion = useScrollMotion();
  const primary =
    request.status === 'PENDING'
      ? {
          status: 'ACCEPTED' as const,
          label: serviceProvider
            ? 'Yes, I can do this work'
            : 'Accept this job',
        }
      : request.status === 'ACCEPTED'
      ? {
          status: 'IN_PROGRESS' as const,
          label: serviceProvider ? 'I have started the work' : 'Start this job',
        }
      : request.status === 'IN_PROGRESS'
      ? {
          status: 'COMPLETED' as const,
          label: serviceProvider
            ? 'Mark service as complete'
            : 'Mark job as complete',
        }
      : null;
  const status = serviceProvider
    ? serviceStatusCopy(request.status)
    : statusCopy(request.status);
  // Travel mode: the address must stay one glance away while going to the
  // job. Accepted jobs always travel; engineering in-progress keeps the
  // card (navigate back, second visit), while a service journey past
  // arrival already has its own panel and map.
  const showTravel =
    request.status === 'ACCEPTED' ||
    (request.status === 'IN_PROGRESS' && (kind === 'engineering' || !request.journey));
  return (
    <View style={styles.flex}>
    <ScrollMotionBar offset={scrollMotion.offset} reducedMotion={scrollMotion.reducedMotion} />
    <Animated.ScrollView onScroll={scrollMotion.onScroll} scrollEventThrottle={16} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={ProColors.primary}
          colors={[ProColors.primary]}
        />
      }>
      <View style={styles.jobOverview}>
        <JobContextVisual kind={serviceProvider ? 'service' : 'engineering'} title={request.title} seed={request.id} size={64} />
        <View style={styles.flex}>
          <Text style={styles.jobEyebrow}>{serviceProvider ? 'SERVICE JOB' : 'ENGINEERING REQUEST'}</Text>
          <Text style={styles.jobHeading}>{request.title}</Text>
          <View style={styles.jobClientRow}>
            <ClientAvatar name={request.clientName} avatarUrl={request.clientAvatarUrl} size={22} />
            <Text style={styles.jobMeta} numberOfLines={1}>{request.clientName || 'Customer'}</Text>
            {request.clientPlus ? (
              <View style={styles.plusPill}>
                <Text style={styles.plusPillText}>PLUS</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.jobLocation} numberOfLines={2}>{request.location || 'Location not provided'}</Text>
        </View>
      </View>
      {showTravel ? (
        <TravelToJobCard
          title={request.title}
          clientName={request.clientName}
          clientAvatarUrl={request.clientAvatarUrl}
          address={request.location}
          latitude={request.latitude}
          longitude={request.longitude}
          onMap={onMap}
        />
      ) : null}
      {request.journey ? (
        <JourneyPanel
          id={request.id}
          client={false}
          clientPlus={request.clientPlus}
          load={() => api.get(`/service-workflow/${request.id}`)}
          act={async body => {
            const result = await api.post(`/service-workflow/${request.id}/actions`, body);
            if (body.action === 'ARRIVE' && Platform.OS === 'android') {
              try {
                await stopJourneyLocationSharing();
              } catch {
                NativeModules.NahtreekRuntimeConfig.stopLiveLocation().catch(() => undefined);
              }
            }
            return result;
          }}
          beforeAction={async action => {
            if (['ACCEPT', 'DEPART', 'ARRIVE'].includes(action)) {
              try {
                if (action === 'DEPART') {
                  await startJourneyLocationSharing(useSessionStore.getState().accessToken);
                } else {
                  await publishCurrentLocation(true);
                }
              } catch (error) {
                const reason =
                  error instanceof Error
                    ? error.message
                    : 'Check location permission and device location settings.';
                throw Object.assign(
                  new Error(
                    `Location could not be updated, so this job action was not sent. ${reason}`,
                  ),
                  {kind: 'prerequisite'},
                );
              }
            }
          }}
        />
      ) : null}
      {!request.journey ? (
        <View style={[styles.nextStep, {backgroundColor: status.background}]}>
          <View style={styles.nextIcon}>
            <MaterialCommunityIcons
              name={status.icon}
              size={28}
              color={status.color}
            />
          </View>
          <View style={styles.flex}>
            <Text style={[styles.nextLabel, {color: status.color}]}>
              {status.label}
            </Text>
            <Text style={styles.nextText}>{status.next}</Text>
          </View>
        </View>
      ) : null}
      {serviceProvider && !request.journey ? (
        <ServiceProgress status={request.status} />
      ) : null}
      <Section title="What the customer needs" icon="clipboard-text" tone="blue">
        <Text style={styles.body}>{request.description}</Text>
      </Section>
      {!showTravel ? (
      <Section title="Where to go" icon="map-marker" tone="navy">
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`View ${request.location} on map`}
          onPress={onMap}
          style={styles.mapRow}>
          <MaterialCommunityIcons
            name="map-marker"
            size={24}
            color={Colors.navyMid}
          />
          <Text style={styles.mapText}>{request.location}</Text>
          <MaterialCommunityIcons
            name="open-in-new"
            size={20}
            color={Colors.navyMid}
          />
        </Pressable>
        <Text style={styles.mapHint}>
          Tap above to view the map and get directions
        </Text>
      </Section>
      ) : null}
      {actionError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {actionError}
        </Text>
      ) : null}
      {kind === 'engineering' &&
      ['IN_PROGRESS', 'COMPLETED'].includes(request.status) ? (
        <CollectPaymentCard requestId={request.id} onViewDues={onViewDues} />
      ) : null}
      {codeEntry ? (
        <View style={styles.codeCard}>
          <View style={styles.sectionHeading}>
            <ProIcon name="key-variant" tone="navy" size={42} iconSize={23} />
            <Text style={styles.codeTitle}>Enter the completion code</Text>
          </View>
          <Text style={styles.codeHint}>
            Ask the customer for the 6-digit code shown in their request. The job completes only with their code.
          </Text>
          <TextInput
            accessibilityLabel="6-digit completion code"
            style={styles.codeInput}
            placeholder="123456"
            placeholderTextColor={ProColors.muted}
            keyboardType="number-pad"
            maxLength={6}
            value={code}
            onChangeText={onCodeChange}
            editable={!busy}
          />
          <View style={styles.codeRow}>
            <PrimaryButton label={busy ? 'Completing…' : 'Complete job'} loading={busy} onPress={onConfirmCode} />
            <Pressable accessibilityRole="button" disabled={busy} onPress={onCancelCode} style={styles.decline}>
              <Text style={styles.declineText}>Not now</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      {!request.journey &&
        (primary ? (
          <View style={styles.actions}>
            <PrimaryButton
              label={primary.label}
              loading={busy}
              onPress={() => onTransition(primary.status, primary.label)}
            />
            {request.status === 'PENDING' ? (
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => onTransition('DECLINED', 'I cannot do this job')}
                style={styles.decline}>
                <Text style={styles.declineText}>I cannot do this job</Text>
              </Pressable>
            ) : null}
            {kind === 'engineering' && request.status === 'ACCEPTED' ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel this job"
                disabled={busy || cancelling}
                onPress={onCancelJob}
                style={styles.decline}>
                <Text style={styles.declineText}>{cancelling ? 'Cancelling…' : 'Cancel this job'}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <View style={styles.closed}>
            <MaterialCommunityIcons
              name={
                request.status === 'COMPLETED'
                  ? 'check-circle-outline'
                  : 'archive-outline'
              }
              size={24}
              color={
                request.status === 'COMPLETED'
                  ? Colors.success
                  : Colors.slate500
              }
            />
            <Text style={styles.closedText}>
              No action is needed for this job.
            </Text>
            {request.status === 'COMPLETED' && serviceProvider ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Show my QR code" onPress={onShowQr} style={styles.closedAction}>
                <Text style={styles.closedActionText}>Show my QR</Text>
              </Pressable>
            ) : (
              <Pressable accessibilityRole="button" accessibilityLabel="Back to jobs" onPress={onBackToJobs} style={styles.closedAction}>
                <Text style={styles.closedActionText}>Back to jobs</Text>
              </Pressable>
            )}
          </View>
        ))}
      {['PENDING', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED'].includes(request.status) ? (
        <Pressable
          accessibilityRole="button"
          disabled={messaging}
          onPress={onMessage}
          style={styles.messageButton}>
          <MaterialCommunityIcons
            name="message-text-outline"
            size={23}
            color={Colors.navyMid}
          />
          <Text style={styles.messageButtonText}>
            {messaging
              ? 'Opening chat…'
              : serviceProvider
              ? 'Ask the customer'
              : 'Chat with customer'}
          </Text>
        </Pressable>
      ) : null}
      <Section title="Job updates" icon="timeline-text" tone="slate">
        <View style={styles.timeline}>
          {request.history.length ? (
            request.history.map((item, index) => (
              <View
                key={item.id ?? `${item.toStatus}-${index}`}
                style={styles.timelineRow}>
                <View style={styles.timelineMarker}>
                  <View style={styles.timelineDot} />
                  {index < request.history.length - 1 ? (
                    <View style={styles.timelineLine} />
                  ) : null}
                </View>
                <View style={styles.flex}>
                  <Text style={styles.timelineTitle}>
                    {statusCopy(item.toStatus).label}
                  </Text>
                  <Text style={styles.muted}>
                    {new Date(item.createdAt).toLocaleString('en-IN')}
                  </Text>
                  {item.reason ? (
                    <Text style={styles.reason}>{item.reason}</Text>
                  ) : null}
                </View>
              </View>
            ))
          ) : (
            <Text style={styles.muted}>No updates yet.</Text>
          )}
        </View>
      </Section>
    </Animated.ScrollView>
    </View>
  );
}

function serviceStatusCopy(status: Status) {
  switch (status) {
    case 'PENDING':
      return {
        label: 'Customer is waiting for your reply',
        icon: 'bell-ring-outline',
        color: Colors.warning,
        background: Colors.warningBg,
        next: 'Read what is needed and check the area. Tap the yellow button only if you can do the work.',
      };
    case 'ACCEPTED':
      return {
        label: 'You agreed to do this work',
        icon: 'map-marker-path',
        color: Colors.navyMid,
        background: Colors.softBlue,
        next: 'Use the map for directions. Ask the customer if you need help finding the home.',
      };
    case 'IN_PROGRESS':
      return {
        label: 'You are doing this work now',
        icon: 'tools',
        color: Colors.navyMid,
        background: Colors.softBlue,
        next: 'Finish the agreed service safely. Mark it finished only when the work is complete.',
      };
    case 'COMPLETED':
      return {
        label: 'Service work finished',
        icon: 'check-circle-outline',
        color: Colors.success,
        background: Colors.successBg,
        next: 'This completed service is saved in your work history.',
      };
    default:
      return statusCopy(status);
  }
}

function ServiceProgress({status}: {status: Status}) {
  const current =
    status === 'PENDING'
      ? 0
      : status === 'ACCEPTED'
      ? 1
      : status === 'IN_PROGRESS'
      ? 2
      : status === 'COMPLETED'
      ? 3
      : -1;
  if (current < 0) {
    return null;
  }
  const steps = [
    {label: 'Reply', icon: 'gesture-tap-button'},
    {label: 'Go', icon: 'map-marker-path'},
    {label: 'Work', icon: 'tools'},
    {label: 'Finish', icon: 'check-bold'},
  ];
  return (
    <View style={styles.serviceProgress}>
      <Text style={styles.progressHeading}>YOUR 4 SIMPLE STEPS</Text>
      <View style={styles.progressRow}>
        {steps.map((step, index) => {
          const done = index <= current;
          return (
            <React.Fragment key={step.label}>
              <View style={styles.progressStep}>
                <View
                  style={[
                    styles.progressIcon,
                    done && styles.progressIconDone,
                  ]}>
                  <MaterialCommunityIcons
                    name={step.icon}
                    size={20}
                    color={done ? Colors.navyDeep : Colors.slate400}
                  />
                </View>
                <Text
                  style={[
                    styles.progressLabel,
                    done && styles.progressLabelDone,
                  ]}>
                  {step.label}
                </Text>
              </View>
              {index < steps.length - 1 ? (
                <View
                  style={[
                    styles.progressLine,
                    index < current && styles.progressLineDone,
                  ]}
                />
              ) : null}
            </React.Fragment>
          );
        })}
      </View>
    </View>
  );
}

function Section({title, icon, tone = 'navy', children}: React.PropsWithChildren<{title: string; icon: string; tone?: IconTone}>) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeading}>
        <ProIcon name={icon} tone={tone} size={38} iconSize={20} />
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: Colors.offWhite},
  header: {
    minHeight: 92,
    paddingTop: Spacing.lg,
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.navyDeep,
  },
  back: {width: 44, height: 44, alignItems: 'center', justifyContent: 'center'},
  headerCopy: {flex: 1},
  headerTitle: {...Typography.h2, color: Colors.white},
  headerSubtitle: {...Typography.caption, color: Colors.slate300, marginTop: 2},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  errorWrap: {
    flex: 1,
    gap: Spacing.md,
    padding: 20,
    justifyContent: 'center',
  },
  content: {padding: 20, paddingBottom: Spacing.xxl},
  jobOverview: {flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 16, marginBottom: 16, borderBottomWidth: 1, borderBottomColor: ProColors.border},
  jobEyebrow: {...ProType.eyebrow, color: ProColors.secondary},
  jobHeading: {...ProType.section, color: ProColors.text, marginTop: 3},
  jobClientRow: {flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 7},
  jobMeta: {...ProType.meta, color: ProColors.secondary, fontWeight: '600', flexShrink: 1},
  jobLocation: {...ProType.meta, color: ProColors.secondary, marginTop: 4},
  plusPill: {backgroundColor: ProColors.accentSoft, borderRadius: ProRadius.pill,
    paddingHorizontal: 8, paddingVertical: 3},
  plusPillText: {fontSize: 10, fontWeight: '800', letterSpacing: 0.8, color: ProColors.accentText},
  nextStep: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
    padding: 20,
    borderRadius: BorderRadius.lg,
    marginBottom: Spacing.lg,
  },
  nextIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.white,
  },
  nextLabel: {...Typography.h3},
  nextText: {...Typography.body, color: Colors.slate700, marginTop: Spacing.xs},
  serviceProgress: {
    padding: 20,
    marginBottom: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.slate200,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.white,
  },
  progressHeading: {
    ...Typography.badge,
    lineHeight: 16,
    color: Colors.slate500,
    marginBottom: Spacing.md,
  },
  progressRow: {flexDirection: 'row', alignItems: 'flex-start'},
  progressStep: {flex: 1, alignItems: 'center'},
  progressIcon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: Colors.slate100,
  },
  progressIconDone: {backgroundColor: Colors.success},
  progressLabel: {
    ...Typography.badge,
    lineHeight: 16,
    color: Colors.slate400,
    marginTop: Spacing.xs,
  },
  progressLabelDone: {color: Colors.navyDeep},
  progressLine: {
    flex: 1,
    height: 3,
    marginTop: 19,
    borderRadius: 2,
    backgroundColor: Colors.slate200,
  },
  progressLineDone: {backgroundColor: Colors.success},
  titleRow: {flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start'},
  flex: {flex: 1, minWidth: 0},
  title: {...Typography.h1, color: Colors.slate900},
  clientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.sm,
  },
  client: {...Typography.body, color: Colors.slate600, flex: 1},
  section: {
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.slate200,
    borderRadius: BorderRadius.lg,
    padding: 20,
    marginTop: Spacing.lg,
  },
  sectionHeading: {flexDirection: 'row', alignItems: 'center', gap: Spacing.sm},
  sectionTitle: {
    ...Typography.h3,
    color: Colors.slate900,
    flex: 1,
  },
  sectionBody: {marginTop: Spacing.md},
  body: {...Typography.body, color: Colors.slate700},
  mapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: 48,
  },
  mapText: {
    ...Typography.body,
    color: Colors.navyMid,
    flex: 1,
    fontWeight: '600',
  },
  mapHint: {...Typography.caption, color: Colors.slate500, marginLeft: 32},
  timeline: {gap: Spacing.xs},
  timelineRow: {flexDirection: 'row', gap: Spacing.sm, minHeight: 52},
  timelineMarker: {width: 16, alignItems: 'center'},
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.navyMid,
    marginTop: 4,
  },
  timelineLine: {
    width: 2,
    flex: 1,
    backgroundColor: Colors.slate200,
    marginVertical: 3,
  },
  timelineTitle: {
    ...Typography.body,
    color: Colors.slate800,
    fontWeight: '700',
  },
  muted: {...Typography.caption, color: Colors.slate500, marginTop: Spacing.xs},
  reason: {...Typography.caption, color: Colors.slate600, marginTop: 2},
  actions: {gap: Spacing.sm, marginTop: Spacing.lg},
  codeCard: {gap: Spacing.sm, marginTop: Spacing.lg, padding: Spacing.lg, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: ProColors.border, backgroundColor: Colors.white},
  codeTitle: {...ProType.card, color: Colors.navyMid, flex: 1},
  codeHint: {...Typography.body, color: Colors.slate600},
  codeInput: {minHeight: 56, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: ProColors.border,
    paddingHorizontal: Spacing.md, textAlign: 'center', ...Typography.h2, letterSpacing: 6, color: Colors.navyMid},
  codeRow: {gap: Spacing.xs},
  decline: {minHeight: 48, alignItems: 'center', justifyContent: 'center'},
  declineText: {...Typography.button, lineHeight: 22, color: Colors.error},
  error: {...Typography.body, color: Colors.error, marginTop: Spacing.md},
  closed: {
    marginTop: Spacing.lg,
    padding: 20,
    gap: Spacing.sm,
    backgroundColor: Colors.white,
    borderRadius: BorderRadius.md,
  },
  closedText: {...Typography.body, color: Colors.slate600},
  closedAction: {
    alignSelf: 'flex-start',
    marginTop: Spacing.xs,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.navyDeep,
  },
  closedActionText: {...Typography.button, lineHeight: 22, color: Colors.white},
  messageButton: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.navyMid,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.white,
  },
  messageButtonText: {
    ...Typography.button,
    lineHeight: 22,
    color: Colors.navyMid,
    flexShrink: 1,
    textAlign: 'center',
  },
});
