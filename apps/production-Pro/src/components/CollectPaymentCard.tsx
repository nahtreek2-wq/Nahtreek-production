import React, {useState} from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {ProIconChip} from './ProIconChip';
import {api} from '../services/apiClient';
import {useProToast} from '../stores/proToast';
import {PrimaryButton} from '../components/PrimaryButton';
import {
  ProColors,
  ProRadius,
  ProSpacing,
  ProType,
} from '../theme/professionalTheme';

export type CollectStatusView = {
  status: string;
  amountPaisa: number;
  platformFeePaisa: number;
  professionalAmountPaisa: number;
  currency: string;
  collectionMode?: string | null;
};

export type CollectHooks = {
  loadStatus: () => Promise<CollectStatusView | null>;
  declare: (input: {
    amount: number;
    method: 'CASH' | 'UPI';
  }) => Promise<CollectStatusView>;
};

const defaultHooks = (requestId: string): CollectHooks => ({
  loadStatus: () =>
    api
      .get<CollectStatusView>(`/payments/engineer-requests/${requestId}`)
      .catch((error: any) =>
        error?.status === 404 ? null : Promise.reject(error),
      ),
  declare: input =>
    api.post<CollectStatusView>('/payments/engineer-collections', {
      engineerRequestId: requestId,
      ...input,
    }),
});

const rupees = (paisa: number) =>
  `₹${(paisa / 100).toLocaleString('en-IN')}`;

// Order created but never paid is not money in hand: the engineer can still
// declare a direct collection afterwards. A full refund is terminal — the
// money went back to the customer, so the card shows the refund instead of
// inviting a backdated declaration on a closed payment.
const UNPAID_STATUSES = ['NOT_STARTED', 'ORDER_CREATED', 'FAILED'];

