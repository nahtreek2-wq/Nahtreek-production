import React, {useEffect, useRef, useState} from 'react';
import {ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {Colors} from '../design-system/src';
import {CheckoutCancelledError, GatewayUnavailableError, openCheckout} from './razorpayGateway';
import type {CheckoutInput, CheckoutResult} from './razorpayGateway';
import {useCheckoutWatchdog} from './useCheckoutWatchdog';

export type PaymentStatusView = {status: string; amountPaisa: number; currency: string; paidAt?: string | null; releasedAt?: string | null; refundedAt?: string | null};
export type CreatedOrder = {paymentId: string; keyId: string; razorpayOrderId: string; amountPaisa: number; currency: string; plusDiscountPaisa?: number};
export type VerifiedCheckout = {razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string};
export type PaymentHooks = {
  createOrder: () => Promise<CreatedOrder>;
  verify: (result: VerifiedCheckout) => Promise<PaymentStatusView>;
  loadStatus: () => Promise<PaymentStatusView | null>;
  checkout?: (input: CheckoutInput) => Promise<CheckoutResult>;
  dispute?: (reason: string) => Promise<PaymentStatusView>;
  // Server-to-Razorpay reconciliation for lost checkout callbacks (SDK
  // error-with-success-behind, hung bridge promise). Optional so older
  // callers keep working; when present it runs before every checkout.
  sync?: () => Promise<unknown>;
};

export type PlusDiscount = {percent: number; capPaisa: number};
type Props = {requestId: string; requestKind?: 'service' | 'engineer'; quoteAmount: number; hooks: PaymentHooks;
  receiptEmail?: string | null; onSaveReceiptEmail?: (email: string) => Promise<unknown>; isPlus?: boolean;
  plusDiscount?: PlusDiscount | null};

const PENDING = ['ORDER_CREATED', 'REFUND_PENDING', 'RELEASE_PENDING'];
const rupees = (paisa: number) => `₹${(paisa / 100).toLocaleString('en-IN')}`;

function messageFor(error: unknown): string {
  if (error instanceof GatewayUnavailableError) return error.message;
  const status = (error as {status?: number})?.status;
  if (status === 503) return 'Online payments are not available yet. Work can proceed; you will be asked to pay once payments open.';
  if (status === 409) {
    const detail = error instanceof Error ? error.message : '';
    if (/mismatch/i.test(detail)) return 'The received payment did not match the quote. Support will review it — the money stays frozen.';
    if (/closed|no longer be paid/i.test(detail)) return 'This booking is closed and can no longer be paid.';
    if (/pay-at-home|paid directly/i.test(detail)) return detail;
    if (/quote changed|fee changed/i.test(detail)) return 'The quote changed after payment. Support will review it.';
    return 'This payment was already processed. Refreshing the status.';
  }
  if (status === 401) return 'Your sign-in has expired. Please sign in again.';
  if (error instanceof Error && error.message) return error.message;
  return 'The payment could not be completed. Check the booking status before retrying.';
}

// Paid or terminal states: opening another checkout can only orphan money.
const SETTLED = ['PAID', 'HELD', 'RELEASE_PENDING', 'RELEASED', 'REFUND_PENDING', 'REFUNDED', 'DISPUTED'];
const notCaptured = (error: unknown) =>
  (error as {status?: number})?.status === 409 && error instanceof Error && /not captured yet/i.test(error.message);

export function PaymentSection({requestId, requestKind = 'service', quoteAmount, hooks, receiptEmail, onSaveReceiptEmail, isPlus, plusDiscount}: Props) {
  const cache = useQueryClient();
  const [failed, setFailed] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [checkoutStalled, setCheckoutStalled] = useState(false);
  const [checkoutAttempt, setCheckoutAttempt] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [confirmAttempt, setConfirmAttempt] = useState(0);
  const [checkingNow, setCheckingNow] = useState(false);
  const [confirmPayload, setConfirmPayload] = useState<VerifiedCheckout | null>(null);
  const [checking, setChecking] = useState(false);
  // The confirm poll must never outlive the screen or fight a manual check:
  // the token invalidates stale loops, the mounted flag stops work after
  // unmount (leaving and returning shows the fresh query state).
  const pollToken = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pollToken.current += 1;
    };
  }, []);
  const CONFIRM_CHECKS = 10;
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeReason, setDisputeReason] = useState('');
  const [emailDraft, setEmailDraft] = useState('');
  const [emailWarning, setEmailWarning] = useState<string | null>(null);
  const engineer = requestKind === 'engineer';
  // Receipt capture: offered only while unpaid and only when the account has
  // no email yet. A bad address blocks the tap (fixable inline); a failed
  // save never blocks the payment — the receipt is skipped instead.
  const captureEmail = Boolean(onSaveReceiptEmail && !receiptEmail);
  const status = useQuery({queryKey: ['payment', requestKind, requestId], queryFn: hooks.loadStatus, retry: 1,
    refetchInterval: query => (query.state.data && PENDING.includes(query.state.data.status) ? 5000 : false)});
  const refresh = () => {
    void cache.invalidateQueries({queryKey: ['payment', requestKind, requestId]});
    if (engineer) {
      void cache.invalidateQueries({queryKey: ['request-detail', requestId]});
      void cache.invalidateQueries({queryKey: ['requests']});
      void cache.invalidateQueries({queryKey: ['history/me']});
    } else {
      void cache.invalidateQueries({queryKey: ['service-journey', requestId]});
      void cache.invalidateQueries({queryKey: ['service-request']});
      void cache.invalidateQueries({queryKey: ['service-requests']});
      void cache.invalidateQueries({queryKey: ['history/me']});
      void cache.invalidateQueries({queryKey: ['providers']});
    }
  };
  const settlePaid = () => {
    setFailed(null);
    setCancelled(false);
    setConfirming(false);
    void status.refetch();
    refresh();
  };
  // Ask the server what Razorpay actually captured before trusting local
  // state: a checkout that errored (or hung) may still have moved money.
  // Returns the fresh status (null when unknown).
  const reconcile = async (): Promise<PaymentStatusView | null> => {
    try {
      await hooks.sync?.();
    } catch {
      // Sync failing must never block the checkout — the refetch below
      // decides from the last known server truth instead.
    }
    const fresh = await status.refetch();
    return fresh.data ?? null;
  };
  // Razorpay capture can lag the checkout success by seconds. A 409 'not
  // captured yet' means money left the account but the capture is pending —
  // poll verify instead of inviting a second checkout for the same order.
  // The loop reports live progress and yields to manual checks — a dead
  // wait with a hidden pay button reads as a frozen screen.
  const pollSettlement = async (payload: VerifiedCheckout) => {
    const token = pollToken.current;
    const alive = () => mounted.current && pollToken.current === token;
    for (let attempt = 1; attempt <= CONFIRM_CHECKS; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 4000));
      if (!alive()) return;
      setConfirmAttempt(attempt);
      try {
        await hooks.verify(payload);
        if (!alive()) return;
        settlePaid();
        return;
      } catch (error) {
        if (!alive()) return;
        if (!notCaptured(error)) {
          setConfirming(false);
          setCancelled(false);
          setFailed(messageFor(error));
          void status.refetch();
          return;
        }
      }
    }
    if (!alive()) return;
    const fresh = await status.refetch();
    if (!alive()) return;
    if (fresh.data && SETTLED.includes(fresh.data.status)) {
      settlePaid();
      return;
    }
    setConfirming(false);
    setFailed('Payment is still confirming at Razorpay. Wait a minute, then reopen this booking — do not pay again.');
    void status.refetch();
  };
  const beginConfirming = (payload: VerifiedCheckout) => {
    pollToken.current += 1;
    setConfirmPayload(payload);
    setConfirmAttempt(0);
    setFailed(null);
    setCancelled(false);
    setConfirming(true);
    void status.refetch();
  };
  // One extra verify right now. A success settles immediately, anything
  // else leaves the loop running — the tap can never double-charge.
  const checkNow = () => {
    if (checkingNow || !confirmPayload) return;
    setCheckingNow(true);
    void (async () => {
      try {
        await hooks.verify(confirmPayload);
        if (!mounted.current) return;
        pollToken.current += 1;
        settlePaid();
      } catch {
        // Still lagging or unreachable: the background loop keeps going.
      } finally {
        if (mounted.current) setCheckingNow(false);
      }
    })();
  };
  const settleVerify = (payload: VerifiedCheckout) => {
    hooks.verify(payload).then(settlePaid, error => {
      if (notCaptured(error)) {
        beginConfirming(payload);
        void pollSettlement(payload);
        return;
      }
      setCancelled(false);
      setFailed(messageFor(error));
      void status.refetch();
      if (/mismatch/i.test(error instanceof Error ? error.message : '')) setDisputeOpen(true);
    });
  };
  const pay = useMutation({mutationFn: async () => {
    const order = await hooks.createOrder();
    const result = await (hooks.checkout ?? openCheckout)({keyId: order.keyId, orderId: order.razorpayOrderId,
      amountPaisa: order.amountPaisa, currency: order.currency, name: 'NAHTREEK',
      description: engineer ? 'Consultation fee payment' : 'Service booking payment'});
    if (!result.razorpayOrderId || !result.razorpayPaymentId || !result.razorpaySignature)
      throw new Error('The payment response was incomplete. Check the booking status before retrying.');
    return {razorpayOrderId: result.razorpayOrderId, razorpayPaymentId: result.razorpayPaymentId, razorpaySignature: result.razorpaySignature};
  }, onSuccess: payload => {
    // Verify inline so a capture-lag 409 can start polling instead of
    // surfacing as a payment failure with the pay button still showing.
    settleVerify(payload);
  }, onError: error => {
    if (error instanceof CheckoutCancelledError) {
      setCancelled(true);
      setFailed(null);
      void status.refetch();
      return;
    }
    // A checkout error with money behind it (Razorpay error banner over a
    // successful capture) must confirm, not invite a second charge.
    void (async () => {
      const synced = await reconcile();
      if (synced && SETTLED.includes(synced.status)) {
        settlePaid();
        return;
      }
      setCancelled(false);
      setFailed(messageFor(error));
    })();
  }});

  // Last-resort recovery for a lost checkout result: if the user is back on
  // this screen with the pay promise still pending, the result never
  // arrived — reconcile instead of sitting disabled forever. A late real
  // result still flows through the idempotent verify path, so this can
  // never double-charge or swallow a success.
  useCheckoutWatchdog(pay.isPending && !checkoutStalled, () => {
    void (async () => {
      const synced = await reconcile();
      if (!mounted.current) return;
      if (synced && SETTLED.includes(synced.status)) {
        settlePaid();
        return;
      }
      setCancelled(false);
      setCheckoutStalled(true);
    })();
  }, checkoutAttempt);
  const payBusy = pay.isPending && !checkoutStalled;
  const busy = payBusy || status.isFetching || confirming;
  const startPay = async () => {
    setCheckoutStalled(false);
    setCheckoutAttempt(attempt => attempt + 1);
    if (captureEmail && emailDraft.trim()) {
      const value = emailDraft.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        setFailed('Enter a valid email for the receipt, or leave it blank to skip.');
        return;
      }
      try {
        await onSaveReceiptEmail!(value);
        setEmailWarning(null);
        void cache.invalidateQueries({queryKey: ['client-profile']});
      } catch {
        setEmailWarning('Receipt email could not be saved — add it in Profile to get payment receipts.');
      }
    }
    // Verify-before-recreate: the order may have settled since this screen
    // loaded (webhook, another device, or a checkout whose callback was
    // lost). Never open a second checkout for money that already moved.
    const synced = await reconcile();
    if (synced && SETTLED.includes(synced.status)) {
      settlePaid();
      return;
    }
    setFailed(null);
    pay.mutate();
  };
  const payAgain = (label: string, note: string) => <>
    <Text style={s.text}>{note}</Text>
    {captureEmail ? <View style={s.disputeBox}>
      <Text style={s.text}>Receipt email — your payment receipt will be sent here.</Text>
      <TextInput accessibilityLabel="Receipt email" style={s.emailInput} keyboardType="email-address"
        autoCapitalize="none" autoCorrect={false} placeholder="you@example.com"
        value={emailDraft} onChangeText={text => { setEmailDraft(text); setEmailWarning(null); }}
        editable={!pay.isPending} />
    </View> : null}
    {emailWarning ? <Text style={s.text}>{emailWarning}</Text> : null}
    {checkoutStalled ? <Text style={s.stalled}>Checkout was interrupted — nothing was charged. Tap below to try again.</Text> : null}
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled: busy, busy: payBusy}}
      disabled={busy} onPress={() => { void startPay(); }} style={[s.button, busy && {opacity: 0.5}]}>
      <Text style={s.buttonText}>{payBusy ? 'Opening secure payment…' : label}</Text>
    </Pressable>
  </>;
  const dispute = useMutation({mutationFn: (reason: string) => hooks.dispute!(reason),
    onSuccess: () => {
      setFailed(null);
      setDisputeOpen(false);
      setDisputeReason('');
      void status.refetch();
      refresh();
    },
    onError: error => { setFailed(messageFor(error)); void status.refetch(); }});
  const reportProblem = () => {
    if (!hooks.dispute) return null;
    if (!disputeOpen) {
      return <Pressable accessibilityRole="button" accessibilityLabel="Report a problem with this payment"
        onPress={() => { setFailed(null); setDisputeOpen(true); }}>
        <Text style={s.retryText}>Report a problem</Text>
      </Pressable>;
    }
    return <View style={s.disputeBox}>
      <Text style={s.text}>Describe the problem. The money stays frozen while support reviews it.</Text>
      <TextInput accessibilityLabel="Problem description" style={s.disputeInput} multiline numberOfLines={3}
        placeholder="What went wrong? (minimum 10 characters)" value={disputeReason} onChangeText={setDisputeReason}
        editable={!dispute.isPending} />
      <Pressable accessibilityRole="button" accessibilityLabel="Submit problem report"
        accessibilityState={{disabled: dispute.isPending || disputeReason.trim().length < 10}}
        disabled={dispute.isPending || disputeReason.trim().length < 10}
        onPress={() => dispute.mutate(disputeReason.trim())} style={[s.button, (dispute.isPending || disputeReason.trim().length < 10) && {opacity: 0.5}]}>
        <Text style={s.buttonText}>{dispute.isPending ? 'Submitting…' : 'Submit report'}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Cancel problem report"
        disabled={dispute.isPending} onPress={() => { setDisputeOpen(false); setDisputeReason(''); }}>
        <Text style={s.retryText}>Cancel</Text>
      </Pressable>
    </View>;
  };

  let body: React.ReactNode;
  if (status.isPending) {
    body = <View style={s.row}><ActivityIndicator /><Text style={s.text}>Checking payment…</Text></View>;
  } else if (status.isError) {
    body = <>
      <Text style={s.error}>Could not load the payment status.</Text>
      <Pressable accessibilityRole="button" disabled={status.isFetching} onPress={() => void status.refetch()}>
        <Text style={s.retryText}>{status.isFetching ? 'Checking…' : 'Try again'}</Text>
      </Pressable>
    </>;
  } else {
    const view = status.data;
    if (!view || view.status === 'FAILED' || view.status === 'NOT_STARTED') {
      // Plus figures come from the plan endpoint, never literals: without plan
      // data the sentence stays generic instead of quoting wrong numbers.
      const feePaisa = Math.round(quoteAmount * 100);
      // Mirror of server plusDiscountPaisa (payments/commission.ts):
      // min(floor(amount * bps / 10000), cap). The server stays the source of
      // truth at order time; this only aligns the button with what the
      // gateway will actually charge, so the two screens never disagree.
      const discountPaisa = engineer && isPlus && plusDiscount
        ? Math.min(Math.floor((feePaisa * plusDiscount.percent) / 100), plusDiscount.capPaisa)
        : 0;
      const payablePaisa = feePaisa - discountPaisa;
      const plusLine = !isPlus ? '' : plusDiscount
        ? ` Your Plus ${plusDiscount.percent}% discount (up to ${rupees(plusDiscount.capPaisa)}) applies automatically at checkout.`
        : ' Your Plus discount applies automatically at checkout.';
      body = engineer
        ? payAgain(`Pay ${rupees(payablePaisa)} consultation fee`,
            discountPaisa > 0
              ? `Pay ${rupees(payablePaisa)} for the consultation (${rupees(feePaisa)} fee minus your Plus discount). The money is held safely and reaches the engineer after review.`
              : `Pay ${rupees(feePaisa)} for the consultation. The money is held safely and reaches the engineer after review.${plusLine}`)
        : payAgain(`Pay ${rupees(Math.round(quoteAmount * 100))} securely`,
            `Pay ${rupees(Math.round(quoteAmount * 100))} for the approved scope. The money is held safely and reaches the professional only after you confirm the work.`);
    } else if (view.status === 'ORDER_CREATED') {
      const checkStatus = async () => {
        setChecking(true);
        try {
          const synced = await reconcile();
          if (synced && SETTLED.includes(synced.status)) settlePaid();
        } finally {
          setChecking(false);
        }
      };
      body = <>
        {payAgain(`Continue payment of ${rupees(view.amountPaisa)}`,
          `A payment of ${rupees(view.amountPaisa)} was started but not finished. We check its latest status before opening checkout, so you never pay twice.`)}
        {hooks.sync ? <Pressable accessibilityRole="button" accessibilityLabel="Check payment status"
          disabled={busy || checking} onPress={() => void checkStatus()}>
          <Text style={s.retryText}>{checking ? 'Checking…' : 'Already paid? Check status'}</Text>
        </Pressable> : null}
      </>;
    } else if (view.status === 'PAID' || view.status === 'HELD') {
      body = <View style={s.ok}><Text style={s.okTitle}>Paid {rupees(view.amountPaisa)}</Text>
        <Text style={s.text}>{engineer
          ? 'The amount is held safely. It releases to the engineer after review.'
          : 'The amount is held safely. It releases to the professional when you confirm the completed work.'}</Text>
        {reportProblem()}</View>;
    } else if (view.status === 'RELEASE_PENDING') {
      body = <View style={s.row}><ActivityIndicator /><Text style={s.text}>{engineer
        ? `Releasing ${rupees(view.amountPaisa)} to the engineer…`
        : `Work confirmed. Releasing ${rupees(view.amountPaisa)} to the professional…`}</Text></View>;
    } else if (view.status === 'RELEASED') {
      body = <View style={s.ok}><Text style={s.okTitle}>Released {rupees(view.amountPaisa)}</Text>
        <Text style={s.text}>{engineer
          ? 'The engineer received the consultation fee. Thank you.'
          : 'The professional received the payment after your confirmation. Thank you.'}</Text></View>;
    } else if (view.status === 'REFUND_PENDING') {
      body = <View style={s.row}><ActivityIndicator /><Text style={s.text}>A full refund of {rupees(view.amountPaisa)} is on the way to your account.</Text></View>;
    } else if (view.status === 'REFUNDED') {
      body = <Text style={s.text}>Refunded {rupees(view.amountPaisa)} in full. It should reflect in your account shortly.</Text>;
    } else if (view.status === 'DISPUTED') {
      body = <View style={s.ok}><Text style={s.okTitle}>Under review</Text>
        <Text style={s.text}>Support is looking into the reported problem. The {rupees(view.amountPaisa)} stays frozen until they decide.</Text></View>;
    } else if (view.status === 'COLLECTED_UNSETTLED' || view.status === 'SETTLED') {
      body = <View style={s.ok}><Text style={s.okTitle}>Paid directly {rupees(view.amountPaisa)}</Text>
        <Text style={s.text}>This booking was settled directly with the professional. No online payment is needed.</Text></View>;
    } else {
      body = <Text style={s.text}>This payment needs support review. No further action is needed from you right now.</Text>;
    }
  }

  return <View style={s.card}>
    <Text style={s.heading}>Payment</Text>
    {confirming ? <View style={s.confirmingBox}><View style={s.row}><ActivityIndicator /><Text style={s.confirming}>Payment received — confirming with Razorpay. {confirmAttempt > 0 ? `Check ${confirmAttempt} of ${CONFIRM_CHECKS}…` : 'Starting the first check…'}</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel="Check payment now" disabled={checkingNow} onPress={checkNow}>
        <Text style={s.retryText}>{checkingNow ? 'Checking…' : 'Check now — safe, never charges twice'}</Text>
      </Pressable></View> : body}
    {cancelled && !confirming ? <Text style={s.text}>Payment cancelled. No money moved — you can pay whenever you are ready.</Text> : null}
    {failed ? <View accessibilityRole="alert" style={s.actionError}><Text style={s.error}>{failed}</Text></View> : null}
  </View>;
}

