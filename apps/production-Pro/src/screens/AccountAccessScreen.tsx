import {FormScrollView, useFormFieldFocus} from '../../../../packages/mobile-ui/FormScrollView';
import React, {useState} from 'react';
import {
  Image,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {KeyboardAwareView} from '../../../../packages/mobile-ui/KeyboardAwareView';
import {useIsFocused} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import {
  BorderRadius,
  Colors,
  Spacing,
  Typography,
} from '@nahtreek/design-system';
import {PrimaryButton} from '../components/PrimaryButton';
import {ProColors} from '../theme/professionalTheme';
import {api, ApiError} from '../services/apiClient';
import {registerWithRecovery} from '../services/authRecovery';
import {useProfessionalDraft} from '../stores/professional';
import {useSessionStore, type ProfessionalUser} from '../stores/session';
import {isApiConfigured, runtimeConfig} from '../config/runtime';
import {
  isValidEmail,
  loginLocalProfessional,
  openDemoProfessional,
  registerLocalProfessional,
} from '../services/localAccounts';

type AuthResponse = {
  accessToken: string;
  refreshToken: string;
  user: ProfessionalUser;
};

export function AccountAccessScreen() {
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const professionalType = useProfessionalDraft(
    state => state.professionalType,
  );
  const setSession = useSessionStore(state => state.setSession);
  const [mode, setMode] = useState<'login' | 'create'>('create');
  const [identifier, setIdentifier] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const localPreview = !isApiConfigured;
  const previewEmailOtp =
    isApiConfigured && runtimeConfig.environment === 'staging';

  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Something went wrong. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  const login = () =>
    run(async () => {
      if (!identifier.trim()) {
        throw new ApiError(400, 'Enter your mobile number or email.');
      }
      if (localPreview) {
        setSession(await loginLocalProfessional(identifier));
        return;
      }
      if (codeSent) {
        await verifyLoginCode();
        return;
      }
      await sendLoginCode();
    });

  const sendLoginCode = async () => {
    const raw = identifier.trim();
    if (previewEmailOtp) {
      if (!isValidEmail(raw)) {
        throw new ApiError(400, 'Enter your registered email address.');
      }
      await api.post('/auth/email-otp/request', {
        email: raw.toLowerCase(),
      });
      setEmail(raw.toLowerCase());
    } else {
      if (raw.replace(/\D/g, '').length !== 10) {
        throw new ApiError(400, 'Enter a valid 10-digit mobile number.');
      }
      await api.post('/auth/otp/request', {phoneNumber: raw});
      setPhone(raw);
    }
    setCodeSent(true);
  };

  const verifyLoginCode = async () => {
    if (!/^\d{6}$/.test(code)) {
      throw new ApiError(400, 'Enter the 6-digit verification code.');
    }
    const result = await api.post<AuthResponse>(
      '/auth/otp/verify',
      previewEmailOtp
        ? {email: email.trim().toLowerCase(), code}
        : {phoneNumber: phone, code},
    );
    setSession(result);
  };

  const sendCode = () =>
    run(async () => {
      if (phone.replace(/\D/g, '').length !== 10) {
        throw new ApiError(400, 'Enter a valid 10-digit mobile number.');
      }
      if (!isValidEmail(email)) {
        throw new ApiError(400, 'Enter a valid email address.');
      }
      if (localPreview) {
        setCodeSent(true);
        return;
      }
      await api.post(
        previewEmailOtp ? '/auth/email-otp/request' : '/auth/otp/request',
        previewEmailOtp
          ? {email: email.trim().toLowerCase()}
          : {phoneNumber: phone},
      );
      setCodeSent(true);
    });

  const create = () =>
    run(async () => {
      if (!professionalType) {
        throw new ApiError(400, 'Choose your professional type first.');
      }
      if (!isValidEmail(email)) {
        throw new ApiError(400, 'Enter a valid email address.');
      }
      if (!localPreview && !/^\d{6}$/.test(code)) {
        throw new ApiError(400, 'Enter the 6-digit verification code.');
      }
      if (!accepted) {
        throw new ApiError(400, 'Accept the account data notice to continue.');
      }
      if (localPreview) {
        setSession(
          await registerLocalProfessional({
            phoneNumber: phone,
            email,
            professionalType,
          }),
        );
        return;
      }
      const normalizedEmail = email.trim().toLowerCase();
      // Registration consumes the code; if the response is lost but the
      // account exists (409), the same code still verifies (the failed
      // transaction rolls the consumption back).
      const result = await registerWithRecovery(
        () =>
          api.post<AuthResponse>('/auth/professionals/register', {
            phoneNumber: phone,
            email: normalizedEmail,
            code,
            professionalType,
            acceptedTerms: true,
          }),
        () =>
          api.post<AuthResponse>(
            '/auth/otp/verify',
            previewEmailOtp
              ? {email: normalizedEmail, code}
              : {phoneNumber: phone, code},
          ),
      );
      setSession(result);
    });

  const openDemo = (kind: 'engineer' | 'service') =>
    run(async () => {
      setSession(await openDemoProfessional(kind));
    });

  return (
    <KeyboardAwareView style={styles.root}>
      {focused ? (
        <StatusBar
          barStyle="dark-content"
          backgroundColor={Colors.offWhite}
        />
      ) : null}
      <FormScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + Spacing.sm,
            paddingBottom: insets.bottom + Spacing.xxl,
          },
        ]}>
        <View style={styles.brand}>
          <Image
            source={require('../assets/nahtreek-logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <View>
            <Text style={styles.brandName}>NAHTREEK PRO</Text>
            <Text style={styles.product}>PROFESSIONAL WORKSPACE</Text>
          </View>
        </View>
        <View style={styles.tabs}>
          {(['login', 'create'] as const).map(item => (
            <Pressable
              key={item}
              accessibilityRole="tab"
              accessibilityLabel={item === 'login' ? 'Login tab' : 'Create account tab'}
              accessibilityState={{selected: mode === item}}
              onPress={() => {
                setMode(item);
                setCodeSent(false);
                setCode('');
                setError('');
              }}
              style={[styles.tab, mode === item && styles.tabActive]}>
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                style={[styles.tabText, mode === item && styles.tabTextActive]}>
                {item === 'login' ? 'Login' : 'Create account'}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.title}>
          {mode === 'login' ? 'Welcome back' : 'Create your work account'}
        </Text>
        <Text style={styles.subtitle}>
          {mode === 'login'
            ? 'Sign in with a one-time code — no password needed.'
            : `Verify with ${
                previewEmailOtp ? 'an email' : 'a mobile'
              } code. We will collect your professional details next.`}
        </Text>
        {localPreview ? (
          <View style={styles.preview}>
            <MaterialCommunityIcons
              name="cellphone-lock"
              size={20}
              color={Colors.navyDeep}
            />
            <Text style={styles.previewText}>
              Device test mode: this test account stays encrypted on this
              emulator. SMS and production data are not used.
            </Text>
          </View>
        ) : null}
        <View style={styles.form}>
          {mode === 'login' ? (
            <>
              <Field
                label={
                  previewEmailOtp ? 'Email address' : 'Mobile number'
                }
                value={identifier}
                onChangeText={setIdentifier}
                keyboardType={previewEmailOtp ? 'email-address' : 'phone-pad'}
                autoCapitalize="none"
                placeholder={
                  previewEmailOtp
                    ? 'you@example.com'
                    : '10-digit mobile number'
                }
              />
              {!localPreview && codeSent ? (
                <Field
                  label="Verification code"
                  value={code}
                  onChangeText={value =>
                    setCode(value.replace(/\D/g, '').slice(0, 6))
                  }
                  keyboardType="number-pad"
                  placeholder="6-digit code"
                  maxLength={6}
                  autoComplete="sms-otp"
                  textContentType="oneTimeCode"
                />
              ) : null}
              {error ? (
                <Text accessibilityRole="alert" style={styles.error}>
                  {error}
                </Text>
              ) : null}
              <PrimaryButton
                label={
                  busy
                    ? codeSent
                      ? 'Verifying…'
                      : 'Sending…'
                    : localPreview
                    ? 'Login'
                    : codeSent
                    ? 'Verify and login'
                    : 'Send verification code'
                }
                disabled={busy}
                onPress={login}
              />
              {!localPreview && codeSent ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Send code again"
                  disabled={busy}
                  onPress={() => {
                    setCodeSent(false);
                    setCode('');
                  }}>
                  <Text style={styles.link}>Send code again</Text>
                </Pressable>
              ) : null}
            </>
          ) : (
            <>
              <Field
                label="Mobile number"
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                placeholder="10-digit mobile number"
                maxLength={10}
              />
              <Field
                label="Email address"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                placeholder="you@example.com"
              />
              {!codeSent ? (
                <PrimaryButton
                  label={
                    busy
                      ? 'Preparing…'
                      : localPreview
                      ? 'Continue on this device'
                      : `Send code to ${previewEmailOtp ? 'email' : 'mobile'}`
                  }
                  disabled={busy}
                  onPress={sendCode}
                />
              ) : (
                <>
                  {!localPreview ? (
                    <Field
                      label="Verification code"
                      value={code}
                      onChangeText={value =>
                        setCode(value.replace(/\D/g, '').slice(0, 6))
                      }
                      keyboardType="number-pad"
                      placeholder="6-digit code"
                      maxLength={6}
                      autoComplete="sms-otp"
                      textContentType="oneTimeCode"
                    />
                  ) : null}
                  <Pressable disabled={busy} onPress={sendCode}>
                    <Text style={styles.link}>Send code again</Text>
                  </Pressable>
                </>
              )}
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{checked: accepted}}
                onPress={() => setAccepted(value => !value)}
                style={styles.consent}>
                <MaterialCommunityIcons
                  name={accepted ? 'checkbox-marked' : 'checkbox-blank-outline'}
                  size={24}
                  color={accepted ? Colors.navyMid : Colors.slate500}
                />
                <Text style={styles.consentText}>
                  I agree to the account data notice and Terms of Use.
                </Text>
              </Pressable>
              {error ? (
                <Text accessibilityRole="alert" style={styles.error}>
                  {error}
                </Text>
              ) : null}
              <PrimaryButton
                label={busy ? 'Creating account…' : 'Create account'}
                disabled={busy || !codeSent}
                onPress={create}
              />
            </>
          )}
        </View>
        {localPreview ? (
          <View style={styles.demoSection}>
            <View style={styles.demoTitleRow}>
              <MaterialCommunityIcons
                name="account-eye-outline"
                size={22}
                color={Colors.navyDeep}
              />
              <View style={styles.demoCopy}>
                <Text style={styles.demoTitle}>Explore a ready profile</Text>
                <Text style={styles.demoText}>
                  Open a sample account to see the complete app. Sample data
                  never leaves this device.
                </Text>
              </View>
            </View>
            <View style={styles.demoActions}>
              <Pressable
                disabled={busy}
                onPress={() => openDemo('engineer')}
                style={styles.demoButton}>
                <MaterialCommunityIcons
                  name="hard-hat"
                  size={23}
                  color={Colors.navyDeep}
                />
                <Text style={styles.demoButtonText}>Engineer demo</Text>
              </Pressable>
              <Pressable
                disabled={busy}
                onPress={() => openDemo('service')}
                style={styles.demoButton}>
                <MaterialCommunityIcons
                  name="tools"
                  size={23}
                  color={Colors.navyDeep}
                />
                <Text style={styles.demoButtonText}>Service demo</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </FormScrollView>
    </KeyboardAwareView>
  );
}

type FieldProps = React.ComponentProps<typeof TextInput> & {label: string};
function Field({label, ...props}: FieldProps) {
  const onFocus = useFormFieldFocus();
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...props}
        onFocus={props.onFocus ?? onFocus}
        accessibilityLabel={label}
        placeholderTextColor={Colors.slate500}
        style={styles.input}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: Colors.offWhite},
  content: {flexGrow: 1, padding: 20, paddingBottom: Spacing.xxl},
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.md,
    backgroundColor: Colors.navyDeep,
    borderRadius: BorderRadius.lg,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
  },
  logo: {width: 48, height: 48},
  brandName: {...Typography.h2, color: Colors.white, letterSpacing: 0.5},
  product: {
    ...Typography.badge,
    lineHeight: 16,
    color: Colors.slate300,
    letterSpacing: 1.2,
  },
  tabs: {
    flexDirection: 'row',
    backgroundColor: Colors.slate100,
    padding: 4,
    borderRadius: BorderRadius.md,
    marginTop: Spacing.lg,
  },
  tab: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: BorderRadius.sm,
  },
  tabActive: {backgroundColor: Colors.white},
  tabText: {...Typography.button, lineHeight: 22, color: Colors.slate500},
  tabTextActive: {color: Colors.navyDeep},
  title: {...Typography.h1, color: Colors.slate900, marginTop: Spacing.lg},
  subtitle: {...Typography.body, color: Colors.slate600, marginTop: Spacing.xs},
  form: {gap: 20, marginTop: Spacing.lg},
  preview: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    padding: 20,
    marginTop: Spacing.md,
    borderRadius: BorderRadius.md,
    backgroundColor: ProColors.accentSoft,
  },
  previewText: {...Typography.caption, color: Colors.navyDeep, flex: 1},
  label: {
    ...Typography.caption,
    color: Colors.slate700,
    fontWeight: '700',
    marginBottom: Spacing.xs,
  },
  input: {
    ...Typography.body,
    minHeight: 52,
    color: Colors.slate900,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.slate200,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
  },
  link: {
    minHeight: 48,
    paddingVertical: 13,
    ...Typography.button,
    lineHeight: 22,
    color: Colors.navyMid,
    textAlign: 'right',
  },
  consent: {
    minHeight: 48,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  consentText: {...Typography.body, color: Colors.slate700, flex: 1},
  error: {...Typography.caption, color: Colors.error},
  backLink: {
    minHeight: 48,
    ...Typography.button,
    lineHeight: 22,
    color: Colors.navyMid,
    textAlign: 'center',
    paddingVertical: 13,
  },
  demoSection: {
    marginTop: Spacing.lg,
    padding: 20,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.slate200,
  },
  demoTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  demoCopy: {flex: 1},
  demoTitle: {...Typography.h3, color: Colors.slate900},
  demoText: {...Typography.caption, color: Colors.slate600, marginTop: 3},
  demoActions: {flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md},
  demoButton: {
    flex: 1,
    minHeight: 64,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    borderRadius: BorderRadius.md,
    backgroundColor: ProColors.accentSoft,
  },
  demoButtonText: {
    ...Typography.caption,
    color: Colors.navyDeep,
    fontWeight: '700',
  },
});
