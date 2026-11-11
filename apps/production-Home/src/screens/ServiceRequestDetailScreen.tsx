import React, {useState} from 'react';
import {JourneyPanel} from '../../../../packages/mobile-booking/JourneyPanel';
import {openCheckout} from '../../../../packages/mobile-booking/razorpayGateway';
import type {CreatedOrder, PaymentStatusView} from '../../../../packages/mobile-booking/PaymentSection';
import {api} from '../services/apiClient';
import {Alert, ScrollView, StyleSheet, Text, TextInput, Pressable, View} from 'react-native';
import {useNavigation, useRoute, RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {AppHeader, Avatar, Button, StatusBadge} from '../components/ui';
import type {TrackableStatus} from '../components/ui/StatusBadge';
import {
  useServiceRequest,
  useCancelServiceRequest,
} from '../services/platformQueries';
import {useToast} from '../stores/toast';
import {cleanReviewComment} from '../utils/format';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {fetchAiSubscription} from '../services/aiBilling';
import {useClientProfile, useConversationsList, useCreateConversation, useUpdateClientProfile} from '../services/queries';
import {Colors, Spacing} from '@nahtreek/design-system';
import {ClientColors} from '../design-system/tokens';
import type {RootStackParamList} from '../navigation/types';
import {platformStyles as s} from './PlatformHistoryScreen';
import {KeyboardAwareView} from '../../../../packages/mobile-ui/KeyboardAwareView';
const submissionNotices:Record<string,{title:string;body:string}>={
  PENDING:{title:'Request sent · waiting for acceptance',body:'The professional has been notified. Your visit is not confirmed until they accept.'},
  ACCEPTED:{title:'The professional accepted',body:'Your visit is accepted. Check the arrival estimate and use chat to coordinate details.'},
  EN_ROUTE:{title:'The professional is on the way',body:'Arrival time and location are estimates. You can follow updates in this request.'},
  ARRIVED:{title:'The professional has arrived',body:'Confirm the work scope and price before work begins.'},
  IN_PROGRESS:{title:'Work is in progress',body:'Any change to the agreed work or price needs your approval.'},
  AWAITING_CONFIRMATION:{title:'Work summary ready',body:'Confirm only if the agreed work is complete, or report a problem.'},
  COMPLETED:{title:'Service completed',body:'The request is complete. Payment is handled separately.'},
  CANCELLED:{title:'Request cancelled',body:'This booking is cancelled and remains in your history.'},
  DECLINED:{title:'The professional declined',body:'No replacement was assigned. Choose another professional if you still need help.'},
  EXPIRED:{title:'Request expired',body:'No acceptance was received. You can submit a new request.'},
  DISPUTED:{title:'Issue reported',body:'The request remains open for support review.'},
};
export function ServiceRequestDetailScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route =
    useRoute<RouteProp<RootStackParamList, 'ServiceRequestDetail'>>();
  const query = useServiceRequest(route.params.requestId);
  const cancel = useCancelServiceRequest();
  const conversations = useConversationsList();
  const createConversation = useCreateConversation();
  const profile = useClientProfile();
  const updateProfile = useUpdateClientProfile();
  const billing = useQuery({queryKey: ['ai-billing'], queryFn: fetchAiSubscription, staleTime: 60000, retry: 1});
  const toast = useToast();
  const queryClient = useQueryClient();
  const [rating, setRating] = useState(5);
  const [reviewText, setReviewText] = useState('');
  const review = useMutation({
    mutationFn: () => api.post(`/service-requests/${route.params.requestId}/reviews`, {rating, comment: cleanReviewComment(reviewText)}),
    onSuccess: async () => {
      setReviewText('');
      toast('Thanks for sharing your feedback', 'success');
      await Promise.all([
        queryClient.invalidateQueries({queryKey: ['service-request']}),
        queryClient.invalidateQueries({queryKey: ['providers']}),
      ]);
    },
    onError: error => toast(error instanceof Error ? error.message : 'Could not send your review. Please try again.', 'error'),
  });
  const item = query.data;
  const currentStage = item?.journey?.stage ?? item?.status;
  const submissionNotice = route.params.submitted
    ? submissionNotices[currentStage ?? '']
    : undefined;
  const steps = [
    {status: 'PENDING', label: 'Request sent', detail: 'The professional can see your work and address.'},
    {status: 'ACCEPTED', label: 'Professional accepted', detail: 'Use chat to agree on time and final price before the visit.'},
    {status: 'IN_PROGRESS', label: 'Work started', detail: 'The professional has marked the job in progress.'},
    {status: 'COMPLETED', label: 'Work completed', detail: 'Your completed request stays in your history.'},
  ];
  const activeStep = steps.findIndex(step => step.status === item?.status);
  const openChat = () => {
    if (!item) return;
    const existing = conversations.data.find(conversation => conversation.serviceRequestId === item.id);
    if (existing) {
      nav.navigate('Chat', {conversationId: existing.id, title: item.provider.fullName, subtitle: `Re: ${item.category.title}`, avatarUrl: existing.otherAvatarUrl});
      return;
    }
    createConversation.mutate({serviceRequestId: item.id}, {
      onSuccess: conversation => nav.navigate('Chat', {
        conversationId: conversation.id,
        title: item.provider.fullName,
        subtitle: `Re: ${item.category.title}`,
        avatarUrl: conversation.otherAvatarUrl,
      }),
      onError: error => toast(error instanceof Error ? error.message : 'Could not open chat', 'error'),
    });
  };
  return (
    <KeyboardAwareView style={s.root}>
      <AppHeader title="Service request" onBack={() => nav.goBack()} />
      <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        {item ? (
          <View style={[s.card, styles.detailCard]}>
            <Text style={s.title}>{item.category.title}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`View ${item.provider.fullName}'s profile`}
              onPress={() => nav.navigate('ProviderProfile', {professionalProfileId: item.provider.id})}
              style={styles.proHeader}>
              <Avatar name={item.provider.fullName} uri={item.provider.avatarUrl} size={48} />
              <View style={styles.proCopy}>
                <Text style={styles.provider}>{item.provider.fullName}</Text>
                <Text style={s.text}>{item.provider.title} · {item.provider.baseCity}</Text>
              </View>
              <Text style={styles.proLink}>View ›</Text>
            </Pressable>
            <StatusBadge status={currentStage as TrackableStatus} />
            {submissionNotice ? (
              <View accessibilityRole="alert" style={styles.submissionNotice}>
                <Text style={styles.submissionTitle}>{submissionNotice.title}</Text>
                <Text style={styles.submissionBody}>{submissionNotice.body}</Text>
              </View>
            ) : null}
            <Text style={styles.sectionTitle}>What you asked for</Text>
            <Text style={s.text}>{item.description}</Text>
            <Text style={styles.sectionTitle}>Visit address</Text>
            <Text style={s.text}>{item.locationAddress}</Text>
            <Button
              label="See pinned location"
              variant="secondary"
              onPress={() => nav.navigate('MapPreview', {
                latitude: item.latitude,
                longitude: item.longitude,
                address: item.locationAddress,
                requestId: item.journey ? item.id : undefined,
              })}
            />
            <View style={styles.addressNotice}>
              <Text style={styles.addressNoticeTitle}>Need to change this address?</Text>
              <Text style={s.text}>Address changes aren’t supported after a request is sent. Contact the professional before they travel. If the location must change, cancel the request when that action is available, then create a new request with the correct address and map pin.</Text>
            </View>
            {item.journey ? <JourneyPanel id={item.id} client isPlus={billing.data?.effective} load={() => api.get(`/service-workflow/${item.id}`)} act={body => api.post(`/service-workflow/${item.id}/actions`, body)} receiptEmail={profile.data?.email ?? null} onSaveReceiptEmail={email => updateProfile.mutateAsync({email}).then(() => undefined)} onFindAnother={() => nav.navigate('ServiceProviders', {serviceId: item.category.id, title: item.category.title})} payment={{createOrder: () => api.post<CreatedOrder>('/payments/orders', {serviceRequestId: item.id}), verify: result => api.post<PaymentStatusView>('/payments/verify', {serviceRequestId: item.id, ...result}), dispute: (reason: string) => api.post<PaymentStatusView>('/payments/disputes', {serviceRequestId: item.id, reason}), loadStatus: () => api.get<PaymentStatusView | null>(`/payments/requests/${item.id}`).catch((error: any) => error?.status === 404 ? null : Promise.reject(error)), sync: () => api.post<PaymentStatusView>('/payments/sync', {serviceRequestId: item.id}), checkout: openCheckout}} /> : null}
            {item.status === 'COMPLETED' && item.journey?.stage === 'COMPLETED' ? (
              item.reviews?.length ? (
                <View style={styles.reviewSubmitted}>
                  <Text style={styles.reviewHeading}>Your review</Text>
                  <Text style={styles.reviewSummary}>{'★'.repeat(item.reviews[0].rating)}{'☆'.repeat(5 - item.reviews[0].rating)}  ·  {item.reviews[0].comment}</Text>
                </View>
              ) : (
                <View style={styles.reviewCard}>
                  <Text style={styles.reviewHeading}>How was the service?</Text>
                  <Text style={styles.reviewHint}>Your feedback helps this professional build a trusted reputation.</Text>
                  <View accessibilityRole="radiogroup" accessibilityLabel="Choose a rating" style={styles.ratingRow}>
                    {[1, 2, 3, 4, 5].map(value => (
                      <Pressable key={value} accessibilityRole="radio" accessibilityState={{checked: rating === value}} accessibilityLabel={`${value} star${value === 1 ? '' : 's'}`} onPress={() => setRating(value)} style={styles.ratingButton}>
                        <Text style={[styles.ratingStar, value <= rating && styles.ratingStarSelected]}>★</Text>
                      </Pressable>
                    ))}
                  </View>
                  <TextInput
                    accessibilityLabel="Review comment"
                    value={reviewText}
                    onChangeText={setReviewText}
                    placeholder="Share what went well (at least 3 characters)"
                    placeholderTextColor={Colors.slate500}
                    maxLength={1000}
                    multiline
                    style={styles.reviewInput}
                  />
                  <Button label="Send review" loading={review.isPending} disabled={cleanReviewComment(reviewText).length < 3} onPress={() => review.mutate()} />
                </View>
              )
            ) : null}
            {['PENDING','ACCEPTED','EN_ROUTE','ARRIVED','IN_PROGRESS','AWAITING_CONFIRMATION','COMPLETED','DISPUTED'].includes(currentStage ?? '') ? (
              <Button label="Message professional" loading={createConversation.isPending} onPress={openChat} />
            ) : null}
            {!item.journey && activeStep >= 0 ? (
              <View style={styles.timeline}>
                <Text style={styles.sectionTitle}>What happens next</Text>
                {steps.map((step, index) => (
                  <View key={step.status} style={styles.step}>
                    <View style={[styles.stepNumber, index <= activeStep && styles.stepNumberActive]}><Text style={[styles.stepNumberText, index <= activeStep && styles.stepNumberTextActive]}>{index + 1}</Text></View>
                    <View style={styles.stepCopy}>
                      <Text style={styles.stepTitle}>{step.label}</Text>
                      <Text style={s.text}>{step.detail}</Text>
                    </View>
                  </View>
                ))}
              </View>
            ) : null}
            <Text style={styles.sectionTitle}>Updates</Text>
            {item.statusHistory.map(event => (
              <View key={event.id} style={styles.historyRow}>
                <Text style={styles.historyTitle}>{event.toStatus.replace(/_/g, ' ')}</Text>
                <Text style={s.text}>
                  {new Date(event.createdAt).toLocaleString()}
                </Text>
              </View>
            ))}
            {!item.journey && ['PENDING', 'ACCEPTED'].includes(item.status) ? (
              <Button
                label="Cancel request"
                variant="secondary"
                loading={cancel.isPending}
                onPress={() => Alert.alert('Cancel this request?', `${item.provider.fullName} will be notified.`, [
                  {text: 'Keep request', style: 'cancel'},
                  {text: 'Cancel request', style: 'destructive', onPress: () => cancel.mutate(item.id, {
                    onSuccess: () => toast('Request cancelled', 'success'),
                    onError: error => toast(error.message, 'error'),
                  })},
                ])}
              />
            ) : null}
          </View>
        ) : (
          <View style={s.card}>
            <Text style={s.title}>
              {query.isPending
                ? 'Loading request…'
                : route.params.submitted?'Your request was sent':'Could not load this request'}
            </Text>
            {!query.isPending&&route.params.submitted?<Text style={s.text}>We couldn’t load its latest status. Your request was created successfully; check its status before trying to book again.</Text>:null}
            <Button label={route.params.submitted?'Check request status':'Try again'} loading={query.isFetching} disabled={query.isFetching} onPress={() => void query.refetch()} />
          </View>
        )}
      </ScrollView>
    </KeyboardAwareView>
  );
}

