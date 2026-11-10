import React, {useState} from 'react';
import {ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {useBottomTabBarHeight} from '@react-navigation/bottom-tabs';
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

export type MembershipTerms = {memberFeeBps: number; standardFeeBps: number; memberDuesBlockPaisa: number;
  standardDuesBlockPaisa: number; freeJobsPerMonth: number};
export type MembershipView = {status: string; effective: boolean; currentPeriodStart: string | null;
  currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; feePaisa: number; currency: string;
  terms: MembershipTerms; lifetimeSavingsPaisa?: number; jobsAtMemberRate?: number};
export type MembershipHooks = {
  load: () => Promise<MembershipView>;
  subscribe: () => Promise<MembershipView & {keyId: string; subscriptionId: string | null; shortUrl: string | null}>;
  confirm: () => Promise<MembershipView>;
  cancel: () => Promise<MembershipView>;
  checkout?: (input: CheckoutInput) => Promise<CheckoutResult>;
};

const defaultHooks: MembershipHooks = {
  load: () => api.get<MembershipView>('/memberships/me'),
  subscribe: () => api.post<MembershipView & {keyId: string; subscriptionId: string | null; shortUrl: string | null}>('/memberships/subscribe'),
  confirm: () => api.post<MembershipView>('/memberships/confirm'),
  cancel: () => api.post<MembershipView>('/memberships/cancel', {}),
};

const inr = (paisa: number) => `₹${(paisa / 100).toLocaleString('en-IN')}`;
const pct = (bps: number) => `${bps / 100}%`;

// Every figure below renders from server terms — the plan price, rates and
// dues room change on the backend without an app release.
function benefitsFor(terms: MembershipTerms): {title: string; body: string; icon: string}[] {
  const free = terms.freeJobsPerMonth;
  return [
    {title: free === 1 ? 'First job every month at 0% commission' : `${free} jobs every month at 0% commission`,
      body: 'Your first booking each calendar month keeps the full amount.', icon: 'gift'},
    {title: `${pct(terms.memberFeeBps)} commission, not ${pct(terms.standardFeeBps)}`,
      body: 'Keep more of every other job while your membership is active.', icon: 'percent'},
    {title: `${inr(terms.memberDuesBlockPaisa)} dues room, not ${inr(terms.standardDuesBlockPaisa)}`,
      body: `New jobs pause only after ${inr(terms.memberDuesBlockPaisa)} unsettled instead of ${inr(terms.standardDuesBlockPaisa)}.`, icon: 'cash-multiple'},
    {title: 'Top of discovery', body: 'Members rank above non-members in client search results.', icon: 'arrow-up-bold-circle'},
    {title: 'Pro member badge', body: 'A PRO badge on your profile and discovery cards, next to the Verified identity badge.', icon: 'medal'},
  ];
}

function messageFor(error: unknown): string {
  if (error instanceof GatewayUnavailableError) return error.message;
  const status = (error as {status?: number})?.status;
  if (status === 503) return 'Membership billing is not available yet. Please check back soon.';
  if (status === 401) return 'Your sign-in has expired. Please sign in again.';
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong. Please try again.';
}

export function MembershipScreen({hooks = defaultHooks}: {hooks?: MembershipHooks}) {
  const navigation = useNavigation();
  const tabBarHeight = useBottomTabBarHeight();
  const cache = useQueryClient();
  const toast = useProToast();
  const [failed, setFailed] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [activating, setActivating] = useState(false);
  const query = useQuery({queryKey: ['membership'], queryFn: hooks.load, retry: 1});
  const refresh = () => {
    // Membership flips dues math (member rate/room from server terms), so the dues and
    // profile screens must reload with it — otherwise Dues keeps the
    // pre-member blocked UI after subscribing.
    void cache.invalidateQueries({queryKey: ['membership']});
    void cache.invalidateQueries({queryKey: ['pro-dues']});
    void cache.invalidateQueries({queryKey: ['professional-profile']});
  };

  // After a successful GPay payment the first charge still needs seconds to
  // land at Razorpay. Poll confirm (then the plain status as a webhook may
  // have flipped it) instead of stranding the user on an error.
  const pollActivation = async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 4000));
      try {
        const view = await hooks.confirm();
        if (view.effective) {
          setActivating(false); setFailed(null); setCancelled(false); refresh();
          toast('Pro membership is active.', 'success');
          return;
        }
        if (view.status === 'PAST_DUE') {
          setActivating(false);
          setFailed('The membership payment failed at Razorpay. No money was taken — subscribe again to try with a fresh checkout.');
          refresh();
          return;
        }
      } catch (error) {
        if (!(error instanceof Error) || !/still confirming/i.test(error.message)) {
          setActivating(false);
          setFailed(messageFor(error));
          return;
        }
      }
    }
    try {
      const view = await hooks.load();
      if (view.effective) {
        setActivating(false); setFailed(null); setCancelled(false); refresh();
        toast('Pro membership is active.', 'success');
        return;
      }
    } catch {
      // Fall through to the wait-and-reopen message below.
    }
    setActivating(false);
    setFailed('Payment is still confirming at Razorpay. Wait a minute, then reopen this screen — do not pay again.');
  };

  const settleSubscribe = (view: MembershipView) => {
    if (view.effective) {
      setFailed(null); setCancelled(false); refresh();
      toast('Pro membership is active.', 'success');
      return;
    }
    if (view.status === 'PAST_DUE') {
      setFailed('The membership payment failed at Razorpay. No money was taken — subscribe again to try with a fresh checkout.');
      refresh();
      return;
    }
    setFailed(null); setActivating(true); refresh();
    void pollActivation();
  };

  const subscribe = useMutation({mutationFn: async () => {
    const order = await hooks.subscribe();
    if ((order.effective && !order.shortUrl) || !order.subscriptionId) return hooks.confirm();
    await (hooks.checkout ?? openCheckout)({keyId: order.keyId, subscriptionId: order.subscriptionId,
      currency: order.currency, name: 'NAHTREEK Pro', description: 'Pro membership (monthly)'});
    return hooks.confirm();
  }, onSuccess: settleSubscribe,
  onError: error => {
    if (error instanceof CheckoutCancelledError) { setCancelled(true); setFailed(null); refresh(); return; }
    setCancelled(false);
    setFailed(messageFor(error));
  }});

  const cancel = useMutation({mutationFn: () => hooks.cancel(),
    onSuccess: view => {
      setFailed(null); setCancelled(false); setActivating(false); refresh();
      toast(view.status === 'NONE' ? 'Checkout cancelled. Nothing was charged.' : 'Membership cancelled. Benefits stay until the paid period ends.', 'success');
    },
    onError: error => setFailed(messageFor(error))});

  const startCancel = (pending: boolean) => Alert.alert(pending ? 'Cancel this checkout?' : 'Cancel membership?',
    pending ? 'The started payment will be stopped. Nothing is charged until the Razorpay authorization completes.'
      : 'Your benefits continue until the paid period ends. You can resubscribe anytime.',
    pending ? [{text: 'Keep checkout', style: 'cancel'}, {text: 'Cancel checkout', style: 'destructive', onPress: () => cancel.mutate()}]
      : [{text: 'Keep membership', style: 'cancel'}, {text: 'Cancel membership', style: 'destructive', onPress: () => cancel.mutate()}]);

  const busy = subscribe.isPending || cancel.isPending || activating;
  const view = query.data;
  const endDate = view?.currentPeriodEnd ? new Date(view.currentPeriodEnd).toLocaleDateString('en-IN', {day: 'numeric', month: 'short', year: 'numeric'}) : null;

  return <View style={styles.root}>
    <ScreenHeader title="Pro membership" subtitle="Lower fees and higher visibility" onBack={() => navigation.goBack()} />
    <ScrollView contentContainerStyle={styles.body}>
      {query.isPending ? <ScreenLoading label="Loading your membership…" /> : null}
      {query.isError ? <>
        <EmptyState icon="cloud-off-outline" title="Membership could not load" message="Check your connection and try again." />
        <Pressable accessibilityRole="button" disabled={query.isFetching} onPress={() => void query.refetch()} style={styles.retry}>
          <Text style={styles.retryText}>{query.isFetching ? 'Checking…' : 'Try again'}</Text>
        </Pressable>
      </> : null}
      {view && !view.effective ? <View style={styles.card}>
        <Image source={require('../assets/professionals/engineer-work-banner-v1.png')} style={styles.heroImage} resizeMode="cover" accessibilityLabel="Professional at work on a home site" />
        <View style={styles.heroRow}>
          <ProIconChip name="crown" size={58} iconSize={30} />
          <Text style={styles.price}>{inr(view.feePaisa)}<Text style={styles.perMonth}>/month</Text></Text>
        </View>
        {view.status === 'PAST_DUE' ? <Text style={styles.warning}>Your last membership payment failed. Subscribe again to restore benefits with a fresh month.</Text> : null}
        {benefitsFor(view.terms).map(benefit => <View key={benefit.title} style={styles.benefit}>
          <ProIconChip name={benefit.icon} size={44} iconSize={23} />
          <View style={styles.benefitCopy}>
            <Text style={styles.benefitTitle}>{benefit.title}</Text>
            <Text style={styles.text}>{benefit.body}</Text>
          </View>
        </View>)}
        {activating ? <View style={styles.activating}>
          <ActivityIndicator size="small" color={ProColors.primary} />
          <Text style={styles.text}>Payment received — activating your membership…</Text>
        </View> : null}
        {view.status === 'PENDING' && !activating ? <>
          <Text style={styles.small}>A payment was started but has not finished. Complete it above, or cancel the checkout to start fresh — nothing is charged until the Razorpay authorization completes.</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel this checkout" disabled={busy}
            onPress={() => startCancel(true)} style={[styles.secondaryButton, busy && {opacity: 0.5}]}>
            <Text style={styles.secondaryButtonText}>{cancel.isPending ? 'Cancelling…' : 'Cancel this checkout'}</Text>
          </Pressable>
        </> : null}
        <Text style={styles.small}>Recurring autopay via Razorpay (UPI, cards and netbanking). Cancel anytime; benefits run until the paid month ends.</Text>
      </View> : null}
      {view?.effective ? <View style={styles.card}>
        <View style={styles.activeBadge}><Text style={styles.activeBadgeText}>PRO MEMBER</Text></View>
        <View style={styles.heroRow}>
          <ProIconChip name="check-decagram" tone="green" size={52} iconSize={28} />
          <Text style={[styles.heading, styles.flex]}>Your Pro benefits are active</Text>
        </View>
        <Text style={styles.text}>First job each month free, {pct(view.terms.memberFeeBps)} commission after that, {inr(view.terms.memberDuesBlockPaisa)} dues room, top discovery placement and the member badge{endDate ? ` through ${endDate}` : ''}.</Text>
        {(view.lifetimeSavingsPaisa ?? 0) > 0 ? <View style={styles.savings}>
          <Text style={styles.savingsTitle}>You have saved {inr(view.lifetimeSavingsPaisa ?? 0)} so far</Text>
          <Text style={styles.savingsBody}>{view.jobsAtMemberRate ?? 0} {(view.jobsAtMemberRate ?? 0) === 1 ? 'job' : 'jobs'} billed below the {pct(view.terms.standardFeeBps)} standard rate.</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="View commission dues" onPress={() => (navigation as {navigate: (route: string) => void}).navigate('Dues')} style={styles.savingsLink}>
            <Text style={styles.savingsLinkText}>View commission dues</Text>
          </Pressable>
        </View> : null}
        {view.cancelAtPeriodEnd ? <>
          <Text style={styles.text}>You cancelled renewal. Benefits end {endDate ?? 'at the period end'}; resubscribe anytime after.</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="View commission dues" disabled={busy}
            onPress={() => (navigation as {navigate: (route: string) => void}).navigate('Dues')} style={[styles.secondaryButton, busy && {opacity: 0.5}]}>
            <Text style={styles.secondaryButtonText}>View commission dues</Text>
          </Pressable>
        </>
        : <Pressable accessibilityRole="button" accessibilityLabel="Cancel membership" disabled={busy}
          onPress={() => startCancel(false)} style={[styles.secondaryButton, busy && {opacity: 0.5}]}>
          <Text style={styles.secondaryButtonText}>{cancel.isPending ? 'Cancelling…' : 'Cancel membership'}</Text>
        </Pressable>}
      </View> : null}
      {cancelled ? <Text style={styles.text}>Checkout cancelled. Nothing was charged — subscribe whenever you are ready.</Text> : null}
      {failed ? <View accessibilityRole="alert" style={styles.actionError}><Text style={styles.error}>{failed}</Text></View> : null}
    </ScrollView>
    {view && !view.effective && !activating ? <View style={[styles.stickyBar, {paddingBottom: tabBarHeight + ProSpacing.md}]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Subscribe to Pro membership" accessibilityState={{disabled: busy, busy: subscribe.isPending}}
        disabled={busy} onPress={() => subscribe.mutate()} style={[styles.button, busy && {opacity: 0.5}]}>
        <Text style={styles.buttonText}>{subscribe.isPending ? 'Opening secure checkout…' : view.status === 'PENDING' ? 'Complete authorization' : `Subscribe for ${inr(view.feePaisa)}/month`}</Text>
      </Pressable>
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: ProColors.background},
  flex: {flex: 1},
  body: {padding: ProSpacing.lg, gap: ProSpacing.md},
  card: {backgroundColor: ProColors.surface, borderRadius: ProRadius.card, padding: ProSpacing.lg, gap: ProSpacing.md},
  heroImage: {width: '100%', height: 120, borderRadius: ProRadius.input},
  stickyBar: {backgroundColor: ProColors.surface, borderTopWidth: 1, borderTopColor: ProColors.border, padding: ProSpacing.md},
  heroRow: {flexDirection: 'row', alignItems: 'center', gap: ProSpacing.md},
  price: {fontSize: 34, fontWeight: '800', color: ProColors.text},
  perMonth: {fontSize: 16, fontWeight: '600', color: ProColors.muted},
  benefit: {flexDirection: 'row', alignItems: 'center', gap: ProSpacing.md},
  benefitCopy: {flex: 1, gap: 2},
  benefitTitle: {fontSize: 16, fontWeight: '700', color: ProColors.text},
  text: {fontSize: 15, lineHeight: 22, color: ProColors.text},
  small: {fontSize: 13, lineHeight: 19, color: ProColors.muted},
  warning: {fontSize: 14, lineHeight: 20, color: ProColors.warning, backgroundColor: ProColors.warningSoft, padding: 10, borderRadius: 10},
  heading: {...ProType.card, color: ProColors.text},
  button: {backgroundColor: ProColors.primary, borderRadius: ProRadius.input, minHeight: 52, padding: 14, justifyContent: 'center'},
  buttonText: {color: '#FFFFFF', fontWeight: '700', textAlign: 'center', fontSize: 16},
  secondaryButton: {borderRadius: ProRadius.input, minHeight: 50, padding: 12, justifyContent: 'center', borderWidth: 1, borderColor: ProColors.muted},
  secondaryButtonText: {color: ProColors.text, fontWeight: '700', textAlign: 'center'},
  activating: {flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: ProColors.successSoft, padding: 12, borderRadius: 12},
  retry: {alignItems: 'center', paddingVertical: 8},
  retryText: {fontSize: 14, fontWeight: '700', color: ProColors.primary},
  actionError: {padding: 12, borderRadius: 12, backgroundColor: ProColors.errorSoft},
  error: {color: ProColors.error, lineHeight: 21},
  activeBadge: {alignSelf: 'flex-start', backgroundColor: ProColors.primary, borderRadius: ProRadius.pill, paddingHorizontal: 12, paddingVertical: 6},
  activeBadgeText: {color: '#FFFFFF', fontWeight: '800', fontSize: 12, letterSpacing: 1},
  savings: {backgroundColor: ProColors.successSoft, borderRadius: ProRadius.input, padding: ProSpacing.md, gap: 2},
  savingsTitle: {fontSize: 15, fontWeight: '800', color: ProColors.success},
  savingsBody: {fontSize: 15, lineHeight: 22, color: ProColors.success},
  savingsLink: {marginTop: 4, alignSelf: 'flex-start'},
  savingsLinkText: {fontSize: 15, fontWeight: '800', color: ProColors.success, textDecorationLine: 'underline'},
});
