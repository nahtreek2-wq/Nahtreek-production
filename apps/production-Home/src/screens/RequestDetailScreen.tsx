import React, {useMemo, useState} from 'react';
import {Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {KeyboardAwareView} from '../../../../packages/mobile-ui/KeyboardAwareView';
import {DateTimeField} from '../../../../packages/mobile-ui/DateTimeField';
import {PaymentSection} from '../../../../packages/mobile-booking/PaymentSection';
import type {CreatedOrder, PaymentStatusView} from '../../../../packages/mobile-booking/PaymentSection';
import {openCheckout} from '../../../../packages/mobile-booking/razorpayGateway';
import {api} from '../services/apiClient';
import {isApiConfigured} from '../services/config';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {
  Colors,
  Spacing,
  Typography,
} from '@nahtreek/design-system';
import {ClientColors} from '../design-system/tokens';
import {
  AppHeader,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  ICONS,
  OfflineBanner,
  StatusBadge,
} from '../components/ui';
import {
  useCancelRequest,
  useClientProfile,
  useConversationsList,
  useCreateConversation,
  usePostReview,
  useRequestDetail,
  useRescheduleRequest,
  useUpdateClientProfile,
} from '../services/queries';
import {useQuery, useQueryClient} from '@tanstack/react-query';
import {fetchAiPlan, fetchAiSubscription} from '../services/aiBilling';
import {useToast} from '../stores/toast';
import {cleanReviewComment, inr} from '../utils/format';
import type {EngineerRequestDto} from '@nahtreek/types';
import type {RootStackParamList} from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type DetailRoute = RouteProp<RootStackParamList, 'RequestDetail'>;

const STATUS_STEPS = [
  {status: 'PENDING', label: 'Request sent'},
  {status: 'ACCEPTED', label: 'Accepted'},
  {status: 'IN_PROGRESS', label: 'Work started'},
  {status: 'COMPLETED', label: 'Completed'},
] as const;

function statusIndex(status: EngineerRequestDto['status']): number {
  if (status === 'DECLINED' || status === 'CANCELLED') return -1;
  return STATUS_STEPS.findIndex(step => step.status === status);
}

function formatCreatedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('en-IN', {dateStyle: 'medium', timeStyle: 'short'});
}

