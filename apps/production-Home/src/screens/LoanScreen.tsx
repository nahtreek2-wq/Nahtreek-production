import React, {useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {useMutation, useQueryClient} from '@tanstack/react-query';
import {AppHeader, Button, Card, Input} from '../components/ui';
import {api} from '../services/apiClient';
import {useSessionStore} from '../stores/session';
import {useToast} from '../stores/toast';
import {ClientColors} from '../design-system/tokens';

const PURPOSES = ['Purchase', 'Construction', 'Renovation'] as const;

export function LoanScreen() {
  const navigation = useNavigation<any>();
  const cache = useQueryClient();
  const toast = useToast();
  const user = useSessionStore(s => s.user);
  const [amount, setAmount] = useState('');
  const [purpose, setPurpose] =
    useState<(typeof PURPOSES)[number]>('Purchase');
  const [done, setDone] = useState(false);
  const file = useMutation({
    mutationFn: () =>
      api.post('/support/tickets', {
        subject: 'Home loan assistance',
        message:
          `Home loan callback request — ${user?.fullName ?? 'NAHTREEK user'}` +
          ` (${user?.phoneNumber ?? ''}${user?.homeCity ? `, ${user.homeCity}` : ''}): ` +
          `${purpose.toLowerCase()} loan` +
          (amount.trim() ? ` around ₹${amount.trim()} lakh` : '') +
          '. Please call back to help with eligibility and paperwork.',
      }),
    onSuccess: () => {
      setDone(true);
      void cache.invalidateQueries({queryKey: ['support-tickets']});
      toast('Callback requested. Our loan desk will call you soon.', 'success');
    },
    onError: error =>
      toast(
        error instanceof Error ? error.message : 'Could not send your request.',
        'error',
      ),
  });
  if (!user) {
    return (
      <View style={styles.root}>
        <AppHeader title="Home Loans" onBack={() => navigation.goBack()} />
        <View style={styles.body}>
          <Card>
            <Text style={styles.title}>Sign in to continue</Text>
            <Text style={styles.text}>
              A NAHTREEK account lets our loan desk reach you with quotes and
              paperwork help.
            </Text>
            <Button
              label="Login or create account"
              variant="primary"
              onPress={() => navigation.navigate('Login')}
            />
          </Card>
        </View>
      </View>
    );
  }
  return (
    <View style={styles.root}>
      <AppHeader title="Home Loans" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.body}>
        {done ? (
          <Card>
            <Text style={styles.title}>Request received</Text>
            <Text style={styles.text}>
              Our loan desk will call {user.phoneNumber} shortly to discuss
              {amount.trim() ? ` around ₹${amount.trim()} lakh` : ''} for your{' '}
              {purpose.toLowerCase()}.
            </Text>
            <Button
              label="View my requests"
              variant="primary"
              onPress={() => navigation.navigate('Help')}
            />
          </Card>
        ) : (
          <>
            <Card>
              <Text style={styles.title}>
                Buying, building, or renovating?
              </Text>
              <Text style={styles.text}>
                NAHTREEK connects you with lending partners and walks with you
                through the process:
              </Text>
              <Text style={styles.bullet}>
                {'\u2022  Eligibility guidance for your budget'}
              </Text>
              <Text style={styles.bullet}>
                {'\u2022  Document checklist before you apply'}
              </Text>
              <Text style={styles.bullet}>
                {'\u2022  A callback with quotes — approval stays with the lender'}
              </Text>
            </Card>
            <Card>
              <Text style={styles.label}>Loan purpose</Text>
              <View style={styles.chips}>
                {PURPOSES.map(item => (
                  <Pressable
                    key={item}
                    accessibilityRole="radio"
                    accessibilityState={{selected: purpose === item}}
                    accessibilityLabel={`Purpose ${item}`}
                    onPress={() => setPurpose(item)}
                    style={[
                      styles.chip,
                      purpose === item && styles.chipActive,
                    ]}>
                    <Text
                      style={[
                        styles.chipText,
                        purpose === item && styles.chipTextActive,
                      ]}>
                      {item}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Input
                label="Loan amount (₹ lakh, optional)"
                value={amount}
                onChangeText={setAmount}
                placeholder="e.g. 25"
                keyboardType="numeric"
                maxLength={6}
              />
              <Text style={styles.contact}>
                We will call {user.phoneNumber}
                {user.homeCity ? ` (${user.homeCity})` : ''}.
              </Text>
              <Button
                label="Request callback"
                variant="primary"
                loading={file.isPending}
                onPress={() => file.mutate()}
              />
            </Card>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: ClientColors.lightBackground},
  body: {padding: 16, gap: 12},
  title: {fontSize: 20, fontWeight: '800', color: ClientColors.primaryText},
  text: {fontSize: 15, lineHeight: 22, color: ClientColors.secondaryText},
  bullet: {
    fontSize: 15,
    lineHeight: 22,
    color: ClientColors.primaryText,
    marginTop: 4,
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
    color: ClientColors.primaryText,
    marginBottom: 8,
  },
  chips: {flexDirection: 'row', gap: 8, marginBottom: 12},
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: ClientColors.border,
    backgroundColor: ClientColors.white,
  },
  chipActive: {backgroundColor: ClientColors.primaryNavy, borderColor: ClientColors.primaryNavy},
  chipText: {fontSize: 14, fontWeight: '700', color: ClientColors.secondaryText},
  chipTextActive: {color: ClientColors.white},
  contact: {fontSize: 14, color: ClientColors.secondaryText, marginVertical: 12},
});
