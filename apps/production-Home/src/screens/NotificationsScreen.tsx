import React from 'react';
import {View, Text, FlatList, TouchableOpacity, StyleSheet} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {
  Colors,
  Typography,
  Spacing,
} from '@nahtreek/design-system';
import {ClientColors} from '../design-system/tokens';
import {
  AppHeader,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  IconName,
  ICONS,
  OfflineBanner,
} from '../components/ui';
import {EngineerCardSkeleton} from '../components/SkeletonLoader';
import {
  useNotificationsList,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
} from '../services/queries';
import {useToast} from '../stores/toast';
import type {NotificationDto} from '@nahtreek/types';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {RootStackParamList} from '../navigation/types';

const KIND_STYLE: Record<string, {icon: IconName; bg: string; fg: string}> = {
  request: {icon: ICONS.requests, bg: 'transparent', fg: Colors.info},
  tracking: {icon: ICONS.location, bg: 'transparent', fg: Colors.info},
  message: {icon: ICONS.messages, bg: 'transparent', fg: Colors.navyMid},
  offer: {icon: ICONS.star, bg: 'transparent', fg: ClientColors.accentIcon},
};

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('en-IN');
}

export function NotificationsScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const query = useNotificationsList();
  const markAll = useMarkAllNotificationsRead();
  const markRead = useMarkNotificationRead();
  const toast = useToast();

  const apiItems = (query.data ?? []) as NotificationDto[];
  const items = apiItems as (NotificationDto & {
    data?: {
      engineerRequestId?: string;
      serviceRequestId?: string;
      conversationId?: string;
      status?: string;
      destination?: string;
    };
  })[];

  return (
    <View style={styles.container}>
      <AppHeader
        title="Notifications"
        subtitle="Updates on your requests, visits and offers"
        onBack={() => navigation.goBack()}
      />
      <OfflineBanner
        force={query.isOffline}
        onRetry={query.refetch}
        retrying={query.isRefetching}
      />
      {items.length > 0 ? (
        <View style={styles.markAllRow}>
          <TouchableOpacity
            accessibilityLabel="Mark all notifications read"
            accessibilityRole="button"
            onPress={() => {
              markAll.mutate(undefined as never, {
                onError: () =>
                  toast(
                    'Could not mark notifications as read. Please try again.',
                    'error',
                  ),
              });
            }}
            style={styles.markAll}>
            <Text style={styles.markAllLabel}>Mark all read</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      {query.isLoading && !items.length ? (
        <View style={styles.list}>
          <EngineerCardSkeleton />
        </View>
      ) : query.isError && !items.length ? (
        <ErrorState
          icon={ICONS.bell}
          title="Couldn't load notifications"
          message="Check your connection and try again."
          actionLabel="Retry"
          onAction={query.refetch}
        />
      ) : (
        <FlatList
          onEndReached={query.loadMore}
          onEndReachedThreshold={0.5}
          data={items}
          keyExtractor={item => item.id}
          contentContainerStyle={[
            styles.list,
            {paddingBottom: insets.bottom + Spacing.xl},
          ]}
          ListEmptyComponent={
            <EmptyState
              icon={ICONS.bell}
              title="No notifications yet"
              message="Request updates, messages and offers will appear here."
            />
          }
          renderItem={({item}) => {
            const k = item.data?.status === 'COMPLETED'
              ? {icon: ICONS.check, bg: Colors.successBg, fg: Colors.success}
              : item.data?.status === 'DECLINED'
              ? {icon: ICONS.requests, bg: Colors.errorBg, fg: Colors.error}
              : item.data?.status === 'CANCELLED'
              ? {icon: ICONS.requests, bg: Colors.slate100, fg: Colors.slate600}
              : KIND_STYLE[item.kind] ?? KIND_STYLE.request!;
            const unread =
              'isRead' in item
                ? !(item as NotificationDto).isRead
                : !(item as any).read;
            return (
              <TouchableOpacity
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel={`${unread ? 'Mark as read: ' : ''}${
                  item.title
                }`}
                onPress={() => {
                  if (unread)
                    markRead.mutate(item.id, {
                      onError: () =>
                        toast('Could not mark this update as read.', 'error'),
                    });
                  if (item.data?.destination === 'support')
                    navigation.navigate('Help');
                  else if (item.data?.conversationId)
                    navigation.navigate('Chat', {
                      conversationId: item.data.conversationId,
                      title: 'Conversation',
                    });
                  else if (item.data?.engineerRequestId)
                    navigation.navigate('RequestDetail', {
                      requestId: item.data.engineerRequestId,
                    });
                  else if (item.data?.serviceRequestId)
                    navigation.navigate('ServiceRequestDetail', {
                      requestId: item.data.serviceRequestId,
                    });
                }}>
                <Card style={[styles.card, unread && styles.cardUnread]}>
                  <View style={[styles.iconCircle, {backgroundColor: k.bg}]}>
                    <Icon name={k.icon} size={18} color={k.fg} />
                  </View>
                  <View style={styles.body}>
                    <View style={styles.topRow}>
                      <Text style={styles.title} numberOfLines={1}>
                        {item.title}
                      </Text>
                      <Text style={styles.time}>{formatTime(item.time)}</Text>
                    </View>
                    <Text style={styles.text} numberOfLines={2}>
                      {item.body}
                    </Text>
                  </View>
                  {unread && <View style={styles.unreadDot} />}
                </Card>
              </TouchableOpacity>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.offWhite,
  },
  markAllRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
  },
  markAll: {
    padding: Spacing.xs,
    minHeight: 44,
    justifyContent: 'center',
  },
  markAllLabel: {
    ...Typography.caption,
    fontWeight: '600',
    color: ClientColors.accentText,
  },
  list: {
    padding: Spacing.lg,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginBottom: Spacing.sm,
  },
  cardUnread: {
    borderColor: Colors.glassBorder,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  title: {
    ...Typography.subtitle,
    fontWeight: '700',
    color: Colors.slate900,
    flexShrink: 1,
  },
  time: {
    ...Typography.badge,
    color: Colors.slate400,
  },
  text: {
    ...Typography.caption,
    color: Colors.slate500,
    marginTop: 2,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: ClientColors.accentIcon,
  },
});
