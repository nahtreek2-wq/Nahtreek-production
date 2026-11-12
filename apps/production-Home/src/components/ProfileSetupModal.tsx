import React, {useState} from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {KeyboardAwareView} from '../../../../packages/mobile-ui/KeyboardAwareView';
import {useQueryClient} from '@tanstack/react-query';
import {Colors, Spacing, Typography} from '@nahtreek/design-system';
import {ClientColors} from '../design-system/tokens';
import {Button, Icon, ICONS, Input} from './ui';
import {StateDistrictFields} from './StateDistrictFields';
import {api} from '../services/apiClient';
import {isApiConfigured} from '../services/config';
import {syncLocalAccountProfile} from '../services/localCredentials';
import {updateOfflineClientProfile} from '../data/offlineCatalogue';
import {useSessionStore} from '../stores/session';
import {useCity} from '../stores/city';
import {useFormKeyboardScroll} from '../hooks/useFormKeyboardScroll';

export function ProfileSetupModal() {
  const keyboardScroll = useFormKeyboardScroll(28);
  const user = useSessionStore(state => state.user);
  const visible = useSessionStore(state => state.needsProfileSetup);
  const updateUser = useSessionStore(state => state.updateUser);
  const complete = useSessionStore(state => state.completeProfileSetup);
  const setCity = useCity(state => state.setCity);
  const queryClient = useQueryClient();
  const [name, setName] = useState(
    user?.fullName === 'New Client' ? '' : user?.fullName ?? '',
  );
  const [city, setLocalCity] = useState(user?.homeCity ?? '');
  const [state, setState] = useState(user?.state ?? '');
  const [address, setAddress] = useState(user?.address ?? '');
  const [postalCode, setPostalCode] = useState(user?.postalCode ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!user) return null;
  const save = async () => {
    if (name.trim().length < 2) {
      setError('Please enter your name');
      return;
    }
    if (city.trim().length < 2 || state.trim().length < 2) {
      setError('Please enter your city and state');
      return;
    }
    if (postalCode && !/^[1-9]\d{5}$/.test(postalCode)) {
      setError('Enter a valid 6-digit PIN code or leave it empty');
      return;
    }
    setBusy(true);
    setError('');
    const profile = {
      fullName: name.trim(),
      city: city.trim(),
      state: state.trim(),
      address: address.trim(),
      postalCode,
    };
    try {
      const saved = isApiConfigured
        ? await api.patch<any>('/clients/me', profile)
        : await (async () => {
            await syncLocalAccountProfile(user.id, profile);
            return updateOfflineClientProfile(user, profile);
          })();
      queryClient.setQueryData(['client-profile'], saved);
      updateUser({
        fullName: saved.fullName,
        homeCity: saved.city,
        state: saved.state,
        address: saved.address || undefined,
        postalCode: saved.postalCode || undefined,
        email: saved.email || user.email,
      });
      setCity(saved.city || profile.city);
      complete();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not save your profile. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={() => undefined}>
      <View style={styles.backdrop}>
        <KeyboardAwareView style={styles.keyboard}>
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <View style={styles.greeting}>
              <View style={styles.greetingIcon}>
                <Icon name={ICONS.check} size={24} color={Colors.success} />
              </View>
              <View style={styles.greetingCopy}>
                <Text style={styles.kicker}>WELCOME TO NAHTREEK</Text>
                <Text style={styles.title}>Your account is ready</Text>
                <Text style={styles.subtitle}>
                  Tell us a little about yourself so we can show help in your
                  area.
                </Text>
              </View>
            </View>
            <ScrollView
              ref={keyboardScroll.scrollRef}
              onScroll={keyboardScroll.onScroll}
              scrollEventThrottle={16}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={keyboardScroll.keyboardDismissMode}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.form}>
              <Input
                label="Your name"
                value={name}
                onChangeText={value => {
                  setName(value);
                  setError('');
                }}
                placeholder="Enter your name"
                icon={ICONS.profile}
                autoCapitalize="words"
                maxLength={120}
                onFocus={keyboardScroll.onFocus}
              />
              <StateDistrictFields
                state={state}
                district={city}
                onStateChange={setState}
                onDistrictChange={value => {
                  setLocalCity(value);
                  setError('');
                }}
                onDistrictFocus={keyboardScroll.onFocus}
              />
              <Input
                label="Address (optional)"
                value={address}
                onChangeText={setAddress}
                placeholder="House number and street"
                maxLength={500}
                onFocus={keyboardScroll.onFocus}
              />
              <Input
                label="PIN code (optional)"
                value={postalCode}
                onChangeText={value =>
                  setPostalCode(value.replace(/\D/g, '').slice(0, 6))
                }
                placeholder="6-digit PIN code"
                keyboardType="numeric"
                maxLength={6}
                onFocus={keyboardScroll.onFocus}
              />
              {error ? (
                <Text accessibilityRole="alert" style={styles.error}>
                  {error}
                </Text>
              ) : null}
              <Button
                label="Save and continue"
                loading={busy}
                onPress={() => void save()}
              />
            </ScrollView>
          </View>
        </KeyboardAwareView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(17, 31, 53,0.38)',
  },
  keyboard: {flex: 1, justifyContent: 'flex-end'},
  sheet: {
    maxHeight: '88%',
    backgroundColor: Colors.white,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: Spacing.lg,
  },
  handle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.slate200,
    marginBottom: Spacing.lg,
  },
  greeting: {flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start'},
  greetingIcon: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  greetingCopy: {flex: 1},
  kicker: {...Typography.badge, color: ClientColors.accentText, letterSpacing: 1},
  title: {...Typography.h2, color: Colors.slate900, marginTop: 2},
  subtitle: {
    ...Typography.caption,
    color: Colors.slate600,
    marginTop: 3,
    lineHeight: 18,
  },
  form: {gap: Spacing.sm, paddingTop: Spacing.lg, paddingBottom: Spacing.sm},
  error: {...Typography.caption, color: Colors.error, lineHeight: 18},
});