const styles = StyleSheet.create({
  reviewCard: {padding: 18, gap: 12, borderRadius: 18, borderWidth: 1, borderColor: Colors.slate200, backgroundColor: Colors.white},
  reviewSubmitted: {padding: 16, gap: 8, borderRadius: 16, backgroundColor: Colors.successBg},
  reviewHeading: {fontSize: 18, fontWeight: '700', color: Colors.navyDeep},
  reviewHint: {fontSize: 14, lineHeight: 20, color: Colors.slate600},
  ratingRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center'},
  ratingButton: {minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center'},
  ratingStar: {fontSize: 32, color: Colors.slate300},
  ratingStarSelected: {color: Colors.amberMuted},
  reviewInput: {minHeight: 92, padding: 12, borderWidth: 1, borderColor: Colors.slate200, borderRadius: 12, color: Colors.slate900, textAlignVertical: 'top'},
  reviewSummary: {fontSize: 15, lineHeight: 22, color: Colors.slate800},
  detailCard: {borderWidth: 1, borderColor: Colors.slate100},
  proHeader: {flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4},
  proCopy: {flex: 1, gap: 2},
  proLink: {fontSize: 14, fontWeight: '700', color: Colors.navyMid},
  provider: {fontSize: 16, fontWeight: '600', color: Colors.navyDeep},
  submissionNotice: {padding: Spacing.md, borderRadius: 14, backgroundColor: Colors.successBg, gap: Spacing.xs},
  submissionTitle: {fontSize: 16, fontWeight: '700', color: Colors.success},
  submissionBody: {fontSize: 14, lineHeight: 21, color: Colors.slate800},
  addressNotice: {padding: Spacing.md, borderRadius: 14, backgroundColor: Colors.surface, borderWidth: 1, borderColor: ClientColors.border, gap: Spacing.xs},
  addressNoticeTitle: {fontSize: 15, fontWeight: '700', color: Colors.navyDeep},
  sectionTitle: {fontSize: 16, fontWeight: '700', color: Colors.slate900, marginTop: Spacing.sm},
  timeline: {marginTop: Spacing.md, padding: Spacing.md, backgroundColor: Colors.surface, borderWidth: 1, borderColor: ClientColors.border, borderRadius: 16, gap: Spacing.md},
  step: {flexDirection: 'row', gap: 12, alignItems: 'flex-start'},
  stepNumber: {width: 28, height: 28, borderRadius: 14, backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.slate200, alignItems: 'center', justifyContent: 'center'},
  stepNumberActive: {backgroundColor: ClientColors.accent},
  stepNumberText: {fontWeight: '800', color: Colors.navyDeep},
  stepNumberTextActive: {color: ClientColors.onAccent},
  stepCopy: {flex: 1},
  stepTitle: {fontSize: 15, fontWeight: '700', color: Colors.navyDeep},
  historyRow: {paddingVertical: Spacing.xs, borderBottomWidth: 1, borderBottomColor: Colors.slate100},
  historyTitle: {fontSize: 14, fontWeight: '700', color: Colors.slate800},
});
