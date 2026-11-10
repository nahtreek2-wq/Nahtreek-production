import React, {useState} from 'react';
import {ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {KeyboardAwareView} from '../../../../packages/mobile-ui/KeyboardAwareView';
import {ScreenHeader} from '../components/ScreenHeader';
import {ScreenLoading} from '../components/ScreenLoading';
import {EmptyState} from '../components/EmptyState';
import {PrimaryButton} from '../components/PrimaryButton';
import {api} from '../services/apiClient';
import {useProToast} from '../stores/proToast';
import {ProColors, ProRadius, ProSpacing, ProType} from '../theme/professionalTheme';

export type PayoutAccountView = {status: string; accountHolderName: string | null; bankName: string | null;
  accountLast4: string | null; maskedAccountNumber: string | null; ifsc: string | null; upiId: string | null;
  rejectionReason: string | null; updatedAt: string | null};
export type PayoutHooks = {
  load: () => Promise<PayoutAccountView>;
  submit: (input: {accountHolderName: string; accountNumber: string; ifsc: string; bankName?: string; upiId?: string}) => Promise<PayoutAccountView>;
};

const defaultHooks: PayoutHooks = {
  load: () => api.get<PayoutAccountView>('/payments/payout-accounts/me'),
  submit: input => api.post<PayoutAccountView>('/payments/payout-accounts/me', input),
};

const STATUS_LABEL: Record<string, string> = {
  NOT_SUBMITTED: 'Not submitted',
  PENDING: 'Pending verification',
  ACTIVE: 'Verified — payouts enabled',
  REJECTED: 'Needs changes',
  SUSPENDED: 'Suspended — contact support',
};

const validIfsc = (value: string) => /^[A-Za-z]{4}0[A-Za-z0-9]{6}$/.test(value.trim());
const validAccount = (value: string) => /^[0-9]{9,18}$/.test(value.trim());
const validUpi = (value: string) => !value.trim() || /^[\w.\-]{2,64}@[A-Za-z]{2,32}$/.test(value.trim());

export function PayoutScreen({hooks = defaultHooks}: {hooks?: PayoutHooks}) {
  const navigation = useNavigation();
  const toast = useProToast();
  const cache = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [holder, setHolder] = useState('');
  const [account, setAccount] = useState('');
  const [confirm, setConfirm] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [bank, setBank] = useState('');
  const [upi, setUpi] = useState('');
  const query = useQuery({queryKey: ['payout-account'], queryFn: hooks.load, retry: 1});
  const refresh = () => void cache.invalidateQueries({queryKey: ['payout-account']});
  const save = useMutation({mutationFn: () => hooks.submit({
      accountHolderName: holder.trim(), accountNumber: account.trim(), ifsc: ifsc.trim().toUpperCase(),
      ...(bank.trim() ? {bankName: bank.trim()} : {}), ...(upi.trim() ? {upiId: upi.trim()} : {}),
    }),
    onSuccess: view => {
      setEditing(false); setAccount(''); setConfirm('');
      setHolder(view.accountHolderName ?? ''); setIfsc(view.ifsc ?? '');
      setBank(view.bankName ?? ''); setUpi(view.upiId ?? '');
      refresh();
      toast('Payout details saved. Verification usually completes within a day.', 'success');
    },
    onError: error => toast(error instanceof Error ? error.message : 'Could not save payout details.', 'error'),
  });
  const startEdit = (view: PayoutAccountView | undefined) => {
    setHolder(view?.accountHolderName ?? ''); setAccount(''); setConfirm('');
    setIfsc(view?.ifsc ?? ''); setBank(view?.bankName ?? ''); setUpi(view?.upiId ?? '');
    setEditing(true);
  };
  const matches = account.trim() !== '' && account.trim() === confirm.trim();
  const valid = holder.trim().length >= 3 && validAccount(account) && matches && validIfsc(ifsc) && validUpi(upi);
  const view = query.data;
  const submitted = view && view.status !== 'NOT_SUBMITTED';

  return (
    <View style={styles.root}>
      <ScreenHeader title="Payout account" subtitle="Where your earnings land" onBack={() => navigation.goBack()} />
      <KeyboardAwareView style={styles.flex}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {query.isPending ? <ScreenLoading label="Loading payout details…" /> : query.isError || !view ? (
            <EmptyState title="Could not load payout details" message="Check your connection and try again."
              actionLabel={query.isFetching ? 'Checking…' : 'Try again'} onAction={() => void query.refetch()} />
          ) : (
            <>
              <Text style={styles.explainer}>
                After NAHTREEK takes its commission, your share of every online payment lands here.
                Bank transfers use the account + IFSC below; UPI payouts use your UPI ID when set.
              </Text>
              {submitted && !editing ? (
                <View style={styles.card}>
                  <View style={styles.statusRow}>
                    <Text style={styles.status}>{STATUS_LABEL[view.status] ?? view.status}</Text>
                    {view.status === 'REJECTED' && view.rejectionReason ? (
                      <Text style={styles.rejection}>{view.rejectionReason}</Text>
                    ) : null}
                  </View>
                  <View style={styles.kv}><Text style={styles.key}>Account holder</Text><Text style={styles.value}>{view.accountHolderName ?? '—'}</Text></View>
                  <View style={styles.kv}><Text style={styles.key}>Account number</Text><Text style={styles.value}>{view.maskedAccountNumber ?? '—'}</Text></View>
                  <View style={styles.kv}><Text style={styles.key}>IFSC</Text><Text style={styles.value}>{view.ifsc ?? '—'}</Text></View>
                  {view.bankName ? <View style={styles.kv}><Text style={styles.key}>Bank</Text><Text style={styles.value}>{view.bankName}</Text></View> : null}
                  {view.upiId ? <View style={styles.kv}><Text style={styles.key}>UPI ID</Text><Text style={styles.value}>{view.upiId}</Text></View> : null}
                  <PrimaryButton label="Update details" onPress={() => startEdit(view)} />
                </View>
              ) : (
                <View style={styles.card}>
                  <Text style={styles.label}>Account holder name</Text>
                  <TextInput accessibilityLabel="Account holder name" style={styles.input} value={holder} onChangeText={setHolder}
                    placeholder="Name on the bank account" placeholderTextColor={ProColors.muted} maxLength={120} />
                  <Text style={styles.label}>Account number</Text>
                  <TextInput accessibilityLabel="Account number" style={styles.input} value={account} onChangeText={setAccount}
                    placeholder="9–18 digits" placeholderTextColor={ProColors.muted} keyboardType="number-pad" maxLength={18} />
                  <Text style={styles.label}>Confirm account number</Text>
                  <TextInput accessibilityLabel="Confirm account number" style={styles.input} value={confirm} onChangeText={setConfirm}
                    placeholder="Type it again" placeholderTextColor={ProColors.muted} keyboardType="number-pad" maxLength={18} />
                  {confirm.trim() !== '' && !matches ? <Text style={styles.fieldError}>Account numbers do not match.</Text> : null}
                  <Text style={styles.label}>IFSC</Text>
                  <TextInput accessibilityLabel="IFSC" style={styles.input} value={ifsc} onChangeText={setIfsc}
                    placeholder="e.g. HDFC0001234" placeholderTextColor={ProColors.muted} autoCapitalize="characters"
                    autoCorrect={false} maxLength={11} />
                  <Text style={styles.label}>Bank name (optional)</Text>
                  <TextInput accessibilityLabel="Bank name" style={styles.input} value={bank} onChangeText={setBank}
                    placeholder="e.g. HDFC Bank" placeholderTextColor={ProColors.muted} maxLength={120} />
                  <Text style={styles.label}>UPI ID (optional)</Text>
                  <TextInput accessibilityLabel="UPI ID" style={styles.input} value={upi} onChangeText={setUpi}
                    placeholder="name@bank" placeholderTextColor={ProColors.muted} autoCapitalize="none"
                    autoCorrect={false} maxLength={80} />
                  <Text style={styles.privacy}>We store your account for payouts and only ever show you the masked form. Double-check every digit — wrong details delay your money.</Text>
                  <PrimaryButton label={save.isPending ? 'Saving…' : 'Save payout details'} loading={save.isPending}
                    disabled={!valid || save.isPending} onPress={() => save.mutate()} />
                  {submitted ? <PrimaryButton label="Cancel" onPress={() => setEditing(false)} /> : null}
                </View>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAwareView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: ProColors.background},
  flex: {flex: 1},
  body: {padding: ProSpacing.lg, gap: ProSpacing.md, paddingBottom: ProSpacing.xl * 2},
  explainer: {...ProType.body, color: ProColors.secondary},
  card: {backgroundColor: ProColors.surface, borderRadius: ProRadius.card, padding: ProSpacing.lg, gap: ProSpacing.sm},
  statusRow: {gap: 4, marginBottom: ProSpacing.xs},
  status: {...ProType.section, color: ProColors.text},
  rejection: {...ProType.body, color: ProColors.error},
  kv: {flexDirection: 'row', justifyContent: 'space-between', gap: ProSpacing.md, paddingVertical: 6},
  key: {...ProType.meta, color: ProColors.secondary, flexShrink: 0},
  value: {...ProType.body, color: ProColors.text, fontWeight: '600', textAlign: 'right', flexShrink: 1},
  label: {...ProType.meta, fontWeight: '700', color: ProColors.text},
  input: {backgroundColor: ProColors.background, borderRadius: ProRadius.input, paddingHorizontal: ProSpacing.md,
    minHeight: 50, fontSize: 15, color: ProColors.text},
  fieldError: {...ProType.meta, color: ProColors.error},
  privacy: {...ProType.meta, color: ProColors.secondary},
});