function ReviewSection({request}: {request: EngineerRequestDto}) {
  const toast = useToast();
  const client = useQueryClient();
  const post = usePostReview();
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');

  if (request.review) {
    return (
      <Card style={styles.reviewCard}>
        <Text style={styles.reviewTitle}>Your review</Text>
        <Text style={styles.reviewStars} accessibilityLabel={`Rated ${request.review.rating} out of 5`}>
          {'★'.repeat(request.review.rating)}{'☆'.repeat(5 - request.review.rating)}
        </Text>
        <Text style={styles.reviewComment}>{request.review.comment}</Text>
      </Card>
    );
  }

  const submit = () => {
    if (cleanReviewComment(comment).length < 4) {
      toast('Please write a few words about the work.', 'error');
      return;
    }
    post.mutate(
      {id: request.id, rating, comment: cleanReviewComment(comment)},
      {
        onSuccess: () => {
          toast('Thanks for rating your professional.', 'success');
          void client.invalidateQueries({queryKey: ['request-detail', request.id]});
          void client.invalidateQueries({queryKey: ['requests']});
        },
        onError: error =>
          toast(error instanceof Error ? error.message : 'Could not send your review. Please try again.', 'error'),
      },
    );
  };

  return (
    <Card style={styles.reviewCard}>
      <Text style={styles.reviewTitle}>Rate {request.engineerName}</Text>
      <Text style={styles.reviewHint}>How was the work? Your rating helps other customers.</Text>
      <View style={styles.starRow}>
        {[1, 2, 3, 4, 5].map(star => (
          <Pressable
            key={star}
            accessibilityRole="button"
            accessibilityLabel={`Rate ${star} star${star === 1 ? '' : 's'}`}
            accessibilityState={{selected: star <= rating}}
            onPress={() => setRating(star)}
            hitSlop={6}>
            <Text style={[styles.star, star <= rating && styles.starActive]}>★</Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        value={comment}
        onChangeText={setComment}
        placeholder="What did they do well? Was anything late or messy?"
        placeholderTextColor={Colors.slate500}
        multiline
        maxLength={500}
        style={styles.reviewInput}
      />
      <Button
        label={post.isPending ? 'Sending…' : 'Send review'}
        onPress={submit}
        disabled={post.isPending}
      />
    </Card>
  );
}

export function RequestDetailScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<DetailRoute>();
  const toast = useToast();
  const requests = useRequestDetail(route.params.requestId);
  const conversations = useConversationsList();
  const createConversation = useCreateConversation();
  const cancelRequest = useCancelRequest();
  const rescheduleRequest = useRescheduleRequest();
  const [newDate, setNewDate] = useState<Date | null>(null);
  const profile = useClientProfile();
  const updateProfile = useUpdateClientProfile();
  const billing = useQuery({queryKey: ['ai-billing'], queryFn: fetchAiSubscription, staleTime: 60000, retry: 1});
  const aiPlan = useQuery({queryKey: ['ai-plan'], queryFn: fetchAiPlan, staleTime: 5 * 60_000, retry: 1});
  const request = requests.data;
  const paymentHooks = useMemo(() => {
    const id = request?.id ?? '';
    return {
      createOrder: () => api.post<CreatedOrder>('/payments/orders', {engineerRequestId: id}),
      verify: (result: {razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string}) =>
        api.post<PaymentStatusView>('/payments/verify', {engineerRequestId: id, ...result}),
      dispute: (reason: string) =>
        api.post<PaymentStatusView>('/payments/disputes', {engineerRequestId: id, reason}),
      loadStatus: () =>
        api
          .get<PaymentStatusView | null>(`/payments/engineer-requests/${id}`)
          .catch((error: any) => (error?.status === 404 ? null : Promise.reject(error))),
      sync: () => api.post<PaymentStatusView>('/payments/sync', {engineerRequestId: id}),
      checkout: openCheckout,
    };
  }, [request?.id]);

  const openChat = () => {
    if (!request) return;
    const existing = conversations.data.find(
      item => item.engineerRequestId === request.id,
    );
    if (existing) {
      navigation.navigate('Chat', {
        conversationId: existing.id,
        title: existing.professionalName,
        subtitle: `Re: ${request.projectTitle}`,
        avatarUrl: existing.otherAvatarUrl,
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

  const cancel = () => {
    if (!request) return;
    Alert.alert(
      'Cancel this request?',
      'The engineer will be notified and the request will close. If you already paid, the held amount is refunded automatically. You can send a new request anytime.',
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

  if (requests.isLoading && !request) {
    return (
      <View style={styles.container}>
        <AppHeader title="Request details" onBack={() => navigation.goBack()} />
        <View style={styles.loading}>
          <Text style={styles.loadingText}>Loading request…</Text>
        </View>
      </View>
    );
  }

  if (requests.isError && !request) {
    return (
      <View style={styles.container}>
        <AppHeader title="Request details" onBack={() => navigation.goBack()} />
        <ErrorState
          title="Couldn't load this request"
          message="Check your connection and try again."
          onAction={requests.refetch}
        />
      </View>
    );
  }

  if (!request) {
    return (
      <View style={styles.container}>
        <AppHeader title="Request details" onBack={() => navigation.goBack()} />
        <EmptyState
          icon={ICONS.requests}
          title="Request not found"
          message="This request is no longer available on this device."
          actionLabel="Back to requests"
          onAction={() => navigation.goBack()}
        />
      </View>
    );
  }

  const current = statusIndex(request.status);
  const canCancel = ['PENDING', 'ACCEPTED'].includes(request.status);

  return (
    <KeyboardAwareView style={styles.container}>
      <AppHeader
        title="Request details"
        subtitle={request.engineerName}
        onBack={() => navigation.goBack()}
        right={<StatusBadge status={request.status as never} />}
      />
      <OfflineBanner
        force={requests.isOffline}
        onRetry={requests.refetch}
        retrying={requests.isRefetching}
      />
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}>
        <Card style={styles.summaryCard}>
          <Text style={styles.eyebrow}>REQUEST SUMMARY</Text>
          <Text style={styles.title}>{request.projectTitle}</Text>
          <Text style={styles.created}>
            Submitted {formatCreatedAt(request.createdAt)}
          </Text>
          <View style={styles.summaryRow}>
            <Icon name={ICONS.engineers} size={18} color={Colors.slate500} />
            <Text numberOfLines={1} allowFontScaling={false} style={styles.summaryLabel}>Professional</Text>
            <Text style={styles.summaryValue}>{request.engineerName}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Icon name={ICONS.building} size={18} color={Colors.slate500} />
            <Text numberOfLines={1} allowFontScaling={false} style={styles.summaryLabel}>Property</Text>
            <Text style={styles.summaryValue}>
              {request.propertyType}
              {request.projectSizeSqFt
                ? ` · ${request.projectSizeSqFt.toLocaleString('en-IN')} sq.ft`
                : ''}
            </Text>
          </View>
          <View style={styles.summaryRow}>
            <Icon name={ICONS.location} size={18} color={Colors.slate500} />
            <Text numberOfLines={1} allowFontScaling={false} style={styles.summaryLabel}>Location</Text>
            <Text style={styles.summaryValue}>{request.locationAddress}</Text>
          </View>
          {request.consultationFeePaisa !== undefined && request.consultationFeePaisa !== null ? (
            <View style={styles.summaryRow}>
              <Icon name={ICONS.currency} size={18} color={Colors.slate500} />
              <Text numberOfLines={1} allowFontScaling={false} style={styles.summaryLabel}>Consultation fee</Text>
              <Text style={styles.summaryValue}>{inr(request.consultationFeePaisa)}</Text>
            </View>
          ) : null}
        </Card>

        {isApiConfigured &&
        request.consultationFeePaisa !== undefined &&
        request.consultationFeePaisa !== null &&
        ['ACCEPTED', 'IN_PROGRESS', 'COMPLETED'].includes(request.status) ? (
          <View style={styles.paymentWrap}>
            <PaymentSection
              requestId={request.id}
              requestKind="engineer"
              quoteAmountPaisa={request.consultationFeePaisa}
              hooks={paymentHooks}
              receiptEmail={profile.data?.email ?? null}
              onSaveReceiptEmail={email => updateProfile.mutateAsync({email}).then(() => undefined)}
              isPlus={billing.data?.effective}
              plusDiscount={aiPlan.data ? {percent: aiPlan.data.consultDiscountBps / 100, capPaisa: aiPlan.data.consultDiscountCapPaisa} : null}
            />
          </View>
        ) : null}

        {request.completionCode && ['ACCEPTED', 'IN_PROGRESS'].includes(request.status) ? (
          <Card style={styles.codeCard}>
            <Text style={styles.codeTitle}>Completion code</Text>
            <Text style={styles.codeValue}>{request.completionCode}</Text>
            <Text style={styles.codeHint}>
              Share this code with {request.engineerName} only after the work is done. The job cannot complete without it.
            </Text>
          </Card>
        ) : null}

        <Text style={styles.sectionTitle}>Status timeline</Text>
        <Card style={styles.timelineCard}>
          {request.statusHistory?.length ? (
            request.statusHistory.map(event => (
              <View key={event.id} style={styles.timelineRow}>
                <View style={[styles.timelineDot, styles.timelineDotActive]}>
                  <Icon name={ICONS.check} size={11} color={Colors.white} />
                </View>
                <View style={styles.timelineCopy}>
                  <Text style={styles.timelineTitleActive}>
                    {event.toStatus.replace(/_/g, ' ')}
                  </Text>
                  <Text style={styles.timelineMeta}>
                    {formatCreatedAt(event.createdAt)}
                  </Text>
                </View>
              </View>
            ))
          ) : request.status === 'DECLINED' ||
            request.status === 'CANCELLED' ? (
            <View style={styles.specialStatus}>
              <View style={styles.specialIcon}>
                <Icon
                  name={
                    request.status === 'DECLINED' ? ICONS.close : ICONS.check
                  }
                  size={18}
                  color={
                    request.status === 'DECLINED'
                      ? Colors.error
                      : ClientColors.accentIcon
                  }
                />
              </View>
              <View style={styles.timelineCopy}>
                <Text style={styles.timelineTitle}>
                  {request.status === 'DECLINED'
                    ? 'Request declined'
                    : 'Request cancelled'}
                </Text>
                <Text style={styles.timelineMeta}>
                  Submitted {formatCreatedAt(request.createdAt)}
                </Text>
              </View>
            </View>
          ) : (
            STATUS_STEPS.map((step, index) => {
              const done = index <= current;
              return (
                <View key={step.status} style={styles.timelineRow}>
                  <View style={styles.timelineRail}>
                    {index > 0 ? (
                      <View style={[styles.rail, done && styles.railActive]} />
                    ) : null}
                    <View
                      style={[
                        styles.timelineDot,
                        done && styles.timelineDotActive,
                      ]}>
                      {done ? (
                        <Icon
                          name={ICONS.check}
                          size={11}
                          color={Colors.white}
                        />
                      ) : null}
                    </View>
                  </View>
                  <View style={styles.timelineCopy}>
                    <Text
                      style={[
                        styles.timelineTitle,
                        done && styles.timelineTitleActive,
                      ]}>
                      {step.label}
                    </Text>
                    <Text style={styles.timelineMeta}>
                      {index === 0
                        ? formatCreatedAt(request.createdAt)
                        : done && index === current
                        ? 'Current status · awaiting next update'
                        : 'Not started'}
                    </Text>
                  </View>
                </View>
              );
            })
          )}
        </Card>

        <Text style={styles.sectionTitle}>Requirement details</Text>
        <Card style={styles.detailsCard}>
          <Text style={styles.description}>{request.projectDescription}</Text>
        </Card>

        <View style={styles.actions}>
          <Button
            label="Ask NAHTREEK AI about this project"
            variant="secondary"
            icon={<Icon name={ICONS.ai} size={18} color={Colors.navyDeep} />}
            onPress={() => navigation.navigate('AiPlanner')}
          />
          <Button
            label="View location on map"
            variant="secondary"
            icon={
              <Icon name={ICONS.location} size={18} color={Colors.navyDeep} />
            }
            onPress={() => navigation.navigate('MapPreview', {
              latitude: request.latitude,
              longitude: request.longitude,
              address: request.locationAddress,
            })}
          />
          {['PENDING', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED'].includes(request.status) ? (
            <Button
              label="Open messages"
              icon={
                <Icon name={ICONS.messages} size={17} color={Colors.white} />
              }
              onPress={openChat}
              style={styles.action}
            />
          ) : null}
          {canCancel ? (
            <Card style={styles.summaryCard}>
              <Text style={styles.eyebrow}>CONSULTATION TIME</Text>
              <Text style={styles.created}>
                {request.preferredStartDate ? new Date(request.preferredStartDate).toLocaleString('en-IN', {day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit'}) : 'Not scheduled yet'}
              </Text>
              <DateTimeField label="Pick a new time" accessibilityLabel="New consultation time"
                value={newDate} onChange={setNewDate}
                minimumDate={new Date(Date.now() + 30 * 60000)} maximumDate={new Date(Date.now() + 30 * 86400000)} />
              <Button
                label={rescheduleRequest.isPending ? 'Saving…' : 'Save new time'}
                onPress={() => {
                  if (!newDate) return;
                  rescheduleRequest.mutate(
                    {id: request.id, scheduledAt: newDate.toISOString()},
                    {onSuccess: () => {setNewDate(null); toast('Consultation time updated', 'success');},
                     onError: (error: unknown) => toast(error instanceof Error ? error.message : 'Could not reschedule', 'error')},
                  );
                }}
                disabled={!newDate || rescheduleRequest.isPending}
                style={styles.action}
              />
            </Card>
          ) : null}
          {canCancel ? (
            <Button
              label={cancelRequest.isPending ? 'Cancelling…' : 'Cancel request'}
              variant="danger"
              onPress={cancel}
              disabled={cancelRequest.isPending}
              style={styles.action}
            />
          ) : null}
          {request.status === 'COMPLETED' ? (
            <ReviewSection request={request} />
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAwareView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: Colors.offWhite},
  content: {padding: 20, paddingBottom: Spacing.xxl},
  summaryCard: {padding: 20},
  paymentWrap: {marginTop: Spacing.xl},
  codeCard: {marginTop: Spacing.xl, padding: Spacing.lg, alignItems: 'center', gap: Spacing.xs},
  codeTitle: {...Typography.badge, color: Colors.slate500},
  codeValue: {...Typography.h1, letterSpacing: 8, color: Colors.navyDeep},
  codeHint: {...Typography.body, color: Colors.slate600, textAlign: 'center'},
  eyebrow: {
    ...Typography.badge,
    color: ClientColors.accentText,
    letterSpacing: 1,
  },
  title: {...Typography.h2, color: Colors.slate900, marginTop: Spacing.sm},
  created: {
    ...Typography.caption,
    color: Colors.slate500,
    marginTop: Spacing.xs,
    marginBottom: Spacing.md,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingTop: Spacing.sm,
    marginTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.slate100,
  },
  summaryLabel: {...Typography.caption, fontSize: 13, lineHeight: 18, color: Colors.slate500, width: 96, flexShrink: 0},
  summaryValue: {
    ...Typography.caption,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.slate800,
    fontWeight: '600',
    flex: 1,
    textAlign: 'right',
  },
  sectionTitle: {
    ...Typography.h3,
    color: Colors.slate900,
    marginTop: Spacing.xl,
    marginBottom: Spacing.sm,
  },
  timelineCard: {padding: Spacing.lg},
  timelineRow: {flexDirection: 'row', minHeight: 58},
  timelineRail: {width: 24, alignItems: 'center'},
  rail: {
    position: 'absolute',
    top: -10,
    width: 2,
    height: 22,
    backgroundColor: Colors.slate200,
  },
  railActive: {backgroundColor: Colors.navyDeep},
  timelineDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Colors.slate200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelineDotActive: {backgroundColor: Colors.navyDeep},
  timelineCopy: {flex: 1, marginLeft: Spacing.sm},
  timelineTitle: {...Typography.body, color: Colors.slate400},
  timelineTitleActive: {color: Colors.slate900, fontWeight: '700'},
  timelineMeta: {...Typography.caption, color: Colors.slate500, marginTop: 2},
  specialStatus: {flexDirection: 'row', alignItems: 'center'},
  specialIcon: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailsCard: {padding: Spacing.lg},
  description: {...Typography.body, color: Colors.slate700},
  actions: {gap: Spacing.sm, marginTop: Spacing.xl},
  action: {width: '100%'},
  loading: {padding: Spacing.xl, alignItems: 'center'},
  loadingText: {...Typography.body, color: Colors.slate600},
  reviewCard: {gap: Spacing.sm},
  reviewTitle: {...Typography.subtitle, color: Colors.slate900, fontWeight: '700'},
  reviewHint: {...Typography.caption, color: Colors.slate600, lineHeight: 18},
  reviewStars: {fontSize: 22, color: Colors.amber, letterSpacing: 2},
  reviewComment: {...Typography.body, color: Colors.slate800, lineHeight: 21},
  starRow: {flexDirection: 'row', gap: Spacing.xs},
  star: {fontSize: 30, color: Colors.slate300},
  starActive: {color: Colors.amber},
  reviewInput: {
    ...Typography.body,
    color: Colors.slate900,
    borderWidth: 1,
    borderColor: Colors.slate200,
    borderRadius: 12,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    minHeight: 76,
    textAlignVertical: 'top',
  },
});
