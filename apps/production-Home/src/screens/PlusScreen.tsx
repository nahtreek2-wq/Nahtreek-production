import React, {useEffect, useRef, useState} from 'react';
import {ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {BorderRadius, Colors, Spacing, Typography} from '@nahtreek/design-system';
import {AppHeader, Button, ErrorState, Icon, ICONS} from '../components/ui';
import {ClientColors} from '../design-system/tokens';
import {
  activateDemoAi,
  cancelAiSubscription,
  confirmAiSubscription,
  fetchAiPlan,
  fetchAiSubscription,
  isConfirmingError,
  subscribeAi,
  type AiPlanView,
  type AiSubscriptionView,
} from '../services/aiBilling';
import {CheckoutCancelledError, checkoutContact, checkoutEmail} from '../../../../packages/mobile-booking/razorpayGateway';
import {confirmDialog} from '../stores/confirm';
import {useSessionStore} from '../stores/session';
import {useToast} from '../stores/toast';
import {runtimeConfig} from '../config/runtime';
import {inr, inrMonth} from '../utils/format';

export type PlusHooks = {
  load: () => Promise<AiSubscriptionView>;
  plan: () => Promise<AiPlanView>;
  subscribe: (prefill?: {contact?: string; email?: string}) => Promise<AiSubscriptionView>;
  confirm: () => Promise<AiSubscriptionView>;
  cancel: () => Promise<AiSubscriptionView>;
  demoActivate: () => Promise<AiSubscriptionView>;
};

const defaultHooks: PlusHooks = {
  load: fetchAiSubscription,
  plan: fetchAiPlan,
  subscribe: subscribeAi,
  confirm: confirmAiSubscription,
  cancel: cancelAiSubscription,
  demoActivate: activateDemoAi,
};

function benefitsFor(plan: AiPlanView | null, billing: AiSubscriptionView | null): string[] {
  const discount = plan ? `${plan.consultDiscountBps / 100}% off engineer consultations (up to ${inr(plan.consultDiscountCapPaisa)})`
    : 'Engineer consult discounts on every booking';
  const slaMinutes = plan ? Math.max(1, Math.round(plan.acceptWindowMs / 60000)) : 15;
  const freeChats = plan?.freeMessages ?? billing?.freeQuota ?? 5;
  return [
    `Unlimited AI chats, plans and photo analysis (${freeChats} free chats included)`,
    'Step-by-step project plans you can share',
    'Faster home service: late pros pay penalties on your jobs',
    `${slaMinutes}-minute accept promise on home services`,
    discount,
    'Plus badge professionals see on your requests',
    'Priority review if you report a payment problem',
  ];
}

function messageFor(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong. Please try again.';
}

// Full Plus membership manager: every state (none, pending, past-due,
// active, cancelled tail, expired) with subscribe, complete, resubscribe
// and cancel. The AI planner keeps its quick banner; this is the desk.
export function PlusScreen({hooks = defaultHooks}: {hooks?: PlusHooks}) {
  const navigation = useNavigation();
  const cache = useQueryClient();
  const toast = useToast();
  const [failed, setFailed] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);
  const [activationAttempt, setActivationAttempt] = useState(0);
  const [checkingNow, setCheckingNow] = useState(false);
  const pollToken = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pollToken.current += 1;
    };
  }, []);
  const query = useQuery({queryKey: ['plus-subscription'], queryFn: hooks.load, retry: 1});
  const planQuery = useQuery({queryKey: ['plus-plan'], queryFn: hooks.plan, retry: 1, staleTime: 5 * 60 * 1000});
  const refresh = () => {
    void cache.invalidateQueries({queryKey: ['plus-subscription']});
  };

  const ACTIVATION_CHECKS = 8;
  const pollActivation = async () => {
    const token = pollToken.current;
    const alive = () => mounted.current && pollToken.current === token;
    for (let attempt = 1; attempt <= ACTIVATION_CHECKS; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 4000));
      if (!alive()) return;
      setActivationAttempt(attempt);
      try {
        const view = await hooks.confirm();
        if (!alive()) return;
        if (view.effective) {
          setActivating(false); setFailed(null); refresh();
          toast('NAHTREEK Plus is active.', 'success');
          return;
        }
      } catch (error) {
        if (!alive()) return;
        if (!isConfirmingError(error)) {
          setActivating(false);
          setFailed(messageFor(error));
          return;
        }
      }
    }
    if (!alive()) return;
    setActivating(false);
    setFailed('Payment is still confirming at Razorpay. Wait a minute, then tap Check now — do not pay again.');
    refresh();
  };
  const beginActivation = () => {
    pollToken.current += 1;
    setActivationAttempt(0);
    setFailed(null);
    setActivating(true);
    refresh();
    void pollActivation();
  };
  const checkActivationNow = () => {
    if (checkingNow) return;
    setCheckingNow(true);
    void (async () => {
      try {
        const view = await hooks.confirm();
        if (!mounted.current) return;
        if (view.effective) {
          pollToken.current += 1;
          setActivating(false); setFailed(null); refresh();
          toast('NAHTREEK Plus is active.', 'success');
        }
      } catch (error) {
        if (mounted.current && !isConfirmingError(error)) setFailed(messageFor(error));
      } finally {
        if (mounted.current) setCheckingNow(false);
      }
    })();
  };

  const phoneNumber = useSessionStore(state => state.user?.phoneNumber);
  const accountEmail = useSessionStore(state => state.user?.email);
  const settleSubscribe = (view: AiSubscriptionView) => {
    if (view.effective) {
      setFailed(null); refresh();
      toast('NAHTREEK Plus is active.', 'success');
      return;
    }
    beginActivation();
  };
  const subscribe = useMutation({mutationFn: () => hooks.subscribe(
    {contact: checkoutContact(phoneNumber), email: checkoutEmail(accountEmail)}),
  onSuccess: settleSubscribe,
  onError: error => {
    if (error instanceof CheckoutCancelledError) { setFailed(null); refresh(); return; }
    if (isConfirmingError(error)) { beginActivation(); return; }
    setFailed(messageFor(error));
  }});

  const cancel = useMutation({mutationFn: () => hooks.cancel(),
    onSuccess: view => {
      pollToken.current += 1;
      setFailed(null); setActivating(false); refresh();
      toast(view.status === 'NONE' ? 'Checkout cancelled. Nothing was charged.'
        : 'Plus cancelled. Benefits stay until the paid period ends.', 'success');
    },
    onError: error => setFailed(messageFor(error))});
  const startCancel = (pending: boolean) => {
    void confirmDialog({title: pending ? 'Cancel this checkout?' : 'Cancel Plus?',
      message: pending ? 'The started payment will be stopped. Nothing is charged until the Razorpay authorization completes.'
        : 'You keep unlimited AI until the paid period ends. You can resubscribe anytime.',
      confirmLabel: pending ? 'Cancel checkout' : 'Cancel Plus',
      cancelLabel: pending ? 'Keep checkout' : 'Keep Plus', destructive: true}).then(ok => {
      if (ok) cancel.mutate();
    });
  };

  const demo = useMutation({mutationFn: () => hooks.demoActivate(),
    onSuccess: () => { setFailed(null); refresh(); toast('Free preview access is active.', 'success'); },
    onError: error => setFailed(messageFor(error))});

  const busy = subscribe.isPending || cancel.isPending || activating || demo.isPending;
  const view = query.data;
  const plan = planQuery.data ?? null;
  const price = plan ? inrMonth(plan.feePaisa) : view ? inrMonth(view.feePaisa) : 'NAHTREEK Plus';
  const endDate = view?.currentPeriodEnd
    ? new Date(view.currentPeriodEnd).toLocaleDateString('en-IN', {day: 'numeric', month: 'short', year: 'numeric'})
    : null;
  const quotaLeft = view && !view.effective ? Math.max(0, view.freeQuota - view.freeUsed) : null;

  return (
    <View style={styles.root}>
      <AppHeader title="NAHTREEK Plus" subtitle="Unlimited AI and faster bookings" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={refresh}
            tintColor={Colors.navyDeep}
            colors={[Colors.navyDeep]}
          />
        }>
        {query.isPending ? (
          <View style={styles.loading}>
            <ActivityIndicator size="small" color={Colors.navyMid} />
            <Text style={styles.loadingText}>Loading your Plus membership…</Text>
          </View>
        ) : null}
        {query.isError ? (
          <ErrorState
            title="Plus could not load"
            message="Check your connection and try again."
            actionLabel={query.isFetching ? 'Checking…' : 'Try again'}
            onAction={() => void query.refetch()}
          />
        ) : null}
        {view && !view.effective ? (
          <View style={styles.card}>
            <View style={styles.priceRow}>
              <View style={styles.plusBadge}>
                <Icon name={ICONS.ai} size={26} color={Colors.white} />
              </View>
              <Text style={styles.price}>{price}</Text>
            </View>
            {view.status === 'PAST_DUE' ? (
              <Text style={styles.warning}>Your last Plus payment failed and no money was taken. Subscribe again to restore benefits with a fresh month.</Text>
            ) : null}
            {quotaLeft !== null && quotaLeft > 0 ? (
              <Text style={styles.quota}>{quotaLeft === 1 ? '1 free AI chat left' : `${quotaLeft} free AI chats left`} — then Plus keeps everything unlimited.</Text>
            ) : null}
            {benefitsFor(plan, view).map(benefit => (
              <View key={benefit} style={styles.benefit}>
                <Icon name={ICONS.checkCircle} size={18} color={Colors.success} />
                <Text style={styles.benefitText}>{benefit}</Text>
              </View>
            ))}
            {activating ? (
              <View style={styles.activating}>
                <ActivityIndicator size="small" color={Colors.navyMid} />
                <View style={styles.activatingCopy}>
                  <Text style={styles.text}>Payment received — activating Plus…</Text>
                  <Text style={styles.small}>
                    {activationAttempt > 0 ? `Checking confirmation ${activationAttempt} of ${ACTIVATION_CHECKS}…`
                      : 'Contacting Razorpay for the first confirmation…'}
                  </Text>
                  <Pressable accessibilityRole="button" accessibilityLabel="Check activation now"
                    disabled={checkingNow || cancel.isPending} onPress={checkActivationNow} hitSlop={8}>
                    <Text style={styles.link}>{checkingNow ? 'Checking…' : 'Check now'}</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
            {view.status === 'PENDING' && !activating ? (
              <Text style={styles.small}>A payment was started but has not finished. Complete it below, or cancel the checkout to start fresh — nothing is charged until the Razorpay authorization completes.</Text>
            ) : null}
            <Text style={styles.small}>Recurring autopay via Razorpay (UPI and cards). Cancel anytime; benefits run until the paid month ends.</Text>
          </View>
        ) : null}
        {view?.effective ? (
          <View style={styles.card}>
            <View style={styles.activeBadge}><Text style={styles.activeBadgeText}>PLUS MEMBER</Text></View>
            <Text style={styles.heading}>Your Plus benefits are active</Text>
            <Text style={styles.text}>
              Unlimited AI chats, plans and photo analysis, faster home service and engineer consult discounts
              {endDate ? ` through ${endDate}` : ''}.
            </Text>
            {view.cancelAtPeriodEnd ? (
              <>
                <Text style={styles.text}>You cancelled renewal. Benefits end {endDate ?? 'at the period end'}. Resubscribing starts the new cycle then — no double charge.</Text>
                <Button
                  label={subscribe.isPending ? 'Opening secure checkout…' : `Resubscribe for ${price}`}
                  loadingLabel="Opening secure checkout…"
                  onPress={() => subscribe.mutate()}
                  loading={subscribe.isPending}
                  disabled={busy}
                />
              </>
            ) : (
              <Button
                label={cancel.isPending ? 'Cancelling…' : 'Cancel Plus'}
                variant="secondary"
                onPress={() => startCancel(false)}
                loading={cancel.isPending}
                disabled={busy}
              />
            )}
          </View>
        ) : null}
        {failed ? (
          <View accessibilityRole="alert" style={styles.actionError}>
            <Text style={styles.error}>{failed}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Check activation now"
              disabled={checkingNow} onPress={checkActivationNow} hitSlop={8}>
              <Text style={styles.link}>{checkingNow ? 'Checking…' : 'Check now'}</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
      {view && !view.effective && !activating ? (
        <View style={styles.stickyBar}>
          <Button
            label={subscribe.isPending ? 'Opening secure checkout…'
              : view.status === 'PENDING' ? 'Complete authorization'
              : view.status === 'PAST_DUE' ? `Subscribe again for ${price}`
              : `Subscribe for ${price}`}
            loadingLabel="Opening secure checkout…"
            onPress={() => subscribe.mutate()}
            loading={subscribe.isPending}
            disabled={busy}
          />
          {view.status === 'PENDING' ? (
            <Button
              label={cancel.isPending ? 'Cancelling…' : 'Cancel this checkout'}
              variant="secondary"
              onPress={() => startCancel(true)}
              loading={cancel.isPending}
              disabled={busy}
            />
          ) : null}
          {runtimeConfig.environment !== 'production' ? (
            <Button
              label="Activate free access"
              variant="secondary"
              onPress={() => demo.mutate()}
              loading={demo.isPending}
              disabled={busy}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: ClientColors.lightBackground},
  body: {padding: Spacing.lg, gap: Spacing.md},
  card: {backgroundColor: Colors.surface, borderRadius: BorderRadius.xl, padding: Spacing.lg, gap: Spacing.md},
  loading: {flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.lg},
  loadingText: {...Typography.body, color: Colors.slate600},
  priceRow: {flexDirection: 'row', alignItems: 'center', gap: Spacing.md},
  plusBadge: {width: 52, height: 52, borderRadius: 26, backgroundColor: Colors.navyDeep,
    alignItems: 'center', justifyContent: 'center'},
  price: {fontSize: 30, fontWeight: '800', color: Colors.slate900},
  benefit: {flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm},
  benefitText: {flex: 1, fontSize: 15, lineHeight: 22, color: Colors.slate900},
  quota: {fontSize: 14, lineHeight: 20, fontWeight: '700', color: Colors.navyDeep,
    backgroundColor: Colors.infoBg, padding: 10, borderRadius: 10},
  warning: {fontSize: 14, lineHeight: 20, color: Colors.warning, backgroundColor: Colors.warningBg,
    padding: 10, borderRadius: 10},
  heading: {...Typography.h3, color: Colors.slate900},
  text: {fontSize: 15, lineHeight: 22, color: Colors.slate900},
  small: {fontSize: 13, lineHeight: 19, color: Colors.slate500},
  activating: {flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: Colors.successBg, padding: 12, borderRadius: 12},
  activatingCopy: {flex: 1, gap: 4},
  link: {fontSize: 14, fontWeight: '800', color: Colors.navyDeep, textDecorationLine: 'underline'},
  actionError: {padding: 12, borderRadius: 12, backgroundColor: Colors.errorBg, gap: 8},
  error: {color: Colors.error, lineHeight: 21},
  activeBadge: {alignSelf: 'flex-start', backgroundColor: Colors.navyDeep, borderRadius: BorderRadius.full,
    paddingHorizontal: 12, paddingVertical: 6},
  activeBadgeText: {color: Colors.white, fontWeight: '800', fontSize: 12, letterSpacing: 1},
  stickyBar: {backgroundColor: Colors.surface, borderTopWidth: 1, borderTopColor: Colors.slate200,
    padding: Spacing.md, gap: Spacing.sm},
});
