import React from 'react';
import {LiveWorkLocation} from '../components/LiveWorkLocation';
import {
  Pressable,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import LinearGradient from 'react-native-linear-gradient';
import {useQuery} from '@tanstack/react-query';
import {useNavigation} from '@react-navigation/native';
import type {BottomTabNavigationProp} from '@react-navigation/bottom-tabs';
import {useBottomTabBarHeight} from '@react-navigation/bottom-tabs';
import {
  BorderRadius,
  Colors,
  Spacing,
  Typography,
} from '@nahtreek/design-system';
import {ScreenHeader} from '../components/ScreenHeader';
import {useProfessionalDraft} from '../stores/professional';
import {useSessionStore} from '../stores/session';
import {api} from '../services/apiClient';
import {ScreenLoading} from '../components/ScreenLoading';
import {MotionReveal} from '../components/MotionReveal';
import {QuickActions} from '../components/QuickActions';
import type {MainTabParamList} from '../navigation/types';
import {ProColors, ProSpacing, ProType} from '../theme/professionalTheme';
import {ClientAvatar} from '../components/ClientAvatar';

type ProfileState = {
  profile: null | {
    avatarUrl?: string;
    verificationStatus: string;
    isAvailable: boolean;
    serviceCategories?: string[];
    completedJobs?: number;
    rating?: number;
  };
};
type HomeRequest = {
  id: string;
  status: string;
  title: string;
  kind: 'engineering' | 'service';
  clientName?: string;
  clientAvatarUrl?: string;
  clientPlus?: boolean;
  locationAddress?: string;
  createdAt: string;
};
type RequestPage<T> = {data: T[]; meta: {total: number}};
type EngineerRequest = {id: string; status: string; projectTitle: string; clientName?: string; clientAvatarUrl?: string; clientPlus?: boolean; locationAddress?: string; createdAt: string};
type ServiceRequest = {id: string; status: string; category: {title: string}; client?: {fullName: string; avatarUrl?: string | null}; clientPlus?: boolean; locationAddress?: string; createdAt: string};
type Availability = {
  isAvailable: boolean;
  slots: {id: string; startsAt: string; endsAt: string; isAvailable: boolean}[];
};
type ConversationPage = {data: {id: string; unread: number}[]};
type AttentionItem = {
  key: string;
  title: string;
  detail: string;
  action: string;
  icon: string;
  tone: 'warning' | 'error' | 'info';
  onPress: () => void;
};

export function HomeScreen() {
  const tabBarHeight = useBottomTabBarHeight();
  const navigation = useNavigation<BottomTabNavigationProp<MainTabParamList>>();
  const {displayName, city, professionalType} = useProfessionalDraft();
  const user = useSessionStore(state => state.user);
  const roles = user?.roles ?? [];
  const hasEngineer = roles.includes('ENGINEER') || (!roles.length && professionalType === 'CIVIL_ENGINEER');
  const hasService = roles.includes('SERVICE_PROVIDER') || (!roles.length && professionalType !== 'CIVIL_ENGINEER');
  const engineer = hasEngineer;
  const name = user?.fullName || displayName || 'Professional';
  const location = user?.city || city;
  const profile = useQuery({
    queryKey: ['professional-profile'],
    queryFn: () => api.get<ProfileState>('/professionals/me'),
  });
  const requests = useQuery({
    queryKey: [
      'professional-request-summary',
      hasEngineer,
      hasService,
    ],
    queryFn: async () => {
      const [engineering, services] = await Promise.all([
        hasEngineer
          ? api.get<RequestPage<EngineerRequest>>('/engineer-requests?limit=50')
          : Promise.resolve(null),
        hasService
          ? api.get<RequestPage<ServiceRequest>>('/service-requests?limit=50')
          : Promise.resolve(null),
      ]);
      const data: HomeRequest[] = [
        ...(engineering?.data ?? []).map(item => ({
          id: item.id,
          status: item.status,
          title: item.projectTitle,
          kind: 'engineering' as const,
          clientName: item.clientName,
          clientAvatarUrl: item.clientAvatarUrl,
          clientPlus: item.clientPlus,
          locationAddress: item.locationAddress,
          createdAt: item.createdAt,
        })),
        ...(services?.data ?? []).map(item => ({
          id: item.id,
          status: item.status,
          title: item.category.title,
          kind: 'service' as const,
          clientName: item.client?.fullName,
          clientAvatarUrl: item.client?.avatarUrl ?? undefined,
          clientPlus: item.clientPlus,
          locationAddress: item.locationAddress,
          createdAt: item.createdAt,
        })),
      ].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      return {data, meta: {total: (engineering?.meta.total ?? 0) + (services?.meta.total ?? 0)}};
    },
    refetchInterval: 15000,
    refetchIntervalInBackground: false,
  });
  const availability = useQuery({
    queryKey: ['professional-availability'],
    queryFn: () => api.get<Availability>('/professionals/me/availability'),
  });
  const conversations = useQuery({
    queryKey: ['professional-conversations'],
    queryFn: () => api.get<ConversationPage>('/conversations?limit=50'),
    refetchInterval: 15000,
    refetchIntervalInBackground: false,
  });
  const dues = useQuery({
    queryKey: ['pro-dues'],
    queryFn: () => api.get<{duesPaisa: number; blocked: boolean; blockThresholdPaisa: number}>('/payments/dues'),
    retry: 1,
  });
  const unread = conversations.data?.data.reduce((count, item) => count + Math.max(0, item.unread || 0), 0);
  const checkingAttention = profile.isPending || requests.isPending || availability.isPending || conversations.isPending;
  const pending =
    requests.data?.data.filter(item => item.status === 'PENDING').length ?? 0;
  const active =
    requests.data?.data.filter(
      item => item.status === 'ACCEPTED' || item.status === 'IN_PROGRESS',
    ).length ?? 0;
  const serverVerificationStatus = profile.data?.profile?.verificationStatus;
  const verificationStatus = serverVerificationStatus ??
    (profile.data ? 'NOT_SUBMITTED' : user?.verificationStatus ?? 'NOT_SUBMITTED');
  const verified = serverVerificationStatus === 'VERIFIED';
  const workReady = verified && Boolean(availability.data?.isAvailable);
  const statusUnknown = !profile.data && profile.isError;
  const statusChecking = !profile.data && profile.isPending;
  const showQuickActions = verified || statusUnknown || statusChecking;
  const nextSlot = availability.data?.slots
    .filter(slot => slot.isAvailable && Date.parse(slot.startsAt) > Date.now())
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];
  const priorityJobs = [...(requests.data?.data ?? [])]
    .filter(item =>
      ['PENDING', 'ACCEPTED', 'IN_PROGRESS'].includes(item.status),
    )
    .sort(
      (a, b) => Number(b.status === 'PENDING') - Number(a.status === 'PENDING'),
    )
    .slice(0, 3);
  const refresh = () =>
    Promise.all([
      profile.refetch(),
      requests.refetch(),
      availability.refetch(),
      conversations.refetch(),
      dues.refetch(),
    ]);
  // The inbox preview loads 50 jobs; when the server holds more, say so
  // instead of claiming "all caught up" while older requests wait.
  const inboxOverflow = (requests.data?.meta.total ?? 0) > (requests.data?.data.length ?? 0);
  const attention: AttentionItem[] = [];
  if (statusUnknown) {attention.push({key: 'profile-error', title: 'Work status unavailable', detail: 'Refresh to check whether your profile can receive jobs.', action: 'Refresh', icon: 'refresh', tone: 'error', onPress: refresh});}
  if (statusChecking) {attention.push({key: 'profile-checking', title: 'Checking your approval status', detail: 'Nearby-work controls stay off until your current status is confirmed.', action: 'Checking', icon: 'progress-clock', tone: 'info', onPress: () => undefined});}
  if (!statusUnknown && !statusChecking && !verified) {attention.push({key: 'verification', title: verificationStatus === 'UNDER_REVIEW' || verificationStatus === 'PENDING' ? 'Verification under review' : verificationStatus === 'REJECTED' ? 'Verification needs changes' : 'Finish verification', detail: verificationStatus === 'UNDER_REVIEW' || verificationStatus === 'PENDING' ? 'We will notify you when your profile is reviewed.' : 'Your profile needs approval before it can receive eligible work.', action: verificationStatus === 'UNDER_REVIEW' || verificationStatus === 'PENDING' ? 'View submission' : 'Continue verification', icon: 'file-certificate-outline', tone: verificationStatus === 'REJECTED' ? 'error' : 'warning', onPress: () => navigation.navigate('Profile', {screen: verificationStatus === 'UNDER_REVIEW' || verificationStatus === 'PENDING' || verificationStatus === 'REJECTED' ? 'VerificationDocuments' : 'ProfessionalSetup'})});}
  if (pending > 0) {attention.push({key: 'requests', title: `${pending}${inboxOverflow ? '+' : ''} ${pending === 1 && !inboxOverflow ? 'request needs' : 'requests need'} a reply`, detail: 'Review the customer’s work and respond from Jobs.', action: 'Open jobs', icon: 'briefcase-clock-outline', tone: 'warning', onPress: () => navigation.navigate('Requests', {screen: 'RequestInbox'})});}
  if (pending === 0 && inboxOverflow) {attention.push({key: 'inbox-overflow', title: 'More jobs in your inbox', detail: 'Your latest jobs are clear — older ones still wait in Jobs.', action: 'Open jobs', icon: 'briefcase-outline', tone: 'info', onPress: () => navigation.navigate('Requests', {screen: 'RequestInbox'})});}
  if (dues.data && dues.data.duesPaisa > 0) {attention.push({key: 'dues', title: `${(dues.data.duesPaisa / 100).toLocaleString('en-IN', {style: 'currency', currency: 'INR', maximumFractionDigits: 0})} commission dues`, detail: dues.data.blocked ? 'New jobs are paused until dues drop below the limit.' : 'Settle your pay-at-home platform share.', action: 'Settle dues', icon: 'cash-multiple', tone: dues.data.blocked ? 'error' : 'warning', onPress: () => navigation.navigate('Profile', {screen: 'Dues'})});}
  if (verified && availability.data && !availability.data.isAvailable) {attention.push({key: 'paused', title: 'New work is paused', detail: 'Resume availability when you are ready for new requests.', action: 'Change availability', icon: 'pause-circle-outline', tone: 'warning', onPress: () => navigation.navigate('Schedule')});}
  if (unread && unread > 0) {attention.push({key: 'messages', title: `${unread} unread client ${unread === 1 ? 'message' : 'messages'}`, detail: 'A client may be waiting for your answer.', action: 'Open chat', icon: 'message-text-outline', tone: 'info', onPress: () => navigation.navigate('Messages', {screen: 'Conversations'})});}
  if (availability.isError && !availability.data) {attention.push({key: 'availability-error', title: 'Availability could not load', detail: 'Check your available times before taking new work.', action: 'Try again', icon: 'calendar-alert', tone: 'error', onPress: () => {availability.refetch().catch(() => undefined);}});}
  if (conversations.isError && !conversations.data) {attention.push({key: 'messages-error', title: 'Messages could not refresh', detail: 'Open Chat to check for client messages.', action: 'Open chat', icon: 'message-alert-outline', tone: 'info', onPress: () => navigation.navigate('Messages', {screen: 'Conversations'})});}
  const greeting =
    new Date().getHours() < 12
      ? 'Good morning'
      : new Date().getHours() < 17
      ? 'Good afternoon'
      : 'Good evening';
  const serviceCategories = (profile.data?.profile?.serviceCategories ?? [])
    .filter((category): category is string => typeof category === 'string')
    .map(category => category.toLowerCase());
  const offersPainting = serviceCategories.some(category => category.includes('paint'));
  const offersPlumbing = serviceCategories.some(category => category.includes('plumb'));
  const introImage = engineer
    ? require('../assets/professionals/engineer-work-banner-v1.jpg')
    : offersPainting
    ? require('../assets/professionals/painting-job-detail-v1.jpg')
    : offersPlumbing
    ? require('../assets/professionals/plumbing-job-detail-v1.jpg')
    : require('../assets/professionals/service-work-banner-v1.jpg');
  const introImageDescription = engineer
    ? 'Engineer reviewing a home construction site with a contractor'
    : offersPainting
    ? 'Painter preparing an interior wall for a fresh coat of paint'
    : offersPlumbing
    ? 'Plumber repairing a kitchen sink with a customer'
    : 'Service professional completing a home repair';
  const nextStepCard = (
    <View style={styles.introCard}>
      <Image
        source={introImage}
        style={styles.introImage}
        resizeMode="cover"
        accessibilityLabel={introImageDescription}
      />
      <LinearGradient
        colors={['rgba(17, 31, 53,0.02)', 'rgba(17, 31, 53,0.55)', 'rgba(17, 31, 53,0.94)']}
        style={styles.introShade}
      />
      <View style={styles.introCopy}>
        <Text style={styles.introEyebrow}>YOUR NEXT STEP</Text>
        <Text style={styles.introTitle}>
          {statusUnknown
            ? 'Your work status could not load'
            : statusChecking
            ? 'Checking your approval status'
            : !verified
            ? verificationStatus === 'UNDER_REVIEW' || verificationStatus === 'PENDING'
              ? 'Your profile is under review'
              : verificationStatus === 'REJECTED'
              ? 'Update your verification details'
              : 'Get ready to receive work'
            : pending > 0
            ? `${pending} ${pending === 1 ? 'request needs' : 'requests need'} your reply`
            : !workReady
            ? 'Turn on your availability'
            : 'You’re ready for new work'}
        </Text>
        <Text style={styles.introBody}>
          {statusUnknown
            ? 'Check your connection and refresh to see what to do next.'
            : statusChecking
            ? 'We are confirming your approval before showing nearby-work controls.'
            : !verified
            ? verificationStatus === 'UNDER_REVIEW' || verificationStatus === 'PENDING'
              ? 'We’ll let you know when your details are approved.'
              : verificationStatus === 'REJECTED'
              ? 'Review the feedback and send the requested details again.'
              : 'Complete your details and send them for review.'
            : pending > 0
            ? 'Open the job, check the details, then accept or decline.'
            : !workReady
            ? 'Choose when you can work so customers can find you.'
            : 'New jobs will show in Jobs.'}
        </Text>
        <Pressable
          accessibilityRole="button"
          disabled={statusChecking}
          onPress={() => statusUnknown ? refresh() : statusChecking ? undefined : !verified
            ? navigation.navigate('Profile', {screen: verificationStatus === 'UNDER_REVIEW' || verificationStatus === 'PENDING' || verificationStatus === 'REJECTED' ? 'VerificationDocuments' : 'ProfessionalSetup'})
            : pending > 0 ? navigation.navigate('Requests', {screen: 'RequestInbox'}) : !workReady ? navigation.navigate('Schedule') : navigation.navigate('Requests', {screen: 'RequestInbox'})}
          style={({pressed}) => [styles.introButton, pressed && styles.pressed, statusChecking && styles.disabledButton]}>
          <Text style={styles.introButtonText}>
            {statusUnknown ? 'Retry' : statusChecking ? 'Checking…' : !verified ? verificationStatus === 'UNDER_REVIEW' || verificationStatus === 'PENDING' ? 'View review' : verificationStatus === 'REJECTED' ? 'Review changes' : 'Finish setup' : pending > 0 ? 'Review requests' : !workReady ? 'Set availability' : 'View jobs'}
          </Text>
          <MaterialCommunityIcons name="arrow-right" size={18} color={ProColors.onAccent} />
        </Pressable>
      </View>
    </View>
  );

  return (
    <View style={styles.root}>
      <ScreenHeader
        title={`${greeting}, ${name.split(' ')[0]}`}
        subtitle={engineer ? 'Civil Engineer' : 'Service Professional'}
        city={location}
        onCityPress={() => navigation.navigate('Profile', {screen: 'ProfessionalSetup'})}
        onNotificationsPress={() => navigation.navigate('Profile', {screen: 'Notifications'})}
        avatarUrl={profile.data?.profile?.avatarUrl ?? user?.avatarUrl}
        onAvatarPress={() => navigation.navigate('Profile', {screen: 'ProfileOverview'})}
        showBrand
      />
      {profile.isPending && requests.isPending && availability.isPending ? (
        <ScreenLoading label="Getting your work ready…" rows={3} variant="dashboard" />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={
                profile.isRefetching ||
                requests.isRefetching ||
                availability.isRefetching ||
                conversations.isRefetching
              }
              onRefresh={refresh}
              colors={[Colors.navyMid]}
            />
          }
          contentContainerStyle={[styles.content, {paddingBottom: tabBarHeight + ProSpacing.xxl}]}>
          <MotionReveal>{nextStepCard}</MotionReveal>
          {showQuickActions ? (
            <QuickActions
              pending={pending}
              unread={unread}
              onNavigate={route =>
                route === 'Reviews'
                  ? navigation.navigate('Profile', {screen: 'Reviews'})
                  : route === 'Notifications'
                  ? navigation.navigate('Profile', {screen: 'Notifications'})
                  : route === 'Profile'
                  ? navigation.navigate('Profile', {screen: 'ProfileOverview'})
                  : route === 'Requests'
                  ? navigation.navigate('Requests', {screen: 'RequestInbox'})
                  : route === 'Messages'
                  ? navigation.navigate('Messages', {screen: 'Conversations'})
                  : navigation.navigate(route)
              }
            />
          ) : null}
          {showQuickActions ? (
            <>
              <View style={styles.todayHeader}>
                <Text style={styles.todayTitle}>Today</Text>
                <Text style={styles.todayDate}>{new Date().toLocaleDateString('en-IN', {weekday: 'short', day: 'numeric', month: 'short'})}</Text>
              </View>
              <View style={styles.todayStrip}>
                <View style={styles.todayCell}><View style={styles.todayIcon}><MaterialCommunityIcons name="bell-ring-outline" size={18} color={ProColors.primary} /></View><Text style={styles.todayValue}>{requests.data ? pending : '—'}</Text><Text numberOfLines={2} style={styles.todayCaption}>To reply</Text></View>
                <View style={styles.todayCell}><View style={styles.todayIcon}><MaterialCommunityIcons name="briefcase-check-outline" size={18} color={ProColors.primary} /></View><Text style={styles.todayValue}>{requests.data ? active : '—'}</Text><Text numberOfLines={2} style={styles.todayCaption}>Active jobs</Text></View>
                <View style={styles.todayCell}><View style={styles.todayIcon}><MaterialCommunityIcons name="message-text-outline" size={18} color={ProColors.primary} /></View><Text style={styles.todayValue}>{unread ?? '—'}</Text><Text numberOfLines={2} style={styles.todayCaption}>Unread chat</Text></View>
              </View>
            </>
          ) : null}
          <Text style={styles.attentionHeading}>Needs attention</Text>
          {attention.length ? attention.map(item => (
            <Pressable key={item.key} accessibilityRole="button" accessibilityLabel={`${item.title}. ${item.action}`} onPress={item.onPress} style={({pressed}) => [styles.attentionRow, pressed && styles.pressed]}>
              <View style={styles.attentionIcon}>
                <MaterialCommunityIcons name={item.icon} size={22} color={item.tone === 'error' ? ProColors.error : item.tone === 'warning' ? ProColors.accentText : ProColors.primary} />
              </View>
              <View style={styles.flex}><Text style={styles.attentionTitle}>{item.title}</Text><Text style={styles.attentionDetail}>{item.detail}</Text><Text numberOfLines={2} style={styles.attentionAction}>{item.action} →</Text></View>
            </Pressable>
          )) : checkingAttention ? <View style={styles.caughtUp}><MaterialCommunityIcons name="progress-clock" size={21} color={ProColors.primary} /><Text style={styles.caughtUpText}>Checking your latest work updates…</Text></View> : <View style={styles.caughtUp}><MaterialCommunityIcons name="check-circle-outline" size={21} color={ProColors.success} /><Text style={styles.caughtUpText}>You’re all caught up. Your next work update will appear here.</Text></View>}
          {priorityJobs.length ? (
            <>
            <View style={styles.sectionRow}>
              <Text style={styles.sectionTitleFlush}>Priority jobs</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="View all jobs" onPress={() => navigation.navigate('Requests', {screen: 'RequestInbox'})} style={styles.viewAll}>
                <Text style={styles.viewAllText}>View all</Text>
                <MaterialCommunityIcons name="arrow-right" size={16} color={ProColors.primary} />
              </Pressable>
            </View>
              <View style={styles.actions}>
                {priorityJobs.map(job => (
                  <PriorityJobCard
                    key={`${job.kind}:${job.id}`}
                    job={job}
                    onPress={() =>
                      navigation.navigate('Requests', {
                        screen: 'RequestDetail',
                        params: {
                          id: job.id,
                          kind: job.kind,
                        },
                      })
                    }
                  />
                ))}
              </View>
            </>
          ) : null}
          {hasService ? <LiveWorkLocation
            verified={verified}
            verificationStatus={verificationStatus}
            statusUnknown={statusUnknown}
            statusChecking={statusChecking}
            available={availability.data?.isAvailable}
            onManageAvailability={() => navigation.navigate('Schedule')}
          /> : null}
          <MotionReveal>
          {!workReady && !statusUnknown && !statusChecking ? (
            <View style={styles.journeyCard}>
              <Text style={styles.journeyTitle}>{verified ? 'Your next steps' : 'How approval works'}</Text>
              <View style={styles.journeySteps}>
                {(verified
                  ? hasService
                    ? [
                      {icon: 'calendar-check-outline', label: 'Set availability'},
                      {icon: 'map-marker-radius-outline', label: 'Go online'},
                      {icon: 'briefcase-check-outline', label: 'Receive nearby work'},
                    ]
                    : [
                      {icon: 'calendar-check-outline', label: 'Set availability'},
                      {icon: 'account-search-outline', label: 'Appear in search'},
                      {icon: 'briefcase-check-outline', label: 'Reply to requests'},
                    ]
                  : [
                    {icon: 'account-check-outline', label: 'Complete profile'},
                    {icon: 'file-check-outline', label: 'Submit documents'},
                    {icon: 'shield-check-outline', label: 'Get approved'},
                  ]).map((step, index) => (
                  <React.Fragment key={step.label}>
                    {index > 0 ? <MaterialCommunityIcons name="chevron-down" size={16} color={Colors.slate300} style={styles.journeyConnector} /> : null}
                    <View style={styles.journeyStep}>
                      <View style={styles.journeyIcon}><MaterialCommunityIcons name={step.icon} size={22} color={Colors.navyDeep} /></View>
                      <Text style={styles.journeyStepText}>{step.label}</Text>
                    </View>
                  </React.Fragment>
                ))}
              </View>
            </View>
          ) : null}
          </MotionReveal>
          {requests.isError || profile.isError || availability.isError ? (
            <Pressable
              accessibilityRole="button"
              onPress={refresh}
              style={({pressed}) => [styles.errorCard, pressed && styles.pressed]}>
              <Text style={styles.nextTitle}>
                Some work updates could not load
              </Text>
              <Text style={styles.nextText}>
                Pull down or tap here to refresh. Saved updates may be out of
                date.
              </Text>
              <Text style={styles.retryText}>Retry now  →</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            onPress={() => navigation.navigate('Schedule')}
            style={({pressed}) => [styles.availabilityCard, pressed && styles.pressed]}>
            <MaterialCommunityIcons
              name="calendar-clock-outline"
              size={26}
              color={Colors.navyMid}
            />
            <View style={styles.flex}>
              <Text style={styles.nextTitle}>Next available time</Text>
              <Text style={styles.nextText}>
                {nextSlot
                  ? new Date(nextSlot.startsAt).toLocaleString('en-IN', {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                      hour: 'numeric',
                      minute: '2-digit',
                    })
                  : availability.isPending
                  ? 'Loading available times…'
                  : availability.isError
                  ? 'Availability could not load'
                  : 'No upcoming time added'}
              </Text>
            </View>
            <MaterialCommunityIcons
              name="chevron-right"
              size={22}
              color={Colors.navyMid}
            />
          </Pressable>
        </ScrollView>
      )}
    </View>
  );
}

function priorityStatus(status: string): {label: string; pill: string; background: string; color: string} {
  if (status === 'PENDING') {
    return {label: 'REPLY NEEDED', pill: 'REPLY', background: Colors.warningBg, color: Colors.warning};
  }
  if (status === 'IN_PROGRESS') {
    return {label: 'IN PROGRESS', pill: 'ACTIVE', background: Colors.softBlue, color: Colors.navyMid};
  }
  return {label: 'ACCEPTED', pill: 'ACCEPTED', background: Colors.softBlue, color: Colors.navyMid};
}

// Priority job tagline: the client's face plus the most-needed details at a
// glance. Tapping opens the full job with map, chat and actions.
function PriorityJobCard({job, onPress}: {job: HomeRequest; onPress: () => void}) {
  const status = priorityStatus(job.status);
  const date = new Date(job.createdAt);
  const formattedDate = Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('en-IN', {day: 'numeric', month: 'short'});
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${job.title || 'View job details'}. ${status.label}.`}
      onPress={onPress}
      style={({pressed}) => [styles.jobCard, pressed && styles.pressed]}>
      <ClientAvatar name={job.clientName} avatarUrl={job.clientAvatarUrl} size={52} />
      <View style={styles.jobBody}>
        <View style={styles.jobTopRow}>
          <Text style={styles.jobTitle} numberOfLines={1}>
            {job.title || 'View job details'}
          </Text>
          {job.clientPlus ? (
            <View style={styles.jobPlusPill}>
              <Text style={styles.jobPlusPillText}>PLUS</Text>
            </View>
          ) : null}
          <View style={[styles.jobStatusPill, {backgroundColor: status.background}]}>
            <Text style={[styles.jobStatusText, {color: status.color}]} numberOfLines={1}>
              {status.pill}
            </Text>
          </View>
        </View>
        <Text style={styles.jobClient} numberOfLines={1}>
          {job.clientName || 'Customer'}
          {formattedDate ? `  ·  ${formattedDate}` : ''}
        </Text>
        {job.locationAddress ? (
          <View style={styles.jobLocationRow}>
            <MaterialCommunityIcons name="map-marker-outline" size={13} color={Colors.slate500} />
            <Text style={styles.jobLocation} numberOfLines={1}>
              {job.locationAddress}
            </Text>
          </View>
        ) : null}
      </View>
      <MaterialCommunityIcons
        name="chevron-right"
        size={22}
        color={ProColors.muted}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: Colors.offWhite},
  content: {padding: ProSpacing.xl, paddingBottom: Spacing.xxl},
  flex: {flex: 1, minWidth: 0},
  todayHeader: {flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 12},
  todayTitle: {...ProType.screen, color: ProColors.text},
  todayDate: {...ProType.meta, color: ProColors.secondary},
  todayStrip: {flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 6, backgroundColor: ProColors.surface, borderWidth: 1, borderColor: ProColors.border, borderRadius: 16},
  todayCell: {flex: 1, minWidth: 0, alignItems: 'center', gap: 2, paddingHorizontal: 4},
  todayIcon: {width: 30, height: 30, alignItems: 'center', justifyContent: 'center'},
  todayValue: {fontSize: 24, lineHeight: 30, fontWeight: '700', color: ProColors.text},
  todayCaption: {...ProType.meta, color: ProColors.secondary, fontSize: 10, textAlign: 'center', width: '100%'},
  attentionHeading: {...ProType.section, color: ProColors.text, marginTop: 20, marginBottom: 12},
  attentionRow: {flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: ProColors.surface, borderWidth: 1, borderColor: ProColors.border, borderRadius: 16, padding: 16, marginBottom: 8},
  attentionIcon: {width: 42, height: 42, alignItems: 'center', justifyContent: 'center'},
  attentionTitle: {...ProType.card, color: ProColors.text},
  attentionDetail: {...ProType.meta, color: ProColors.secondary, marginTop: 3},
  attentionAction: {...ProType.action, color: ProColors.primary, marginTop: 8},
  caughtUp: {flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 14, paddingHorizontal: 16, backgroundColor: ProColors.surface, borderWidth: 1, borderColor: ProColors.border, borderRadius: 12, marginBottom: 8},
  caughtUpText: {...ProType.meta, color: ProColors.text, flex: 1},
  introCard: {borderRadius: BorderRadius.lg, backgroundColor: Colors.navyDeep, marginBottom: 20, marginTop: 0, overflow: 'hidden', minHeight: 220, justifyContent: 'flex-end'},
  introImage: {position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, width: '100%', height: '100%'},
  introShade: {position: 'absolute', left: 0, right: 0, top: 0, bottom: 0},
  introCopy: {padding: 16, paddingTop: 20},
  introEyebrow: {...Typography.badge, color: ProColors.accent, marginBottom: 6},
  introTitle: {...Typography.h2, color: Colors.white, marginBottom: 6},
  introBody: {...Typography.caption, color: Colors.slate200, lineHeight: 20},
  introButton: {alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: ProColors.accent, borderRadius: 14, paddingHorizontal: 14, minHeight: 52, marginTop: 14},
  introButtonText: {...Typography.button, color: ProColors.onAccent},
  journeyCard: {paddingHorizontal: 16, paddingVertical: 14, borderRadius: BorderRadius.lg, backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.slate200, marginTop: 20},
  journeyTitle: {...Typography.h3, color: Colors.slate900, marginBottom: 4},
  journeySteps: {marginTop: 12},
  journeyConnector: {marginLeft: 15, marginVertical: 2},
  journeyStep: {flexDirection: 'row', alignItems: 'center', gap: 12},
  journeyIcon: {width: 46, height: 46, alignItems: 'center', justifyContent: 'center'},
  journeyStepText: {...Typography.body, color: Colors.slate800, fontWeight: '600', flex: 1},
  retryText: {...Typography.caption, color: Colors.navyMid, fontWeight: '700', marginTop: 8},
  jobCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingLeft: 14,
    paddingRight: 10,
    borderRadius: 16,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.slate200,
  },
  jobBody: {flex: 1, minWidth: 0, gap: 2},
  jobTopRow: {flexDirection: 'row', alignItems: 'center', gap: 6},
  jobTitle: {flex: 1, minWidth: 0, fontSize: 16, lineHeight: 22, fontWeight: '700', color: ProColors.text},
  jobPlusPill: {backgroundColor: ProColors.accentSoft, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3},
  jobPlusPillText: {fontSize: 10, fontWeight: '800', letterSpacing: 0.8, color: ProColors.accentText},
  jobStatusPill: {borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, maxWidth: 120},
  jobStatusText: {fontSize: 11, lineHeight: 15, fontWeight: '700'},
  jobClient: {fontSize: 13, lineHeight: 18, color: ProColors.secondary},
  jobLocationRow: {flexDirection: 'row', alignItems: 'center', gap: 3},
  jobLocation: {...Typography.caption, color: Colors.slate500, flex: 1},
  availabilityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    padding: 20,
    marginTop: 20,
    borderRadius: 16,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.slate200,
  },
  errorCard: {
    padding: 20,
    marginTop: 20,
    borderRadius: 16,
    backgroundColor: Colors.warningBg,
  },
  sectionTitle: {
    ...Typography.h2,
    color: Colors.slate900,
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  sectionTitleFlush: {...Typography.h2, color: Colors.slate900},
  viewAll: {flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 40, paddingLeft: 8},
  viewAllText: {...ProType.action, color: ProColors.primary},
  sectionTitleTop: {marginTop: 0},
  actions: {gap: Spacing.sm},
  pressed: {opacity: 0.78},
  disabledButton: {opacity: 0.65},
  nextTitle: {...Typography.h3, color: Colors.slate900},
  nextText: {...Typography.caption, color: Colors.slate600, marginTop: 3},
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    columnGap: 12,
    justifyContent: 'space-between',
    marginTop: 20,
    marginBottom: 12,
  },
  locationText: {
    ...Typography.caption,
    color: Colors.slate500,
    marginBottom: Spacing.sm,
  },
  glance: {
    minHeight: 118,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.slate200,
  },
  glanceItem: {flex: 1, alignItems: 'center', gap: 4, padding: 8},
  glanceValue: {...Typography.h1, color: Colors.slate900},
  glanceLabel: {
    ...Typography.caption,
    color: Colors.slate500,
    textAlign: 'center',
  },
  divider: {width: 1, height: 54, backgroundColor: Colors.slate200},
});
