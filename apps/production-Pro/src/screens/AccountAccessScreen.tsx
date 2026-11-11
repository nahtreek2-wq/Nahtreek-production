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
  loginLocalProfessional,
  openDemoProfessional,
  registerLocalProfessional,
  resetLocalProfessionalPassword,
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
  const [mode, setMode] = useState<'login' | 'create' | 'forgot'>('create');
  const [identifier, setIdentifier] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
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
      if (!identifier.trim() || !password) {
        throw new ApiError(
          400,
          'Enter your mobile number or email and password.',
        );
      }
      if (localPreview) {
        setSession(await loginLocalProfessional(identifier, password));
        return;
      }
      const key = identifier.includes('@') ? 'email' : 'phoneNumber';
      const result = await api.post<AuthResponse>('/auth/professionals/login', {
        [key]: identifier.trim(),
        password,
      });
      setSession(result);
    });

  const sendCode = () =>
    run(async () => {
      if (phone.replace(/\D/g, '').length !== 10) {
        throw new ApiError(400, 'Enter a valid 10-digit mobile number.');
      }
      if (previewEmailOtp && !email.includes('@')) {
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
      if (!email.includes('@')) {
        throw new ApiError(400, 'Enter a valid email address.');
      }
      if (password.length < 8) {
        throw new ApiError(400, 'Use at least 8 characters for your password.');
      }
      if (password !== confirm) {
        throw new ApiError(400, 'The passwords do not match.');
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
            password,
            professionalType,
          }),
        );
        return;
      }
      const normalizedEmail = email.trim().toLowerCase();
      const result = await registerWithRecovery(
        () =>
          api.post<AuthResponse>('/auth/professionals/register', {
            phoneNumber: phone,
            email: normalizedEmail,
            password,
            code,
            professionalType,
            acceptedTerms: true,
          }),
        () =>
          api.post<AuthResponse>('/auth/professionals/login', {
            email: normalizedEmail,
            password,
          }),
      );
      setSession(result);
    });

  const requestReset = () =>
    run(async () => {
      if (
        previewEmailOtp
          ? !email.includes('@')
          : phone.replace(/\D/g, '').length !== 10
      ) {
        throw new ApiError(
          400,
          previewEmailOtp
            ? 'Enter your registered email address.'
            : 'Enter a valid 10-digit mobile number.',
        );
      }
      if (localPreview) {
        setCodeSent(true);
        return;
      }
      await api.post(
        previewEmailOtp
          ? '/auth/password-reset/email/request'
          : '/auth/password-reset/request',
        previewEmailOtp
          ? {email: email.trim().toLowerCase()}
          : {phoneNumber: phone},
      );
      setCodeSent(true);
    });

  const resetPassword = () =>
    run(async () => {
      if (!localPreview && !/^\d{6}$/.test(code)) {
        throw new ApiError(400, 'Enter the 6-digit verification code.');
      }
      if (password.length < 8) {
        throw new ApiError(400, 'Use at least 8 characters for your password.');
      }
      if (password !== confirm) {
        throw new ApiError(400, 'The passwords do not match.');
      }
      if (localPreview) {
        await resetLocalProfessionalPassword(phone, password);
      } else {
        await api.post(
          previewEmailOtp
            ? '/auth/password-reset/email/confirm'
            : '/auth/password-reset/confirm',
          previewEmailOtp
            ? {email: email.trim().toLowerCase(), code, password}
            : {phoneNumber: phone, code, password},
        );
      }
      setIdentifier(previewEmailOtp ? email.trim().toLowerCase() : phone);
      setMode('login');
      setCodeSent(false);
      setCode('');
      setConfirm('');
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
          {mode === 'login'
            ? 'Welcome back'
            : mode === 'forgot'
            ? 'Reset your password'
            : 'Create your work account'}
        </Text>
        <Text style={styles.subtitle}>
          {mode === 'login'
            ? 'Manage requests, schedule and messages.'
            : mode === 'forgot'
            ? `Verify your registered ${
                previewEmailOtp ? 'email address' : 'mobile number'
              }, then choose a new password.`
            : `Secure your account with ${
                previewEmailOtp ? 'email verification' : 'mobile verification'
              }. We will collect your professional details next.`}
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
                label="Mobile number or email"
                value={identifier}
                onChangeText={setIdentifier}
                autoCapitalize="none"
                placeholder="Mobile number or email"
              />
              <PasswordField
                label="Password"
                value={password}
                onChangeText={setPassword}
                visible={showPassword}
                toggle={() => setShowPassword(value => !value)}
              />
              <Pressable
                accessibilityRole="link"
                accessibilityLabel="Forgot password"
                onPress={() => {
                  setMode('forgot');
                  if (identifier.includes('@')) {
                    setEmail(identifier);
                  } else {
                    setPhone(identifier);
                  }
                  setCodeSent(false);
                  setError('');
                }}>
                <Text style={styles.link}>Forgot password?</Text>
              </Pressable>
              {error ? (
                <Text accessibilityRole="alert" style={styles.error}>
                  {error}
                </Text>
              ) : null}
              <PrimaryButton
                label={busy ? 'Signing in…' : 'Login'}
                disabled={busy}
                onPress={login}
              />
            </>
          ) : mode === 'forgot' ? (
            <>
              {previewEmailOtp ? (
                <Field
                  label="Registered email address"
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  placeholder="you@example.com"
                />
              ) : (
                <Field
                  label="Registered mobile number"
                  value={phone}
                  onChangeText={setPhone}
                  keyboardType="phone-pad"
                  placeholder="10-digit mobile number"
                  maxLength={10}
                />
              )}
              {!codeSent ? (
                <PrimaryButton
                  label={
                    busy
                      ? 'Checking…'
                      : localPreview
                      ? 'Continue with device security'
                      : 'Send reset code'
                  }
                  disabled={busy}
                  onPress={requestReset}
                />
              ) : (
                <>
                  {!localPreview ? (
                    <Field
                      label="Verification code"
                      value={code}
                      onChangeText={setCode}
                      keyboardType="number-pad"
                      placeholder="6-digit code"
                      maxLength={6}
                    />
                  ) : null}
                  <PasswordField
                    label="New password"
                    value={password}
                    onChangeText={setPassword}
                    visible={showPassword}
                    toggle={() => setShowPassword(value => !value)}
                  />
                  <Field
                    label="Confirm new password"
                    value={confirm}
                    onChangeText={setConfirm}
                    secureTextEntry={!showPassword}
                    placeholder="Enter the password again"
                  />
                  <Pressable accessibilityRole="button" accessibilityLabel="Send code again" disabled={busy} onPress={requestReset}>
                    <Text style={styles.link}>Send code again</Text>
                  </Pressable>
                  {error ? (
                    <Text accessibilityRole="alert" style={styles.error}>
                      {error}
                    </Text>
                  ) : null}
                  <PrimaryButton
                    label={busy ? 'Updating password…' : 'Update password'}
                    disabled={busy}
                    onPress={resetPassword}
                  />
                </>
              )}
              {!codeSent && error ? (
                <Text accessibilityRole="alert" style={styles.error}>
                  {error}
                </Text>
              ) : null}
              <Pressable
                accessibilityRole="link"
                accessibilityLabel="Back to login"
                onPress={() => {
                  setMode('login');
                  setError('');
                }}>
                <Text style={styles.backLink}>Back to login</Text>
              </Pressable>
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
                      onChangeText={setCode}
                      keyboardType="number-pad"
                      placeholder="6-digit code"
                      maxLength={6}
                    />
                  ) : null}
                  <Pressable disabled={busy} onPress={sendCode}>
                    <Text style={styles.link}>Send code again</Text>
                  </Pressable>
                </>
              )}
              <PasswordField
                label="Password"
                value={password}
                onChangeText={setPassword}
                visible={showPassword}
                toggle={() => setShowPassword(value => !value)}
              />
              <Field
                label="Confirm password"
                value={confirm}
                onChangeText={setConfirm}
                secureTextEntry={!showPassword}
                placeholder="Enter the password again"
              />
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
function PasswordField({
  label,
  value,
  onChangeText,
  visible,
  toggle,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  visible: boolean;
  toggle: () => void;
}) {
  const onFocus = useFormFieldFocus();
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.passwordRow}>
        <TextInput
          accessibilityLabel={label}
          onFocus={onFocus}
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={!visible}
          placeholder="At least 8 characters"
          placeholderTextColor={Colors.slate500}
          style={styles.passwordInput}
        />
        <Pressable
          style={styles.passwordToggle}
          accessibilityRole="button"
          accessibilityLabel={visible ? 'Hide password' : 'Show password'}
          onPress={toggle}>
          <MaterialCommunityIcons
            name={visible ? 'eye-off-outline' : 'eye-outline'}
            size={24}
            color={Colors.slate500}
          />
        </Pressable>
      </View>
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
  passwordRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.slate200,
    borderRadius: BorderRadius.md,
    paddingRight: 4,
  },
  passwordToggle: {
    minWidth: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  passwordInput: {
    ...Typography.body,
    flex: 1,
    color: Colors.slate900,
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