const s = StyleSheet.create({
  card: {padding: 16, gap: 12, backgroundColor: Colors.white, borderRadius: 18, borderWidth: 1, borderColor: Colors.slate200},
  heading: {fontSize: 18, fontWeight: '700', color: Colors.navyDeep},
  text: {fontSize: 15, lineHeight: 22, color: Colors.slate800},
  confirming: {fontSize: 15, lineHeight: 22, color: Colors.navyMid, fontWeight: '700', flex: 1},
  error: {color: Colors.error, lineHeight: 21},
  stalled: {fontSize: 14, lineHeight: 20, fontWeight: '700', color: Colors.warning,
    backgroundColor: Colors.warningBg, padding: 12, borderRadius: 12},
  actionError: {padding: 12, gap: 8, borderRadius: 12, backgroundColor: Colors.errorBg},
  retryText: {fontSize: 14, fontWeight: '700', color: Colors.navyMid, paddingVertical: 8},
  button: {backgroundColor: Colors.amber, borderRadius: 12, minHeight: 50, padding: 14, justifyContent: 'center'},
  buttonText: {color: Colors.navyDeep, fontWeight: '700', textAlign: 'center'},
  ok: {backgroundColor: Colors.successBg, padding: 12, borderRadius: 12, gap: 8},
  okTitle: {fontSize: 16, fontWeight: '700', color: Colors.success},
  row: {flexDirection: 'row', alignItems: 'center', gap: 10},
  confirmingBox: {gap: 2, backgroundColor: Colors.successBg, padding: 12, borderRadius: 12},
  disputeBox: {gap: 10, marginTop: 4},
  disputeInput: {minHeight: 80, borderRadius: 12, borderWidth: 1, borderColor: Colors.slate200,
    backgroundColor: Colors.white, padding: 12, fontSize: 15, lineHeight: 22, color: Colors.slate800, textAlignVertical: 'top'},
  emailInput: {minHeight: 50, borderRadius: 12, borderWidth: 1, borderColor: Colors.slate200,
    backgroundColor: Colors.white, paddingHorizontal: 12, fontSize: 15, color: Colors.slate800},
});
