import {ScreenHeader} from '../components/ScreenHeader';
import {ProLoader} from '../components/ProLoader';
import React, {useState} from 'react';
import {
  Animated,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {BottomTabNavigationProp} from '@react-navigation/bottom-tabs';
import {useBottomTabBarHeight} from '@react-navigation/bottom-tabs';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useInfiniteQuery, useMutation, useQueryClient} from '@tanstack/react-query';
import {
  BorderRadius,
  Colors,
  Spacing,
  Typography,
} from '@nahtreek/design-system';
import type {
  MainTabParamList,
  ProfileStackParamList,
} from '../navigation/types';
import {api} from '../services/apiClient';
import {EmptyState} from '../components/EmptyState';
import {ScreenLoading} from '../components/ScreenLoading';
import {ScrollMotionBar, useScrollMotion} from '../components/ScrollMotionBar';
import {WorkVisual} from '../components/WorkVisual';
import {ProColors, ProType} from '../theme/professionalTheme';
import {nextPage, type PageMeta} from '../services/pagination';

type NotificationItem = {
  id: string;
  kind: string;
  title: string;
  body: string;
  time: string;
  isRead: boolean;
  data?: {
    engineerRequestId?: string;
    serviceRequestId?: string;
    conversationId?: string;
  };
};
type NotificationPage = {data: NotificationItem[]; meta: PageMeta & {total: number}};

function notificationVisual(kind: string): 'message' | 'schedule' | 'verification' | 'review' | 'engineering' | 'notification' {
  const value = kind.toLowerCase();
  if (value.includes('message') || value.includes('chat')) {return 'message';}
  if (value.includes('schedule') || value.includes('availability') || value.includes('visit')) {return 'schedule';}
  if (value.includes('verif') || value.includes('document')) {return 'verification';}
  if (value.includes('review') || value.includes('rating')) {return 'review';}
  if (value.includes('request') || value.includes('job') || value.includes('quote')) {return 'engineering';}
  return 'notification';
}

