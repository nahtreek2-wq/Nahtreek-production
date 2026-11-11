import React, {useMemo, useState} from 'react';
import {
  Animated,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import {useInfiniteQuery, useQuery} from '@tanstack/react-query';
import {
  BorderRadius,
  Colors,
  Spacing,
  Typography,
} from '@nahtreek/design-system';
import {ScreenHeader} from '../components/ScreenHeader';
import {ProLoader} from '../components/ProLoader';
import {EmptyState} from '../components/EmptyState';
import {VerificationGate} from '../components/VerificationGate';
import {api} from '../services/apiClient';
import {useSessionStore} from '../stores/session';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {BottomTabNavigationProp} from '@react-navigation/bottom-tabs';
import {useBottomTabBarHeight} from '@react-navigation/bottom-tabs';
import type {MainTabParamList, RequestsStackParamList} from '../navigation/types';
import {ScreenLoading} from '../components/ScreenLoading';
import {MotionReveal} from '../components/MotionReveal';
import {ScrollMotionBar, useScrollMotion} from '../components/ScrollMotionBar';
import {ClientAvatar} from '../components/ClientAvatar';
import {ProColors, ProRadius, ProSpacing} from '../theme/professionalTheme';
import {nextCombinedPage, type PageMeta} from '../services/pagination';

type RequestStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'DECLINED'
  | 'CANCELLED';
type WorkRequest = {
  id: string;
  title: string;
  description: string;
  clientName?: string;
  clientAvatarUrl?: string;
  clientPlus?: boolean;
  location: string;
  status: RequestStatus;
  createdAt: string;
  kind: 'engineering' | 'service';
};
type Page<T> = {data: T[]; meta: PageMeta & {total: number}};
type EngineerResponse = {
  id: string;
  projectTitle: string;
  projectDescription: string;
  clientName?: string;
  clientAvatarUrl?: string;
  clientPlus?: boolean;
  locationAddress: string;
  status: RequestStatus;
  createdAt: string;
};
type ServiceResponse = {
  id: string;
  description: string;
  locationAddress: string;
  status: RequestStatus;
  createdAt: string;
  category: {title: string};
  clientPlus?: boolean;
  client: {fullName: string; avatarUrl?: string | null};
};
type Filter = 'ALL' | 'NEW' | 'ACTIVE' | 'COMPLETED';

function filters(
  engineer: boolean,
): Record<Filter, {label: string; hint: string; icon: string}> {
  return {
    ALL: {
      label: engineer ? 'All jobs' : 'All service jobs',
      hint: 'Everything',
      icon: engineer ? 'briefcase-outline' : 'toolbox-outline',
    },
    NEW: {label: 'Reply now', hint: 'New work', icon: 'bell-ring-outline'},
    ACTIVE: {
      label: engineer ? 'In progress' : 'Active work',
      hint: 'Ongoing',
      icon: engineer ? 'progress-clock' : 'tools',
    },
    COMPLETED: {
      label: 'Finished',
      hint: 'Past work',
      icon: 'check-circle-outline',
    },
  };
}

function matchesFilter(request: WorkRequest, filter: Filter) {
  if (filter === 'NEW') {
    return request.status === 'PENDING';
  }
  if (filter === 'ACTIVE') {
    return request.status === 'ACCEPTED' || request.status === 'IN_PROGRESS';
  }
  if (filter === 'COMPLETED') {
    return request.status === 'COMPLETED';
  }
  return true;
}

function statusDetails(status: RequestStatus, service = false) {
  // label/action stay verbose for screen readers; pill is the short tagline
  // chip so the job title keeps its room on narrow phones.
  switch (status) {
    case 'PENDING':
      return {
        label: 'Reply needed',
        pill: 'REPLY',
        action: service ? 'See work and reply' : 'Check and reply',
        icon: 'bell-ring-outline',
        background: Colors.warningBg,
        color: Colors.warning,
      };
    case 'ACCEPTED':
      return {
        label: 'Job accepted',
        pill: 'ACCEPTED',
        action: service ? 'Continue job' : 'See accepted job',
        icon: 'handshake-outline',
        background: Colors.softBlue,
        color: Colors.navyMid,
      };
    case 'IN_PROGRESS':
      return {
        label: 'Work started',
        pill: 'ACTIVE',
        action: service ? 'Continue service work' : 'Continue this job',
        icon: 'progress-wrench',
        background: Colors.softBlue,
        color: Colors.navyMid,
      };
    case 'COMPLETED':
      return {
        label: 'Finished',
        pill: 'DONE',
        action: 'View completed job',
        icon: 'check-circle-outline',
        background: Colors.successBg,
        color: Colors.success,
      };
    default:
      return {
        label: 'Closed',
        pill: 'CLOSED',
        action: 'View job details',
        icon: 'archive-outline',
        background: Colors.slate100,
        color: Colors.slate600,
      };
  }
}

export function RequestsScreen() {
  const tabBarHeight = useBottomTabBarHeight();
  const scrollMotion = useScrollMotion();
  const navigation =
    useNavigation<NativeStackNavigationProp<RequestsStackParamList>>();
  const tabs = navigation.getParent<BottomTabNavigationProp<MainTabParamList>>();
  const roles = useSessionStore(state => state.user?.roles ?? []);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [oldestFirst, setOldestFirst] = useState(false);
  const hasEngineer = roles.includes('ENGINEER');
  const hasService = roles.includes('SERVICE_PROVIDER');
  const engineer = hasEngineer && !hasService;
  const filterDetails = useMemo(() => filters(engineer), [engineer]);
  const requests = useInfiniteQuery({
    queryKey: ['professional-requests', hasEngineer, hasService],
    initialPageParam: 1,
    refetchInterval: 15000,
    queryFn: async ({pageParam}) => {
      const [engineering, services] = await Promise.all([
        hasEngineer
          ? api.get<Page<EngineerResponse>>(`/engineer-requests?limit=50&page=${pageParam}`)
          : Promise.resolve(null),
        hasService
          ? api.get<Page<ServiceResponse>>(`/service-requests?limit=50&page=${pageParam}`)
          : Promise.resolve(null),
      ]);
      const engineeringJobs = (engineering?.data ?? []).map<WorkRequest>(
        item => ({
          id: item.id,
          title: item.projectTitle,
          description: item.projectDescription,
          clientName: item.clientName,
          clientAvatarUrl: item.clientAvatarUrl,
          clientPlus: item.clientPlus,
          location: item.locationAddress,
          status: item.status,
          createdAt: item.createdAt,
          kind: 'engineering',
        }),
      );
      const serviceJobs = (services?.data ?? []).map<WorkRequest>(item => ({
        id: item.id,
        title: item.category.title,
        description: item.description,
        clientName: item.client.fullName,
        clientAvatarUrl: item.client.avatarUrl ?? undefined,
        clientPlus: item.clientPlus,
        location: item.locationAddress,
        status: item.status,
        createdAt: item.createdAt,
        kind: 'service',
      }));
      return {
        page: pageParam,
        jobs: [...engineeringJobs, ...serviceJobs],
        engineerMeta: engineering?.meta,
        serviceMeta: services?.meta,
      };
    },
    getNextPageParam: lastPage => nextCombinedPage(
      lastPage.page,
      lastPage.engineerMeta,
      lastPage.serviceMeta,
    ),
  });
  const allRequests = useMemo(() => {
    const unique = new Map<string, WorkRequest>();
    requests.data?.pages.forEach(page => page.jobs.forEach(item => {
      unique.set(`${item.kind}:${item.id}`, item);
    }));
    return [...unique.values()].sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
    );
  }, [requests.data]);
  const visible = useMemo(
    () => {
      const items = allRequests.filter(item => matchesFilter(item, filter));
      return oldestFirst ? [...items].reverse() : items;
    },
    [allRequests, filter, oldestFirst],
  );
  const counts = useMemo(
    () => ({
      ALL: allRequests.length,
      NEW: allRequests.filter(item => matchesFilter(item, 'NEW')).length,
      ACTIVE: allRequests.filter(item => matchesFilter(item, 'ACTIVE')).length,
      COMPLETED: allRequests.filter(item => matchesFilter(item, 'COMPLETED'))
        .length,
    }),
    [allRequests],
  );
  const profile = useQuery({
    queryKey: ['professional-profile'],
    queryFn: () => api.get<{profile: {verificationStatus: string} | null}>('/professionals/me'),
  });
  const verificationStatus = profile.data?.profile?.verificationStatus;
  const locked = Boolean(profile.data) && verificationStatus !== 'VERIFIED';
  const underReview = verificationStatus === 'UNDER_REVIEW' || verificationStatus === 'PENDING';
  const goVerify = () =>
    tabs?.navigate('Profile', {
      screen:
        verificationStatus === 'UNDER_REVIEW' ||
        verificationStatus === 'PENDING' ||
        verificationStatus === 'REJECTED'
          ? 'VerificationDocuments'
          : 'ProfessionalSetup',
    });

  return (
    <View style={styles.root}>
      <ScreenHeader
        title="Jobs"
        subtitle={requests.data ? counts.NEW ? `${counts.NEW} ${counts.NEW === 1 ? 'request needs' : 'requests need'} your reply` : 'Your current and past work' : 'Your work requests'}
      />
      <ScrollMotionBar offset={scrollMotion.offset} reducedMotion={scrollMotion.reducedMotion} />
      {locked ? (
        <VerificationGate
          feature="jobs"
          underReview={underReview}
          onVerify={goVerify}
          bottomPadding={tabBarHeight + 24}
        />
      ) : (
      <>
      {!requests.isPending && !requests.isError ? (
        <MotionReveal style={styles.stageArea}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.stageGrid}>
            {(Object.keys(filterDetails) as Filter[]).map(key => {
              const details = filterDetails[key];
              const selected = filter === key;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{selected}}
                  accessibilityLabel={`${details.label}, ${counts[key]} jobs`}
                  key={key}
                  onPress={() => setFilter(key)}
                  style={({pressed}) => [
                    styles.stage,
                    selected && styles.stageSelected,
                    pressed && styles.pressed,
                  ]}>
                  <Text style={[styles.stageLabel, selected && styles.stageLabelSelected]}>{details.label}</Text>
                  <Text
                    style={[
                      styles.stageCount,
                      selected && styles.stageCountSelected,
                    ]}>
                    {counts[key]}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </MotionReveal>
      ) : null}
      {requests.isPending ? (
        <ScreenLoading label="Getting your jobs ready…" />
      ) : null}
      {requests.isError ? (
        <View style={styles.content}>
          <EmptyState
            icon="cloud-off-outline"
            title="Jobs could not load"
            message="Check your internet and tap try again."
          />
          <Pressable
            accessibilityRole="button"
            onPress={() => requests.refetch()}
            style={styles.retry}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : null}
      {!requests.isPending && !requests.isError ? (
        <MotionReveal key={filter} style={styles.listContainer}>
        <Animated.FlatList
          onScroll={scrollMotion.onScroll}
          scrollEventThrottle={16}
          data={visible}
          keyExtractor={item => `${item.kind}:${item.id}`}
          contentContainerStyle={[styles.list, {paddingBottom: tabBarHeight + ProSpacing.xxl}]}
          refreshControl={
            <RefreshControl
              refreshing={requests.isRefetching}
              onRefresh={requests.refetch}
              colors={[Colors.navyMid]}
              tintColor={Colors.navyMid}
            />
          }
          ListHeaderComponent={
            visible.length ? (
              <View style={styles.listHeading}>
                <Text style={styles.listTitle}>
                  {filterDetails[filter].label}
                </Text>
                <Text style={styles.listCount}>
                  {visible.length} {visible.length === 1 ? 'job' : 'jobs'}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={oldestFirst ? 'Sort newest first' : 'Sort oldest first'}
                  onPress={() => setOldestFirst(value => !value)}
                  style={styles.sortChip}>
                  <MaterialCommunityIcons name={oldestFirst ? 'sort-clock-ascending-outline' : 'sort-clock-descending-outline'} size={16} color={Colors.navyMid} />
                  <Text style={styles.sortText}>{oldestFirst ? 'Oldest' : 'Newest'}</Text>
                </Pressable>
              </View>
            ) : null
          }
          ListEmptyComponent={<View style={styles.emptyCard}>
            <View style={styles.emptyIcon}><MaterialCommunityIcons name={filter === 'NEW' ? 'bell-check-outline' : 'briefcase-check-outline'} size={27} color={Colors.navyMid} /></View>
            <Text style={styles.emptyTitle}>{filter === 'NEW' ? 'All caught up' : filter === 'ALL' ? 'Your next job starts here' : `No ${filterDetails[filter].label.toLowerCase()} yet`}</Text>
            <Text style={styles.emptyText}>{filter === 'ALL' ? 'New jobs will show here. Keep your time updated so customers can find you.' : 'No jobs here. See all jobs or pull down to refresh.'}</Text>
            <Pressable accessibilityRole="button" onPress={() => filter === 'ALL' ? tabs?.navigate('Schedule') : setFilter('ALL')} style={styles.emptyAction}>
              <Text style={styles.emptyActionText}>{filter === 'ALL' ? 'Set my availability' : 'See all jobs'}</Text>
              <MaterialCommunityIcons name="arrow-right" size={18} color={ProColors.onAccent} />
            </Pressable>
          </View>}
          ListFooterComponent={requests.hasNextPage ? (
            <Pressable
              accessibilityRole="button"
              disabled={requests.isFetchingNextPage}
              onPress={() => {requests.fetchNextPage().catch(() => undefined);}}
              style={[styles.loadMore, requests.isFetchingNextPage && styles.pressed]}>
              {requests.isFetchingNextPage ? <ProLoader size={26} /> : null}
              <Text style={styles.loadMoreText}>{requests.isFetchingNextPage ? 'Loading older jobs…' : 'Load older jobs'}</Text>
            </Pressable>
          ) : null}
          renderItem={({item}) => (
            <RequestCard
              request={item}
              onPress={() =>
                navigation.navigate('RequestDetail', {
                  id: item.id,
                  kind: item.kind,
                })
              }
            />
          )}
        />
        </MotionReveal>
      ) : null}
      </>
      )}
    </View>
  );
}

function RequestCard({
  request,
  onPress,
}: {
  request: WorkRequest;
  onPress: () => void;
}) {
  const date = new Date(request.createdAt);
  const status = statusDetails(request.status, request.kind === 'service');
  const formattedDate = Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('en-IN', {day: 'numeric', month: 'short'});
  // Compact tagline row: the full description, map and actions live on the
  // detail screen, so a long inbox stays scannable.
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${request.title}. ${status.label}. ${status.action}`}
      onPress={onPress}
      style={({pressed}) => [styles.card, pressed && styles.pressed]}>
      <ClientAvatar name={request.clientName} avatarUrl={request.clientAvatarUrl} size={48} />
      <View style={styles.cardBody}>
        <View style={styles.cardTopRow}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {request.title}
          </Text>
          {request.clientPlus ? (
            <View style={styles.plusPill}>
              <Text style={styles.plusPillText}>PLUS</Text>
            </View>
          ) : null}
          <View style={[styles.statusPill, {backgroundColor: status.background}]}>
            <Text style={[styles.statusPillText, {color: status.color}]} numberOfLines={1}>
              {status.pill}
            </Text>
          </View>
        </View>
        <Text style={styles.metaLine} numberOfLines={1}>
          {request.clientName || 'Customer'}
          {formattedDate ? `  ·  ${formattedDate}` : ''}
        </Text>
        <View style={styles.locationRow}>
          <MaterialCommunityIcons
            name="map-marker-outline"
            size={14}
            color={Colors.slate500}
          />
          <Text style={styles.locationText} numberOfLines={1}>
            {request.location || 'Location not provided'}
          </Text>
        </View>
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
  listContainer: {flex: 1},
  content: {padding: 20},
  flex: {flex: 1, minWidth: 0},
  stageArea: {
    paddingHorizontal: ProSpacing.xl,
    paddingTop: ProSpacing.md,
    paddingBottom: ProSpacing.md,
    backgroundColor: Colors.offWhite,
  },
  chooseLabel: {
    ...Typography.badge,
    lineHeight: 16,
    color: Colors.slate500,
    marginBottom: Spacing.sm,
  },
  stageGrid: {flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 20},
  stage: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: Colors.slate200,
    borderRadius: 22,
    backgroundColor: Colors.white,
  },
  stageSelected: {
    borderColor: Colors.navyDeep,
    backgroundColor: Colors.navyDeep,
  },
  stageLabel: {
    ...Typography.caption,
    color: Colors.slate800,
    fontWeight: '700',
  },
  stageLabelSelected: {color: Colors.white},
  stageCount: {...Typography.caption, color: Colors.slate500, fontWeight: '700'},
  stageCountSelected: {color: Colors.white},
  list: {
    padding: ProSpacing.xl,
    paddingBottom: Spacing.xxl,
    gap: ProSpacing.md,
    flexGrow: 0,
  },
  emptyCard: {backgroundColor: Colors.white, borderRadius: 22, borderWidth: 1, borderColor: Colors.slate200, padding: 22, gap: 10, marginTop: Spacing.sm},
  emptyIcon: {width: 52, height: 52, alignItems: 'center', justifyContent: 'center', marginBottom: 6},
  emptyTitle: {...Typography.h2, color: Colors.navyDeep},
  emptyText: {...Typography.body, color: Colors.slate600},
  emptyAction: {minHeight: 48, alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16, borderRadius: 12, backgroundColor: ProColors.accent, marginTop: 8},
  emptyActionText: {...Typography.button, color: ProColors.onAccent},
  listHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: Spacing.xs,
  },
  listTitle: {...Typography.h2, color: Colors.slate900, flex: 1},
  listCount: {...Typography.caption, color: Colors.slate500},
  sortChip: {flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.slate200},
  sortText: {...Typography.badge, lineHeight: 16, fontWeight: '700', color: Colors.navyMid},
  retry: {
    alignSelf: 'center',
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  retryText: {...Typography.button, lineHeight: 22, color: Colors.navyMid},
  loadMore: {minHeight: 48, marginTop: Spacing.sm, marginBottom: Spacing.md, paddingHorizontal: Spacing.md, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.slate200, backgroundColor: Colors.white, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: Spacing.sm},
  loadMoreText: {...Typography.button, color: Colors.navyMid},
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ProSpacing.md,
    backgroundColor: ProColors.surface,
    borderWidth: 1,
    borderColor: ProColors.border,
    borderRadius: BorderRadius.lg,
    paddingVertical: ProSpacing.md,
    paddingLeft: ProSpacing.md,
    paddingRight: ProSpacing.sm,
  },
  pressed: {opacity: 0.78},
  cardBody: {flex: 1, minWidth: 0, gap: 2},
  cardTopRow: {flexDirection: 'row', alignItems: 'center', gap: 6},
  cardTitle: {flex: 1, minWidth: 0, fontSize: 16, lineHeight: 22, fontWeight: '700', color: ProColors.text},
  plusPill: {backgroundColor: ProColors.accentSoft, borderRadius: ProRadius.pill,
    paddingHorizontal: 8, paddingVertical: 3},
  plusPillText: {fontSize: 10, fontWeight: '800', letterSpacing: 0.8, color: ProColors.accentText},
  statusPill: {
    borderRadius: BorderRadius.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
    maxWidth: 128,
  },
  statusPillText: {fontSize: 11, lineHeight: 15, fontWeight: '700'},
  metaLine: {fontSize: 13, lineHeight: 18, fontWeight: '400', color: ProColors.secondary},
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  locationText: {
    ...Typography.caption,
    color: Colors.slate500,
    flex: 1,
  },
});
