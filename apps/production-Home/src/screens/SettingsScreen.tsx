import React, {useState} from 'react';
import {ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {NotificationPreferences} from '../../../../packages/mobile-push/NotificationPreferences';
import {api} from '../services/apiClient';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {
  Colors,
  Spacing,
  Typography,
} from '@nahtreek/design-system';
import {AppHeader, Button, Card, Icon, ICONS} from '../components/ui';
import {useSessionStore} from '../stores/session';
import type {RootStackParamList} from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const loadPreferences = () => api.get<{requestUpdates: boolean; messages: boolean; offers: boolean}>('/notifications/preferences');
const savePreferences = (value: Partial<{requestUpdates: boolean; messages: boolean; offers: boolean}>) => api.patch<{requestUpdates: boolean; messages: boolean; offers: boolean}>('/notifications/preferences', value);

export function SettingsScreen() {
  const navigation = useNavigation<Nav>();
  const clearSession = useSessionStore(state => state.clearSession);
  const sessionUser = useSessionStore(state => state.user);
  const [deleteCode, setDeleteCode] = useState('');
  const [confirmDelete, setConfirmDelete] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const canDelete = /^\d{6}$/.test(deleteCode) && confirmDelete.trim() === 'DELETE' && !deleting;
  const sendDeleteCode = () => {
    const identifier = sessionUser?.email?.includes('@')
      ? {email: sessionUser.email}
      : sessionUser?.phoneNumber
      ? {phoneNumber: sessionUser.phoneNumber}
      : null;
    if (!identifier) {
      setDeleteError('Your contact details are missing. Please sign in again.');
      return;
    }
    setSendingCode(true);
    setDeleteError('');
    api.post('email' in identifier ? '/auth/email-otp/request' : '/auth/otp/request', identifier)
      .then(() => setCodeSent(true))
      .catch(error => setDeleteError(error instanceof Error ? error.message : 'Could not send the code.'))
      .finally(() => setSendingCode(false));
  };
  const deleteAccount = () => {
    if (!canDelete) return;
    Alert.alert('Delete account?', 'This signs you out on all devices and closes your NAHTREEK account. Bookings and payment history are kept for records.', [
      {text: 'Keep account', style: 'cancel'},
      {text: 'Delete', style: 'destructive', onPress: () => {
        setDeleting(true);
        setDeleteError('');
        api.delete<{deleted: boolean}>('/auth/me', {code: deleteCode})
          .then(() => clearSession())
          .catch(error => {
            setDeleting(false);
            setDeleteError(error instanceof Error ? error.message : 'Could not delete the account.');
          });
      }},
    ]);
  };
  return (
    <View style={styles.container}>
      <AppHeader
        title="Settings"
        subtitle="Control your NAHTREEK experience"
        onBack={() => navigation.goBack()}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionTitle}>Notifications</Text>
        <NotificationPreferences load={loadPreferences} save={savePreferences} />

        <Text style={styles.sectionTitle}>Privacy & security</Text>
        <Card style={styles.infoCard}>
          <View style={styles.infoIcon}>
            <Icon name={ICONS.lock} size={20} color={Colors.navyDeep} />
          </View>
          <View style={styles.infoCopy}>
            <Text style={styles.infoTitle}>Your session is protected</Text>
            <Text style={styles.infoText}>
              On Android, access and refresh tokens are encrypted with the
              device Keystore. Personal profile data stays on your account.
            </Text>
          </View>
        </Card>

        <Text style={styles.sectionTitle}>Delete account</Text>
        <Card style={styles.deleteCard}>
          <Text style={styles.deleteText}>
            Closing your account signs you out everywhere. Verify with a code and type DELETE to confirm.
          </Text>
          {!codeSent ? (
            <Button
              label={sendingCode ? 'Sending…' : 'Send verification code'}
              variant="secondary"
              onPress={sendDeleteCode}
              disabled={sendingCode}
            />
          ) : (
            <TextInput
              accessibilityLabel="Deletion verification code"
              style={styles.deleteInput}
              value={deleteCode}
              onChangeText={value => {setDeleteCode(value.replace(/\D/g, '').slice(0, 6)); setDeleteError('');}}
              placeholder="6-digit code"
              placeholderTextColor={Colors.slate400}
              keyboardType="numeric"
              maxLength={6}
              autoComplete="sms-otp"
              textContentType="oneTimeCode"
            />
          )}
          <TextInput
            accessibilityLabel="Type DELETE to confirm"
            style={styles.deleteInput}
            value={confirmDelete}
            onChangeText={value => {setConfirmDelete(value); setDeleteError('');}}
            placeholder="Type DELETE"
            placeholderTextColor={Colors.slate400}
            autoCapitalize="characters"
            autoCorrect={false}
          />
          {deleteError ? <Text style={styles.deleteError}>{deleteError}</Text> : null}
          <Button
            label={deleting ? 'Deleting…' : 'Delete my account'}
            variant="danger"
            onPress={deleteAccount}
            disabled={!canDelete}
          />
          {deleting ? <ActivityIndicator color={Colors.error} /> : null}
        </Card>

        <Text style={styles.sectionTitle}>About NAHTREEK</Text>
        <Card style={styles.aboutCard}>
          <Text style={styles.aboutTitle}>From Plot to Home</Text>
          <Text style={styles.aboutText}>
            Find trusted professionals for your property journey, from planning
            and approvals to construction support.
          </Text>
          <View style={styles.versionRow}>
            <Text style={styles.versionLabel}>Client app</Text>
            <Text style={styles.versionValue}>v1.0.0 (1)</Text>
          </View>
        </Card>

        <Button
          label="Contact support"
          variant="secondary"
          onPress={() => navigation.navigate('Help')}
          style={styles.supportButton}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: Colors.offWhite},
  content: {padding: Spacing.lg, paddingBottom: Spacing.xxl},
  sectionTitle: {
    ...Typography.caption,
    color: Colors.slate500,
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  preferenceRow: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  rowBorder: {borderBottomWidth: 1, borderBottomColor: Colors.slate100},
  preferenceCopy: {flex: 1},
  preferenceLabel: {
    ...Typography.body,
    color: Colors.slate800,
    fontWeight: '700',
  },
  preferenceDescription: {
    ...Typography.caption,
    color: Colors.slate500,
    marginTop: 2,
    lineHeight: 17,
  },
  infoCard: {flexDirection: 'row', gap: Spacing.md, padding: Spacing.md},
  infoIcon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoCopy: {flex: 1},
  infoTitle: {
    ...Typography.subtitle,
    color: Colors.slate900,
    fontWeight: '700',
  },
  infoText: {
    ...Typography.caption,
    color: Colors.slate600,
    marginTop: 3,
    lineHeight: 18,
  },
  aboutCard: {padding: Spacing.lg},
  aboutTitle: {...Typography.h3, color: Colors.navyDeep},
  aboutText: {
    ...Typography.body,
    color: Colors.slate600,
    marginTop: Spacing.xs,
  },
  versionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: Colors.slate100,
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
  },
  versionLabel: {...Typography.caption, color: Colors.slate500},
  versionValue: {
    ...Typography.caption,
    color: Colors.slate700,
    fontWeight: '700',
  },
  supportButton: {marginTop: Spacing.xl},
  deleteCard: {padding: Spacing.lg, gap: Spacing.sm},
  deleteText: {...Typography.body, color: Colors.slate600},
  deleteInput: {
    backgroundColor: Colors.offWhite,
    borderRadius: 12,
    paddingHorizontal: Spacing.md,
    minHeight: 50,
    fontSize: 15,
    color: Colors.slate900,
  },
  deleteError: {...Typography.caption, color: Colors.error},
});
