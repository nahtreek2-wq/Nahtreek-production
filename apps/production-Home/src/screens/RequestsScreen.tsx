import React, {useMemo, useState} from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {useBottomTabBarHeight} from '@react-navigation/bottom-tabs';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {
  Colors,
  Spacing,
  Typography,
} from '@nahtreek/design-system';
import {ClientColors} from '../design-system/tokens';
import {
  AppHeader,
  BottomSheet,
  Button,
  ChipRow,
  EmptyState,
  Icon,
  ICONS,
  Input,
  OfflineBanner,
  ProgressStepper,
  StatusBadge,
} from '../components/ui';
import {ProviderCardSkeleton} from '../components/SkeletonLoader';
import {useToast} from '../stores/toast';
import {useListFilters} from '../stores/listFilters';
import {
  queryKeys,
  useCancelRequest,
  useConversationsList,
  useCreateConversation,
  usePostReview,
  useRequestsData,
} from '../services/queries';
import {useQueryClient} from '@tanstack/react-query';
import type {EngineerRequestDto} from '@nahtreek/types';
import type {RootStackParamList} from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;
const STEPS = ['Pending', 'Accepted', 'Ongoing', 'Done'];
const FILTERS = ['All', 'Active', 'Completed', 'Cancelled'];

function stepIndex(status: string) {
  return status === 'PENDING'
    ? 0
    : status === 'ACCEPTED'
    ? 1
    : status === 'IN_PROGRESS'
    ? 2
    : 3;
}