export function NotificationsScreen() {
  const scrollMotion = useScrollMotion();
  const tabBarHeight = useBottomTabBarHeight();
  const navigation =
    useNavigation<NativeStackNavigationProp<ProfileStackParamList>>();
  const tabs =
    navigation.getParent<BottomTabNavigationProp<MainTabParamList>>();
  const queryClient = useQueryClient();
  const notifications = useInfiniteQuery({
    queryKey: ['professional-notifications'],
    initialPageParam: 1,
    queryFn: ({pageParam}) => api.get<NotificationPage>(`/notifications?limit=50&page=${pageParam}`),
    getNextPageParam: lastPage => nextPage(lastPage.meta),
    refetchInterval: 15000,
    refetchIntervalInBackground: false,
  });
  const refresh = () =>
    queryClient.invalidateQueries({queryKey: ['professional-notifications']});
  const markRead = useMutation({
    mutationFn: (id: string) => api.patch(`/notifications/${id}/read`),
    onSuccess: refresh,
  });
  const markAll = useMutation({
    mutationFn: () => api.patch('/notifications/mark-all-read'),
    onSuccess: refresh,
  });
  const open = (item: NotificationItem) => {
    if (!item.isRead) {
      markRead.mutate(item.id);
    }
    if ((item.data as {destination?: string} | undefined)?.destination === 'support') {
      tabs?.navigate('Profile', {screen: 'Support'});
      return;
    }
    if (item.data?.conversationId) {
      tabs?.navigate('Messages', {
        screen: 'Chat',
        params: {
          conversationId: item.data.conversationId,
          title: 'Client conversation',
          requestId: item.data.engineerRequestId ?? item.data.serviceRequestId,
          requestKind: item.data.serviceRequestId ? 'service' : item.data.engineerRequestId ? 'engineering' : undefined,
        },
      });
      return;
    }
    if (item.data?.engineerRequestId) {
      tabs?.navigate('Requests', {
        screen: 'RequestDetail',
        params: {id: item.data.engineerRequestId, kind: 'engineering'},
      });
      return;
    }
    if (item.data?.serviceRequestId) {
      tabs?.navigate('Requests', {
        screen: 'RequestDetail',
        params: {id: item.data.serviceRequestId, kind: 'service'},
      });
    }
  };
  const items = notifications.data?.pages.flatMap(page => page.data) ?? [];
  const [unreadOnly, setUnreadOnly] = useState(false);
  const visibleItems = unreadOnly ? items.filter(item => !item.isRead) : items;
  const today = new Date().toDateString();
  const feed = visibleItems.map((item, index) => {
    const section = new Date(item.time).toDateString() === today ? 'Today' : 'Earlier';
    const previous = visibleItems[index - 1];
    const previousSection = previous && (new Date(previous.time).toDateString() === today ? 'Today' : 'Earlier');
    return {...item, section: section !== previousSection ? section : undefined};
  });
  const unread = items.filter(item => !item.isRead).length;
  return (
    <View style={styles.root}>
      <ScreenHeader
        title="Notifications"
        subtitle={
          unread ? `${unread} unread updates` : 'Your work and message updates'
        }
        onBack={() => navigation.goBack()}
        right={
          unread ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Mark all notifications as read"
              disabled={markAll.isPending}
              onPress={() => markAll.mutate()}
              style={styles.markAll}>
              <Text style={styles.markAllText}>Read all</Text>
            </Pressable>
          ) : null
        }
      />
      <ScrollMotionBar offset={scrollMotion.offset} reducedMotion={scrollMotion.reducedMotion} />
      {notifications.isPending ? (
        <ScreenLoading label="Loading your updates…" />
      ) : notifications.isError ? (
        <View style={styles.error}>
          <EmptyState
            icon="bell-alert-outline"
            title="Updates could not load"
            message="Check your connection and try again."
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry loading notifications"
            onPress={() => notifications.refetch()}
            style={styles.retry}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <>
        {items.length > 0 ? <View style={styles.tools}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Show all notifications"
            accessibilityState={{selected: !unreadOnly}}
            onPress={() => setUnreadOnly(false)}
            style={[styles.filterChip, !unreadOnly && styles.filterChipOn]}>
            <Text style={[styles.filterText, !unreadOnly && styles.filterTextOn]}>All</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Show unread notifications only"
            accessibilityState={{selected: unreadOnly}}
            onPress={() => setUnreadOnly(true)}
            style={[styles.filterChip, unreadOnly && styles.filterChipOn]}>
            <Text style={[styles.filterText, unreadOnly && styles.filterTextOn]}>Unread{unread > 0 ? ` (${unread})` : ''}</Text>
          </Pressable>
        </View> : null}
        <Animated.FlatList
          onScroll={scrollMotion.onScroll}
          scrollEventThrottle={16}
          data={feed}
          keyExtractor={item => item.id}
          refreshControl={
            <RefreshControl
              refreshing={notifications.isRefetching}
              onRefresh={notifications.refetch}
              colors={[Colors.navyMid]}
            />
          }
          contentContainerStyle={[styles.list, {paddingBottom: tabBarHeight + Spacing.xxl}]}
          ListEmptyComponent={
            unreadOnly && items.length > 0 ? (
              <EmptyState
                icon="bell-check-outline"
                title="All caught up"
                message="Every notification is read. New updates will appear here."
                actionLabel="Show all"
                onAction={() => setUnreadOnly(false)}
              />
            ) : (
              <EmptyState
                icon="bell-outline"
                title="No notifications yet"
                message="New requests, status changes and client messages will appear here."
                actionLabel="View jobs"
                onAction={() => tabs?.navigate('Requests', {screen: 'RequestInbox'})}
              />
            )
          }
          ListFooterComponent={notifications.hasNextPage ? (
            <Pressable
              accessibilityRole="button"
              disabled={notifications.isFetchingNextPage}
              onPress={() => {notifications.fetchNextPage().catch(() => undefined);}}
              style={[styles.loadMore, notifications.isFetchingNextPage && styles.unreadCard]}>
              {notifications.isFetchingNextPage ? <ProLoader size={26} /> : null}
              <Text style={styles.loadMoreText}>{notifications.isFetchingNextPage ? 'Loading older updates…' : 'Load older updates'}</Text>
            </Pressable>
          ) : null}
          renderItem={({item}) => (<>
            {item.section ? <Text style={styles.sectionHeading}>{item.section}</Text> : null}
            <Pressable
              accessibilityRole="button"
              onPress={() => open(item)}
              style={[styles.card, !item.isRead && styles.unreadCard]}>
              <WorkVisual kind={notificationVisual(item.kind)} size={42} />
              <View style={styles.flex}>
                <View style={styles.titleRow}>
                  <Text style={styles.title}>{item.title}</Text>
                  <Text style={styles.time}>
                    {new Date(item.time).toLocaleDateString('en-IN', {
                      day: '2-digit',
                      month: 'short',
                    })}
                  </Text>
                </View>
                <Text style={styles.body}>{item.body}</Text>
              </View>
              {!item.isRead ? <View style={styles.dot} /> : null}
            </Pressable>
          </>)}
        />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionHeading: {...ProType.eyebrow, color: ProColors.secondary, marginTop: 16, marginBottom: 8},
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
  flex: {flex: 1, minWidth: 0},
  headerTitle: {...Typography.h2, color: Colors.white},
  headerSubtitle: {...Typography.caption, color: Colors.slate300, marginTop: 2},
  markAll: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm,
  },
  markAllText: {...Typography.button, lineHeight: 22, color: Colors.navyMid},
  list: {padding: 20, paddingBottom: Spacing.xxl, gap: Spacing.sm, flexGrow: 1},
  tools: {flexDirection: 'row', gap: Spacing.sm, paddingHorizontal: 20, paddingTop: 12},
  filterChip: {paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999, backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.slate200},
  filterChipOn: {backgroundColor: Colors.navyDeep, borderColor: Colors.navyDeep},
  filterText: {...Typography.badge, lineHeight: 16, fontWeight: '700', color: Colors.navyMid},
  filterTextOn: {color: Colors.white},
  card: {
    minHeight: 86,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.slate200,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.white,
  },
  unreadCard: {borderColor: Colors.navyMid, backgroundColor: Colors.white},
  titleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  title: {
    ...Typography.body,
    color: Colors.slate900,
    fontWeight: '700',
    flex: 1,
  },
  body: {...Typography.caption, color: Colors.slate600, marginTop: 3},
  time: {...Typography.badge, lineHeight: 16, color: Colors.slate500},
  dot: {width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.navyMid},
  error: {flex: 1, justifyContent: 'center', padding: 20},
  retry: {alignSelf: 'center', padding: 20},
  retryText: {...Typography.button, lineHeight: 22, color: Colors.navyMid},
  loadMore: {minHeight: 48, marginTop: Spacing.sm, paddingHorizontal: Spacing.md, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.slate200, backgroundColor: Colors.white, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: Spacing.sm},
  loadMoreText: {...Typography.button, color: Colors.navyMid},
});
