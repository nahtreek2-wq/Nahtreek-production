import React, {useState} from 'react';
import {Alert, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import {useNavigation} from '@react-navigation/native';
import {useBottomTabBarHeight, type BottomTabNavigationProp} from '@react-navigation/bottom-tabs';
import type {MainTabParamList} from '../navigation/types';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {ProIconChip} from '../components/ProIconChip';
import {ScreenHeader} from '../components/ScreenHeader';
import {ScreenLoading} from '../components/ScreenLoading';
import {EmptyState} from '../components/EmptyState';
import {api} from '../services/apiClient';
import {useProToast} from '../stores/proToast';
import {ProColors, ProRadius, ProSpacing, ProType} from '../theme/professionalTheme';
import {CheckoutCancelledError, GatewayUnavailableError, openCheckout} from '../../../../packages/mobile-booking/razorpayGateway';
import type {CheckoutInput, CheckoutResult} from '../../../../packages/mobile-booking/razorpayGateway';

export type DuesJob = {id: string; serviceRequestId: string | null; engineerRequestId?: string | null; amountPaisa: number; platformFeePaisa: number; createdAt: string};
export type DuesPenalty = {id: string; serviceRequestId: string; amountPaisa: number; reason: string; createdAt: string};
export type DuesTerms = {memberFeeBps: number; standardFeeBps: number; memberDuesBlockPaisa: number;
  standardDuesBlockPaisa: number; freeJobsPerMonth: number};
export type DuesView = {duesPaisa: number; blocked: boolean; blockThresholdPaisa: number; jobs: DuesJob[]; penalties?: DuesPenalty[]; isMember?: boolean; memberSavingsPaisa?: number; terms: DuesTerms};

const penaltyLabel = (reason: string) => reason === 'LATE_ACCEPT'
  ? 'Slow acceptance of a Plus request while online'
  : 'Late arrival to a Plus booking';
export type DuesHooks = {
  load: () => Promise<DuesView>;
  order: () => Promise<{settlementId: string; keyId: string; orderId: string; amountPaisa: number; currency: string}>;
  verify: (result: {settlementId: string} & CheckoutResult) => Promise<unknown>;
  checkout?: (input: CheckoutInput) => Promise<CheckoutResult>;
};

const defaultHooks: DuesHooks = {
  load: () => api.get<DuesView>('/payments/dues'),
  order: () => api.post('/payments/dues/orders', {}),
  verify: result => api.post('/payments/dues/verify', result),
};

function messageFor(error: unknown): string {
  if (error instanceof GatewayUnavailableError) return error.message;
  const status = (error as {status?: number})?.status;
  if (status === 503) return 'Online settlement is not available yet. Your dues are recorded and safe.';
  if (status === 401) return 'Your sign-in has expired. Please sign in again.';
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong. Please try again.';
}

const rupees = (paisa: number) => `₹${(paisa / 100).toLocaleString('en-IN')}`;

export function DuesScreen({hooks = defaultHooks}: {hooks?: DuesHooks}) {
  const navigation = useNavigation();
  const tabBarHeight = useBottomTabBarHeight();
  const cache = useQueryClient();
  const toast = useProToast();
  const [failed, setFailed] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const query = useQuery({queryKey: ['pro-dues'], queryFn: hooks.load, retry: 1});
  const refresh = () => {
    void cache.invalidateQueries({queryKey: ['pro-dues']});
    void cache.invalidateQueries({queryKey: ['professional-profile']});
    // Membership savings and per-job collect cards read the same payment —
    // without this they keep showing the pre-payment state after dues clear.
    void cache.invalidateQueries({queryKey: ['membership']});
    void cache.invalidateQueries({queryKey: ['pro-collect-status']});
  };
  const settlePaid = () => {
    setFailed(null); setCancelled(false); setConfirming(false); refresh();
    toast('Commission dues cleared. New jobs are unlocked.', 'success');
    if (navigation.canGoBack()) navigation.goBack();
  };

  // Razorpay capture can lag the checkout success by seconds. Only a 409
  // saying "not captured yet" means money left the account with capture
  // pending — poll verify (then the plain dues total) instead of stranding
  // the user on a pay button. Any other 409 (mismatch, already processed)
  // needs a fresh order, not a 40s futile poll.
  const notCaptured = (error: unknown) =>
    (error as {status?: number})?.status === 409 && error instanceof Error && /not captured yet/i.test(error.message);
  const pollSettlement = async (payload: {settlementId: string} & CheckoutResult) => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 4000));
      try {
        await hooks.verify(payload);
        settlePaid();
        return;
      } catch (error) {
        if (!notCaptured(error)) {
          setConfirming(false);
          setCancelled(false);
          setFailed(messageFor(error));
          refresh();
          return;
        }
      }
    }
    try {
      const view = await hooks.load();
      if (view.duesPaisa === 0) {
        settlePaid();
        return;
      }
    } catch {
      // Fall through to the wait-and-reopen message below.
    }
    setConfirming(false);
    setFailed('Payment is still confirming at Razorpay. Wait a minute, then reopen this screen — do not pay again.');
    refresh();
  };

  const pay = useMutation({mutationFn: async () => {
    const order = await hooks.order();
    const result = await (hooks.checkout ?? openCheckout)({keyId: order.keyId, orderId: order.orderId,
      amountPaisa: order.amountPaisa, currency: order.currency,
      name: 'NAHTREEK commission dues', description: 'Platform commission for pay-at-home jobs'});
    return {settlementId: order.settlementId, ...result};
  }, onSuccess: payload => {
    // Verify inline so a capture-lag 409 can start polling instead of
    // surfacing as a payment failure with the pay button still showing.
    hooks.verify(payload).then(settlePaid, error => {
      if (notCaptured(error)) {
        setFailed(null); setCancelled(false); setConfirming(true); refresh();
        void pollSettlement(payload);
        return;
      }
      setCancelled(false); setFailed(messageFor(error)); refresh();
    });
  },
  onError: error => {
    if (error instanceof CheckoutCancelledError) { setCancelled(true); setFailed(null); refresh(); return; }
    setCancelled(false);
    setFailed(messageFor(error));
    refresh();
  }});

  const startPay = (total: number) => Alert.alert('Settle commission dues?',
    `${rupees(total)} will be charged securely to NAHTREEK for your pay-at-home jobs.`,
    [{text: 'Not now', style: 'cancel'}, {text: `Pay ${rupees(total)}`, onPress: () => pay.mutate()}]);

  const view = query.data;
  const goToJobs = () => navigation.getParent<BottomTabNavigationProp<MainTabParamList>>()?.navigate('Requests', {screen: 'RequestInbox'});

  return <View style={styles.root}>
    <ScreenHeader title="Commission dues" subtitle="Pay-at-home platform share" onBack={() => navigation.goBack()} />
    {query.isPending ? <ScreenLoading label="Loading your dues…" /> : query.isError || !view ? (
      <EmptyState title="Could not load dues" message="Check your connection and try again." actionLabel={query.isFetching ? 'Checking…' : 'Try again'} onAction={() => void query.refetch()} />
    ) : (
      <>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.totalCard}>
          <View style={styles.heroRow}>
            <ProIconChip name="cash-multiple" size={58} iconSize={30} />
            <View style={styles.heroCopy}>
              <Text style={styles.totalLabel}>Total due</Text>
              <Text style={styles.total}>{rupees(view.duesPaisa)}</Text>
            </View>
          </View>
          <View style={styles.meter} accessibilityRole="progressbar" accessibilityLabel={`${rupees(view.duesPaisa)} of ${rupees(view.blockThresholdPaisa)} dues limit`}>
            <View style={[styles.meterFill, {width: `${Math.min(100, Math.round((view.duesPaisa / view.blockThresholdPaisa) * 100))}%`,
              backgroundColor: view.blocked ? ProColors.error : ProColors.primary}]} />
          </View>
          <Text style={styles.hint}>{rupees(view.duesPaisa)} of {rupees(view.blockThresholdPaisa)} limit{view.blocked ? ' — over the limit, new jobs paused' : ' — new jobs pause above the limit'}.</Text>
          <Text style={styles.hint}>{view.terms.standardFeeBps / 100}% of each pay-at-home job. Pro members pay {view.terms.memberFeeBps / 100}%, get the first job each month free, and are blocked only above {rupees(view.terms.memberDuesBlockPaisa)}. You collected the full amount from the customer; this is NAHTREEK&apos;s share.</Text>
          {view.isMember && (view.memberSavingsPaisa ?? 0) > 0 ? (
            <View style={styles.savings}>
              <Text style={styles.savingsTitle}>Membership saved you {rupees(view.memberSavingsPaisa ?? 0)}</Text>
              <Text style={styles.savingsBody}>These jobs were billed below the {view.terms.standardFeeBps / 100}% standard rate.</Text>
            </View>
          ) : null}
          {!view.isMember && view.jobs.length > 0 ? (
            <View style={styles.savings}>
              <Text style={styles.savingsTitle}>Members would have saved up to {rupees(view.jobs.reduce((sum, job, index) => sum + (index === 0 ? Math.floor((job.amountPaisa * 1000) / 10000) : Math.floor((job.amountPaisa * 1000) / 10000) - Math.floor((job.amountPaisa * 700) / 10000)), 0))} here</Text>
              <Text style={styles.savingsBody}>Pro membership makes the first job each month free and bills the rest at 7% instead of 10%.</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="View Pro membership" onPress={() => (navigation as {navigate: (route: string) => void}).navigate('Membership')} style={styles.savingsLink}>
                <Text style={styles.savingsLinkText}>View Pro membership</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
        {view.blocked ? (
          <View accessibilityRole="alert" style={styles.blocked}>
            <ProIconChip name="pause-octagon" tone="red" size={46} iconSize={26} />
            <View style={styles.blockedCopy}>
              <Text style={styles.blockedTitle}>New jobs are paused</Text>
              <Text style={styles.blockedBody}>Dues above {rupees(view.blockThresholdPaisa)} block new accepts. Settle below the limit to unlock Jobs, Time and Chat requests.</Text>
            </View>
          </View>
        ) : null}
        {view.jobs.length === 0 && (view.penalties ?? []).length === 0 ? (
          <EmptyState title="No dues" message="Nothing to settle. Dues appear here after pay-at-home jobs." actionLabel="Browse jobs" onAction={goToJobs} />
        ) : view.jobs.map(job => (
          <View key={job.id} style={styles.job}>
            <ProIconChip name={job.engineerRequestId ? 'hard-hat' : 'tools'} size={46} iconSize={24} />
            <View style={styles.jobCopy}>
              <View style={styles.jobRow}>
                <Text style={styles.jobAmount}>{rupees(job.platformFeePaisa)}</Text>
                <Text style={styles.jobDate}>{new Date(job.createdAt).toLocaleDateString('en-IN', {day: 'numeric', month: 'short'})}</Text>
              </View>
              <Text style={styles.hint}>Collected {rupees(job.amountPaisa)} at home · {job.engineerRequestId ? 'engineering' : 'service'} job {(job.serviceRequestId ?? job.engineerRequestId ?? job.id).slice(0, 8)}</Text>
            </View>
          </View>
        ))}
        {(view.penalties ?? []).map(penalty => (
          <View key={penalty.id} style={styles.penalty}>
            <ProIconChip name="alert-circle" tone="red" size={46} iconSize={26} />
            <View style={styles.jobCopy}>
              <View style={styles.jobRow}>
                <Text style={styles.penaltyAmount}>{rupees(penalty.amountPaisa)} penalty</Text>
                <Text style={styles.jobDate}>{new Date(penalty.createdAt).toLocaleDateString('en-IN', {day: 'numeric', month: 'short'})}</Text>
              </View>
              <Text style={styles.hint}>{penaltyLabel(penalty.reason)} · job {penalty.serviceRequestId.slice(0, 8)}</Text>
            </View>
          </View>
        ))}
        {failed ? <Text accessibilityRole="alert" style={styles.error}>{failed}</Text> : null}
        {cancelled ? <Text style={styles.hint}>Checkout cancelled. Nothing was charged — settle whenever you are ready.</Text> : null}
        {confirming ? <Text style={styles.confirming}>Payment received — confirming with Razorpay. Keep this screen open; do not pay again.</Text> : null}
      </ScrollView>
      {view.duesPaisa > 0 && !confirming ? (
        <View style={[styles.stickyBar, {paddingBottom: tabBarHeight + ProSpacing.md}]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Settle dues" disabled={pay.isPending} onPress={() => startPay(view.duesPaisa)}
            style={[styles.pay, pay.isPending && {opacity: 0.6}]}>
            <MaterialCommunityIcons name="lock-check" size={20} color={ProColors.onAccent} />
            <Text style={styles.payText}>{pay.isPending ? 'Opening secure checkout…' : `Settle ${rupees(view.duesPaisa)}`}</Text>
          </Pressable>
        </View>
      ) : null}
      </>
    )}
  </View>;
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: ProColors.background},
  body: {padding: ProSpacing.md, gap: ProSpacing.md},
  totalCard: {backgroundColor: ProColors.surface, borderRadius: ProRadius.card, padding: ProSpacing.md, gap: 8},
  heroRow: {flexDirection: 'row', alignItems: 'center', gap: ProSpacing.md},
  heroCopy: {flex: 1, gap: 0},
  meter: {height: 10, borderRadius: 5, backgroundColor: ProColors.border, overflow: 'hidden'},
  meterFill: {height: 10, borderRadius: 5},
  totalLabel: {...ProType.meta, color: ProColors.muted},
  total: {fontSize: 32, fontWeight: '800', color: ProColors.text},
  hint: {...ProType.meta, color: ProColors.muted},
  savings: {backgroundColor: ProColors.successSoft, borderRadius: ProRadius.input, padding: ProSpacing.md, gap: 2, marginTop: 8},
  savingsTitle: {fontSize: 15, fontWeight: '800', color: ProColors.success},
  savingsBody: {...ProType.body, color: ProColors.success},
  savingsLink: {marginTop: 4, alignSelf: 'flex-start'},
  savingsLinkText: {fontSize: 15, fontWeight: '800', color: ProColors.success, textDecorationLine: 'underline'},
  blocked: {flexDirection: 'row', alignItems: 'center', gap: ProSpacing.md, backgroundColor: ProColors.errorSoft, borderRadius: ProRadius.input, padding: ProSpacing.md},
  blockedCopy: {flex: 1, gap: 4},
  blockedTitle: {fontSize: 15, fontWeight: '800', color: ProColors.error},
  blockedBody: {...ProType.body, color: ProColors.error},
  job: {flexDirection: 'row', alignItems: 'center', gap: ProSpacing.md, backgroundColor: ProColors.surface, borderRadius: ProRadius.input, padding: ProSpacing.md},
  jobCopy: {flex: 1, gap: 4},
  penalty: {flexDirection: 'row', alignItems: 'center', gap: ProSpacing.md, backgroundColor: ProColors.warningSoft, borderRadius: ProRadius.input, padding: ProSpacing.md},
  penaltyAmount: {fontSize: 18, fontWeight: '800', color: ProColors.warning},
  jobRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
  jobAmount: {fontSize: 18, fontWeight: '800', color: ProColors.text},
  jobDate: {...ProType.meta, color: ProColors.muted},
  error: {color: ProColors.error},
  confirming: {color: ProColors.primary, fontWeight: '700'},
  stickyBar: {backgroundColor: ProColors.surface, borderTopWidth: 1, borderTopColor: ProColors.border, padding: ProSpacing.md},
  pay: {flexDirection: 'row', gap: 8, backgroundColor: ProColors.accent, borderRadius: ProRadius.input, minHeight: 52, alignItems: 'center', justifyContent: 'center'},
  payText: {fontSize: 16, fontWeight: '800', color: ProColors.onAccent},
});