export function RequestsScreen() {
  const tabBarHeight = useBottomTabBarHeight();
  const navigation = useNavigation<Nav>();
  const toast = useToast();
  const requestsQ = useRequestsData();
  const conversationsQ = useConversationsList();
  const createConversation = useCreateConversation();
  const cancelRequest = useCancelRequest();
  const postReview = usePostReview();
  const [reviewing, setReviewing] = useState<EngineerRequestDto | null>(null);
  const [rating, setRating] = useState('5');
  const [comment, setComment] = useState('');
  const filter = useListFilters(state => state.requestsFilter);
  const setFilter = useListFilters(state => state.setRequestsFilter);
  const filteredRequests = useMemo(() => {
    if (filter === 'Active')
      return requestsQ.data.filter(request =>
        ['PENDING', 'ACCEPTED', 'IN_PROGRESS'].includes(request.status),
      );
    if (filter === 'Completed')
      return requestsQ.data.filter(request => request.status === 'COMPLETED');
    if (filter === 'Cancelled')
      return requestsQ.data.filter(request =>
        ['CANCELLED', 'DECLINED'].includes(request.status),
      );
    return requestsQ.data;
  }, [filter, requestsQ.data]);

  const openChat = (request: EngineerRequestDto) => {
    const conversation = (conversationsQ.data ?? []).find(
      item => item.engineerRequestId === request.id,
    );
    if (conversation) {
      navigation.navigate('Chat', {
        conversationId: conversation.id,
        title: conversation.professionalName,
        subtitle: `Re: ${request.projectTitle}`,
        avatarUrl: conversation.otherAvatarUrl,
      });
      return;
    }
    createConversation.mutate(
      {engineerRequestId: request.id},
      {
        onSuccess: conversation =>
          navigation.navigate('Chat', {
            conversationId: conversation.id,
            title: conversation.professionalName,
            subtitle: `Re: ${request.projectTitle}`,
            avatarUrl: conversation.otherAvatarUrl,
          }),
        onError: error =>
          toast(
            error instanceof Error
              ? error.message
              : 'Could not open the conversation',
            'error',
          ),
      },
    );
  };

  const cancel = (request: EngineerRequestDto) => {
    Alert.alert(
      'Cancel this request?',
      'The engineer will be notified. This cannot be undone.',
      [
        {text: 'Keep request', style: 'cancel'},
        {
          text: 'Cancel request',
          style: 'destructive',
          onPress: () =>
            cancelRequest.mutate(request.id, {
              onSuccess: () => toast('Request cancelled', 'info'),
              onError: error =>
                toast(
                  error instanceof Error
                    ? error.message
                    : 'Could not cancel the request',
                  'error',
                ),
            }),
        },
      ],
    );
  };

  const queryClient = useQueryClient();
  const submitReview = () => {
    if (!reviewing || !comment.trim()) return;
    postReview.mutate(
      {id: reviewing.id, rating: Number(rating), comment: comment.trim()},
      {
        onSuccess: () => {
          setReviewing(null);
          setComment('');
          toast('Thank you for your review', 'success');
          void queryClient.invalidateQueries({queryKey: queryKeys.requests});
        },
        onError: error =>
          toast(
            error instanceof Error ? error.message : 'Could not submit review',
            'error',
          ),
      },
    );
  };

  return (
    <View style={styles.container}>
      <AppHeader
        title="My requests"
        subtitle="Track consultations and service visits"
        tab
      />
      <Pressable style={styles.serviceLink} accessibilityRole="button"
        onPress={() => navigation.navigate('ServiceHistory')}>
        <View style={styles.serviceIcon}><Icon name={ICONS.serviceHero} size={20} color={ClientColors.accentIcon} /></View>
        <View style={styles.serviceCopy}>
          <Text style={styles.serviceTitle}>Home service requests</Text>
          <Text style={styles.meta}>Repairs, maintenance and visits</Text>
        </View>
        <Icon name={ICONS.chevronRight} size={20} color={Colors.navyDeep} />
      </Pressable>
      <OfflineBanner
        force={requestsQ.isOffline}
        onRetry={requestsQ.refetch}
        retrying={requestsQ.isRefetching}
      />
      <View style={styles.filters}>
        <ChipRow items={FILTERS} selected={filter} onSelect={setFilter} />
      </View>
      {requestsQ.isLoading ? (
        <View style={styles.loading}>
          <ProviderCardSkeleton />
          <ProviderCardSkeleton />
        </View>
      ) : null}
      {!requestsQ.isLoading ? (
        <FlatList
          onEndReached={requestsQ.loadMore}
          onEndReachedThreshold={0.5}
          data={filteredRequests}
          keyExtractor={item => item.id}
          contentContainerStyle={[
            styles.list,
            {paddingBottom: tabBarHeight + 24},
            !requestsQ.data.length && styles.emptyList,
          ]}
          refreshControl={
            <RefreshControl
              refreshing={requestsQ.isRefetching}
              onRefresh={() => requestsQ.refetch()}
              tintColor={Colors.navyDeep}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyActions}>
              <EmptyState
                icon={ICONS.requests}
                title={
                  filter === 'All'
                    ? 'No requests yet'
                    : `No ${filter.toLowerCase()} requests`
                }
                message="Your engineer consultations will appear here after you send a request. Home-service bookings are tracked separately above."
                actionLabel="Find an engineer"
                onAction={() => navigation.navigate('EngineerDiscovery')}
              />
              <Pressable
                accessibilityRole="button"
                style={styles.browseServicesAction}
                onPress={() => navigation.navigate('MainTabs', {screen: 'Home'})}>
                <Icon name={ICONS.serviceHero} size={18} color={Colors.navyDeep} />
                <Text style={styles.browseServicesText}>Browse home services</Text>
                <Icon name={ICONS.chevronRight} size={18} color={Colors.navyDeep} />
              </Pressable>
            </View>
          }
          renderItem={({item}) => (
            <RequestCard
              request={item}
              onOpen={() =>
                navigation.navigate('RequestDetail', {requestId: item.id})
              }
              onChat={openChat}
              onCancel={cancel}
              onFindAnother={() => navigation.navigate('EngineerDiscovery')}
              onReview={() => {
                setReviewing(item);
                setRating('5');
                setComment('');
              }}
            />
          )}
        />
      ) : null}
      <BottomSheet
        visible={!!reviewing}
        title="Rate your experience"
        subtitle={reviewing?.engineerName}
        onClose={() => setReviewing(null)}>
        <Input
          label="Rating (1 to 5)"
          value={rating}
          onChangeText={setRating}
          keyboardType="numeric"
        />
        <Input
          label="Review"
          value={comment}
          onChangeText={setComment}
          placeholder="Share what went well"
          multiline
        />
        <Button
          label={postReview.isPending ? 'Submitting…' : 'Submit review'}
          disabled={
            postReview.isPending ||
            !comment.trim() ||
            Number(rating) < 1 ||
            Number(rating) > 5
          }
          onPress={submitReview}
        />
      </BottomSheet>
    </View>
  );
}