export function CollectPaymentCard({
  requestId,
  hooks,
  onViewDues,
}: {
  requestId: string;
  hooks?: CollectHooks;
  onViewDues: () => void;
}) {
  const resolved = hooks ?? defaultHooks(requestId);
  const toast = useProToast();
  const cache = useQueryClient();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'CASH' | 'UPI'>('CASH');
  const [formOpen, setFormOpen] = useState(false);
  const status = useQuery({
    queryKey: ['pro-collect-status', requestId],
    queryFn: resolved.loadStatus,
    retry: 1,
    // The customer may pay inside the app while this screen is open — keep
    // checking until a payment is recorded, then go quiet.
    refetchInterval: query => {
      const view = query.state.data as CollectStatusView | null | undefined;
      return view && !UNPAID_STATUSES.includes(view.status) ? false : 15000;
    },
    refetchIntervalInBackground: false,
  });
  const declare = useMutation({
    mutationFn: resolved.declare,
    onSuccess: data => {
      cache.setQueryData(['pro-collect-status', requestId], data);
      void cache.invalidateQueries({queryKey: ['pro-dues']});
      setFormOpen(false);
      setAmount('');
      toast(
        `Declared ${rupees(data.amountPaisa)}. ${rupees(
          data.platformFeePaisa,
        )} commission moved to your dues.`,
        'success',
      );
    },
    onError: error => {
      toast(
        error instanceof Error
          ? error.message
          : 'Could not record this collection.',
        'error',
      );
    },
  });

  const submit = () => {
    const value = Number(amount.replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(value) || value < 1) {
      toast('Enter the amount you received (minimum ₹1).', 'error');
      return;
    }
    declare.mutate({amount: value, method});
  };

  const view = status.data ?? null;
  const recorded = view && !UNPAID_STATUSES.includes(view.status);

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <ProIconChip name="hand-coin" size={50} iconSize={27} />
        <View style={styles.headerCopy}>
          <Text style={styles.title}>Payment for this job</Text>
          <Text style={styles.hint}>Cash or UPI collected at the customer&apos;s home</Text>
        </View>
      </View>
      {status.isPending ? (
        <View style={styles.loading}>
          <ActivityIndicator size="small" color={ProColors.primary} />
          <Text style={styles.hint}>Checking payment…</Text>
        </View>
      ) : status.isError ? (
        <View style={styles.gap}>
          <Text style={styles.hint}>
            Payment status could not load. Check your connection.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry payment status"
            onPress={() => void status.refetch()}
            style={styles.link}>
            <Text style={styles.linkText}>Try again</Text>
          </Pressable>
        </View>
      ) : recorded ? (
        <RecordedState view={view!} onViewDues={onViewDues} />
      ) : (
        <View style={styles.gap}>
          <Text style={styles.body}>
            No payment recorded yet. If the customer paid inside the app it
            appears here automatically — otherwise declare cash or UPI you
            received directly. Your commission (10%, or 7% for Pro members
            with the first job each month free) moves to dues.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Check again for an in-app payment"
            onPress={() => void status.refetch()}
            style={styles.link}>
            <Text style={styles.linkText}>
              {status.isFetching ? 'Checking…' : 'Check again for an in-app payment'}
            </Text>
          </Pressable>
          {formOpen ? (
            <View style={styles.gap}>
              <Text style={styles.label}>Amount received (₹)</Text>
              <TextInput
                accessibilityLabel="Amount received in rupees"
                style={styles.input}
                placeholder="3500"
                placeholderTextColor={ProColors.muted}
                keyboardType="numeric"
                value={amount}
                onChangeText={setAmount}
                editable={!declare.isPending}
              />
              <View style={styles.methodRow}>
                {(['CASH', 'UPI'] as const).map(option => (
                  <Pressable
                    key={option}
                    accessibilityRole="button"
                    accessibilityLabel={`Collected by ${option === 'CASH' ? 'cash' : 'UPI'}`}
                    accessibilityState={{selected: method === option}}
                    disabled={declare.isPending}
                    onPress={() => setMethod(option)}
                    style={[
                      styles.method,
                      method === option && styles.methodActive,
                    ]}>
                    <MaterialCommunityIcons
                      name={option === 'CASH' ? 'cash' : 'cellphone'}
                      size={22}
                      color={method === option ? ProColors.surface : ProColors.text}
                    />
                    <Text
                      style={[
                        styles.methodText,
                        method === option && styles.methodTextActive,
                      ]}>
                      {option === 'CASH' ? 'Cash' : 'UPI'}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <PrimaryButton
                label={
                  declare.isPending ? 'Recording…' : 'Declare collection'
                }
                loading={declare.isPending}
                onPress={submit}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel collection"
                disabled={declare.isPending}
                onPress={() => setFormOpen(false)}
                style={styles.link}>
                <Text style={styles.linkText}>Not now</Text>
              </Pressable>
            </View>
          ) : (
            <PrimaryButton
              label="I collected cash or UPI"
              onPress={() => setFormOpen(true)}
            />
          )}
        </View>
      )}
    </View>
  );
}

function RecordedState({
  view,
  onViewDues,
}: {
  view: CollectStatusView;
  onViewDues: () => void;
}) {
  if (view.collectionMode === 'AT_HOME') {
    const settled = view.status === 'SETTLED';
    return (
      <View style={styles.stateRow}>
        <ProIconChip name={settled ? 'check-circle' : 'hand-coin'} tone={settled ? 'green' : 'navy'} size={46} iconSize={25} />
        <View style={styles.gapFlex}>
          <Text style={styles.body}>
            {settled
              ? `You declared ${rupees(view.amountPaisa)} collected directly. Commission settled — nothing is due.`
              : `You declared ${rupees(view.amountPaisa)} collected directly. ${rupees(
                  view.platformFeePaisa,
                )} commission is waiting in your dues.`}
          </Text>
          {!settled ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="View commission dues"
              onPress={onViewDues}
              style={styles.link}>
              <Text style={styles.linkText}>View commission dues</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  }
  if (view.status === 'RELEASED') {
    return (
      <View style={styles.stateRow}>
        <ProIconChip name="bank-check" tone="green" size={46} iconSize={25} />
        <Text style={[styles.body, styles.gapFlex]}>
          Paid online {rupees(view.amountPaisa)} — your{' '}
          {rupees(view.professionalAmountPaisa)} share was released to your
          account.
        </Text>
      </View>
    );
  }
  if (view.status === 'DISPUTED') {
    return (
      <View style={styles.stateRow}>
        <ProIconChip name="magnify" tone="red" size={46} iconSize={25} />
        <Text style={[styles.body, styles.gapFlex]}>
          Paid online {rupees(view.amountPaisa)} — under review. The amount stays
          frozen until support resolves the customer&apos;s report.
        </Text>
      </View>
    );
  }
  if (view.status === 'REFUND_PENDING' || view.status === 'REFUNDED') {
    const pending = view.status === 'REFUND_PENDING';
    return (
      <View style={styles.stateRow}>
        <ProIconChip name="cash-refund" size={46} iconSize={25} />
        <Text style={[styles.body, styles.gapFlex]}>
          Paid online {rupees(view.amountPaisa)} —{' '}
          {pending ? 'refund in progress.' : 'refunded in full to the customer.'}{' '}
          No share releases to you for this job.
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.stateRow}>
      <ProIconChip name="credit-card-check" size={46} iconSize={25} />
      <Text style={[styles.body, styles.gapFlex]}>
        Paid online {rupees(view.amountPaisa)} — your{' '}
        {rupees(view.professionalAmountPaisa)} share releases after review.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: ProColors.surface,
    borderRadius: ProRadius.card,
    padding: ProSpacing.lg,
    gap: ProSpacing.sm,
  },
  gap: {gap: ProSpacing.sm},
  gapFlex: {flex: 1, gap: ProSpacing.sm},
  headerRow: {flexDirection: 'row', alignItems: 'center', gap: ProSpacing.md},
  headerCopy: {flex: 1, gap: 2},
  stateRow: {flexDirection: 'row', alignItems: 'center', gap: ProSpacing.md},
  title: {fontSize: 16, fontWeight: '800', color: ProColors.text},
  body: {...ProType.body, color: ProColors.text},
  hint: {...ProType.meta, color: ProColors.muted},
  label: {fontSize: 14, fontWeight: '700', color: ProColors.text},
  loading: {flexDirection: 'row', alignItems: 'center', gap: ProSpacing.sm},
  input: {
    backgroundColor: ProColors.background,
    borderRadius: ProRadius.input,
    paddingHorizontal: ProSpacing.md,
    paddingVertical: ProSpacing.sm,
    fontSize: 18,
    fontWeight: '700',
    color: ProColors.text,
  },
  methodRow: {flexDirection: 'row', gap: ProSpacing.sm},
  method: {
    flex: 1,
    flexDirection: 'row',
    gap: ProSpacing.sm,
    borderRadius: ProRadius.input,
    paddingVertical: ProSpacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ProColors.background,
  },
  methodActive: {backgroundColor: ProColors.primary},
  methodText: {fontSize: 15, fontWeight: '700', color: ProColors.text},
  methodTextActive: {color: ProColors.surface},
  link: {alignSelf: 'flex-start', paddingVertical: 2},
  linkText: {
    fontSize: 15,
    fontWeight: '800',
    color: ProColors.primary,
    textDecorationLine: 'underline',
  },
});