export function RequestCard({
  request,
  onOpen,
  onChat,
  onCancel,
  onReview,
  onFindAnother,
}: {
  request: EngineerRequestDto;
  onOpen: () => void;
  onChat: (request: EngineerRequestDto) => void;
  onCancel: (request: EngineerRequestDto) => void;
  onReview: () => void;
  onFindAnother?: () => void;
}) {
  const terminal = ['DECLINED', 'CANCELLED', 'COMPLETED'].includes(
    request.status,
  );
  const canCancel = ['PENDING', 'ACCEPTED'].includes(request.status);
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <Pressable
          onPress={onOpen}
          accessibilityRole="button"
          accessibilityLabel={`Open request ${request.projectTitle}`}
          style={styles.titlePressable}>
          <Text style={styles.title}>
            {request.projectTitle}
          </Text>
        </Pressable>
        <StatusBadge status={request.status as never} />
      </View>
      <Text style={styles.professional}>{request.engineerName}</Text>
      <Pressable onPress={onOpen} accessibilityRole="button" style={styles.detailsLink}>
        <Text style={styles.meta}>
          {request.propertyType}
          {request.projectSizeSqFt
            ? ` · ${request.projectSizeSqFt} sq.ft`
            : ''}{' '}
          · {new Date(request.createdAt).toLocaleDateString('en-IN')}
        </Text>
      </Pressable>
      {!terminal ? (
        <View style={styles.progress}>
          <ProgressStepper
            steps={STEPS}
            currentIndex={stepIndex(request.status)}
          />
        </View>
      ) : null}
      {request.status === 'DECLINED' ? (
        <Text style={styles.note}>
          This request was declined. You can choose another engineer at any
          time.
        </Text>
      ) : null}
      {request.status === 'CANCELLED' ? (
        <Text style={styles.note}>This request was cancelled.</Text>
      ) : null}
      <View style={styles.actions}>
        {['ACCEPTED', 'IN_PROGRESS', 'COMPLETED'].includes(request.status) ? (
          <Button
            label="Message"
            variant="secondary"
            icon={
              <Icon name={ICONS.messages} size={16} color={Colors.navyDeep} />
            }
            onPress={() => onChat(request)}
            style={styles.action}
          />
        ) : null}
        {canCancel ? (
          <Button
            label="Cancel"
            variant="danger"
            onPress={() => onCancel(request)}
            style={styles.action}
          />
        ) : null}
        {['DECLINED', 'CANCELLED'].includes(request.status) && onFindAnother ? (
          <Button
            label="Find another engineer"
            onPress={onFindAnother}
            style={styles.action}
          />
        ) : null}
        {request.status === 'COMPLETED' ? (
          request.review ? (
            <View
              style={styles.ratedRow}
              accessibilityLabel={`Rated ${request.review.rating} out of 5`}>
              <Text style={styles.ratedStars}>
                {'★'.repeat(request.review.rating)}
                {'☆'.repeat(5 - request.review.rating)}
              </Text>
              <Text style={styles.ratedText}>Reviewed</Text>
            </View>
          ) : (
            <Button label="Rate" onPress={onReview} style={styles.action} />
          )
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#F3F5F8'},
  serviceLink: {flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 16},
  serviceIcon: {width: 48, height: 48, alignItems: 'center', justifyContent: 'center'},
  serviceCopy: {flex: 1},
  serviceTitle: {fontSize: 16, lineHeight: 22, fontWeight: '700', color: '#111F35'},
  detailsLink: {minHeight: 48, justifyContent: 'center'},
  loading: {padding: Spacing.lg},
  list: {padding: 20, gap: 12},
  emptyList: {flexGrow: 1, justifyContent: 'center'},
  emptyActions: {gap: 12},
  browseServicesAction: {minHeight: 52, marginHorizontal: 24, paddingHorizontal: 16, borderRadius: 14, borderWidth: 1, borderColor: Colors.slate200, backgroundColor: Colors.white, flexDirection: 'row', alignItems: 'center', gap: 10},
  browseServicesText: {flex: 1, color: Colors.navyDeep, fontSize: 15, fontWeight: '700'},
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.slate200,
  },
  filters: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    backgroundColor: Colors.offWhite,
  },
  cardTop: {
    flexDirection: 'row',
    gap: Spacing.sm,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  titlePressable: {flex: 1, minHeight: 48, justifyContent: 'center'},
  title: {fontSize: 18, lineHeight: 24, fontWeight: '700', color: '#111F35'},
  professional: {
    ...Typography.subtitle,
    color: Colors.navyDeep,
    marginTop: Spacing.sm,
  },
  meta: {...Typography.caption, color: Colors.slate600, marginTop: 2},
  progress: {marginTop: Spacing.md},
  note: {...Typography.body, color: Colors.slate600, marginTop: Spacing.md},
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  action: {flexGrow: 1},
  ratedRow: {
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: '#FFF6DD',
    paddingHorizontal: Spacing.md,
  },
  ratedStars: {fontSize: 16, color: Colors.amber, includeFontPadding: false},
  ratedText: {...Typography.caption, fontWeight: '700', color: Colors.slate700},
});
