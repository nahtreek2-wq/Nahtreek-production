import React, {useRef, useState} from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import {KeyboardAwareView} from '../../../../packages/mobile-ui/KeyboardAwareView';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Button, Icon, ICONS, Input as FormInput} from '../components/ui';
import {api, ApiError} from '../services/apiClient';
import {registerWithRecovery} from '../services/authRecovery';
import {isApiConfigured} from '../services/config';
import {runtimeConfig} from '../config/runtime';
import {ClientColors} from '../design-system/tokens';
import {useFormKeyboardScroll} from '../hooks/useFormKeyboardScroll';
import {useSessionStore} from '../stores/session';
import {
  isValidEmail,
  loginLocalAccount,
  normalizeMobile,
  registerLocalAccount,
  validateRegistration,
  type ClientRegistration,
} from '../services/localCredentials';
import {Colors} from '@nahtreek/design-system';

type Mode = 'login' | 'create';
function Input(props: React.ComponentProps<typeof FormInput>) {
  return <FormInput {...props} style={[s.field, props.style]} />;
}
type Step = 'credentials' | 'verify';
const initial: ClientRegistration = {
  fullName: '',
  address: '',
  city: '',
  state: '',
  postalCode: '',
  phoneNumber: '',
  email: '',
  acceptedTerms: false,
};
type Tokens = Parameters<
  ReturnType<typeof useSessionStore.getState>['setSession']
>[0];
const DATA_NOTICE =
  'We collect your mobile number and email to verify you with a one-time code — there is no password to remember or reset. After account creation, we ask for your name and city so we can tailor local help. Exact work locations are requested only when you book. An unconfigured internal build stores a test profile on this device; it does not create a verified online account. Do not enter sensitive identity documents or payment information here.';

export function AccountAccessScreen({
  initialMode = 'login',
}: {
  initialMode?: Mode;
}) {
  const insets = useSafeAreaInsets();
  const {width, height} = useWindowDimensions();
  const compact = width < 360 || height < 700;
  const setSession = useSessionStore(s => s.setSession);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [step, setStep] = useState<Step>('credentials');
  const [form, setForm] = useState(initial);
  const [identifier, setIdentifier] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const pending = useRef(false);
  const keyboardScroll = useFormKeyboardScroll(28);
  const scroll = keyboardScroll.scrollRef;
  const local = !isApiConfigured && runtimeConfig.environment === 'staging';
  const previewEmailOtp =
    isApiConfigured && runtimeConfig.environment === 'staging';
  function field<K extends keyof ClientRegistration>(
    key: K,
    value: ClientRegistration[K],
  ) {
    setForm(old => ({...old, [key]: value}));
    setError('');
  }
  function move(next: Step) {
    setStep(next);
    setError('');
    scroll.current?.scrollTo({y: 0, animated: true});
  }
  function changeMode(next: Mode) {
    if (pending.current) return;
    setMode(next);
    setStep('credentials');
    setError('');
    setMessage('');
    setCode('');
    setForm(initial);
    setIdentifier('');
    setResendAt(0);
    scroll.current?.scrollTo({y: 0, animated: true});
  }
  async function run(operation: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (issue) {
      setMessage('');
      setError(
        issue instanceof Error
          ? issue.message
          : 'Could not complete this step. Please try again.',
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function sendCode() {
    const details = {...form};
    if (!isApiConfigured)
      throw new ApiError(
        0,
        'Online verification is not connected yet. Please try again later.',
      );
    const phoneNumber =
      previewEmailOtp && !form.phoneNumber
        ? ''
        : normalizeMobile(form.phoneNumber);
    const email = form.email.trim().toLowerCase();
    if (!isValidEmail(email))
      throw new Error('Enter a valid email address');
    await api.post(
      previewEmailOtp ? '/auth/email-otp/request' : '/auth/otp/request',
      previewEmailOtp ? {email} : {phoneNumber},
    );
    setForm(details);
    setResendAt(Date.now() + 30_000);
    setCode('');
    move('verify');
    setMessage(
      `Enter the 6-digit code sent to your ${
        previewEmailOtp ? 'email' : 'mobile'
      }.`,
    );
  }
  async function create() {
    const problem = validateRegistration(form);
    if (problem) throw new Error(problem);
    if (local) {
      setSession(await registerLocalAccount(form), {needsProfileSetup: true});
      return;
    }
    await sendCode();
  }
  async function login() {
    if (!identifier.trim())
      throw new Error('Enter your mobile number or email');
    if (local) {
      setSession(await loginLocalAccount(identifier));
      return;
    }
    await sendLoginOtp();
  }
  async function sendLoginOtp() {
    if (!isApiConfigured)
      throw new ApiError(
        0,
        'Online verification is not connected yet. Please try again later.',
      );
    const raw = identifier.trim();
    if (previewEmailOtp) {
      if (!isValidEmail(raw))
        throw new Error('Enter your email address for OTP sign-in');
      const email = raw.toLowerCase();
      await api.post('/auth/email-otp/request', {email});
      setForm({...form, email});
    } else {
      const phoneNumber = normalizeMobile(raw);
      await api.post('/auth/otp/request', {phoneNumber});
      setForm({...form, phoneNumber: phoneNumber.slice(-10)});
    }
    setResendAt(Date.now() + 30_000);
    setCode('');
    move('verify');
    setMessage(
      `Enter the 6-digit code sent to your ${
        previewEmailOtp ? 'email' : 'mobile'
      }.`,
    );
  }
  async function verify() {
    if (!/^\d{6}$/.test(code))
      throw new Error('Enter the 6-digit verification code');
    const phoneNumber =
      previewEmailOtp && mode !== 'create'
        ? ''
        : normalizeMobile(form.phoneNumber);
    if (mode === 'login') {
      try {
        const payload = previewEmailOtp
          ? {email: form.email.trim().toLowerCase(), code}
          : {phoneNumber, code};
        setSession(await api.post<Tokens>('/auth/otp/verify', payload));
      } catch (issue) {
        const detail = issue instanceof Error ? issue.message : '';
        if (detail.includes('Create an account with your client details')) {
          setMode('create');
          setStep('credentials');
          setCode('');
          setMessage(
            'No account found — complete your details to create one.',
          );
          scroll.current?.scrollTo({y: 0, animated: true});
          return;
        }
        throw issue;
      }
      return;
    }
    const email = form.email.trim().toLowerCase();
    const verifyPayload = previewEmailOtp ? {email, code} : {phoneNumber, code};
    // Registration consumes the code; if the response is lost but the
    // account exists (409), the same code still verifies (the failed
    // transaction rolls the consumption back).
    const result = await registerWithRecovery(
      () => api.post<Tokens>('/auth/register', {
        acceptedTerms: form.acceptedTerms,
        email,
        phoneNumber,
        code,
      }),
      () => api.post<Tokens>('/auth/otp/verify', verifyPayload),
    );
    setSession(result, {needsProfileSetup: true});
  }
  const title =
    step === 'verify'
      ? `Verify your ${previewEmailOtp ? 'email' : 'mobile'}`
      : mode === 'login'
      ? 'Welcome back'
      : 'Create your account';
  return (
    <KeyboardAwareView style={s.root}>
      <ScrollView
        ref={scroll}
        onScroll={keyboardScroll.onScroll}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={keyboardScroll.keyboardDismissMode}
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={[s.body, {paddingBottom: insets.bottom + 24}]}>
        <View style={[s.brandHeader, compact && s.compactBrandHeader, {paddingTop: insets.top + (compact ? 12 : 18)}]}>
          <View style={s.brandRow}>
            <Image
              source={require('../assets/nahtreek_home_mark.png')}
              style={[s.logo, compact && s.compactLogo]}
              resizeMode="contain"
              accessibilityLabel="Nahtreek logo"
            />
            <View style={s.brandCopy}>
              <Text style={[s.brand, compact && s.compactBrand]}>NAHTREEK</Text>
              <Text style={s.tagline}>HOME</Text>
            </View>
          </View>
          <Text style={[s.headerTitle, compact && s.compactHeaderTitle]}>Your home. The right help.</Text>
          <Text style={[s.headerSubtitle, compact && s.compactHeaderSubtitle]}>
            Engineers and home services, in one place.
          </Text>
        </View>
        <View style={s.accountCard}>
          <View style={s.tabs}>
            {(['login', 'create'] as const).map(item => (
              <Pressable
                key={item}
                disabled={busy}
                accessibilityRole="tab"
                accessibilityState={{selected: mode === item}}
                onPress={() => changeMode(item)}
                style={[s.tab, mode === item && s.activeTab]}>
                <Text numberOfLines={1} adjustsFontSizeToFit style={[s.tabText, mode === item && s.activeTabText]}>
                  {item === 'login' ? 'Login' : 'Create account'}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={s.title}>{title}</Text>
          <Text style={s.subtitle}>
            {step === 'verify'
              ? previewEmailOtp
                ? `Code sent to ${form.email.trim().toLowerCase()}`
                : `Mobile ending ${form.phoneNumber.slice(-4)}`
              : mode === 'login'
              ? 'Sign in with a one-time code — no password needed.'
              : 'Your contact details for code verification.'}
          </Text>
          <View style={s.form}>
            {step === 'verify' ? (
              <>
                <Input
                  key="verification-code"
                  label="Verification code"
                  value={code}
                  onChangeText={value => {
                    setCode(value.replace(/\D/g, '').slice(0, 6));
                    setError('');
                  }}
                  placeholder="6-digit code"
                  keyboardType="numeric"
                  maxLength={6}
                  autoComplete="sms-otp"
                  textContentType="oneTimeCode"
                  onFocus={keyboardScroll.onFocus}
                />
                <Button
                  label={
                    mode === 'login'
                      ? 'Verify and login'
                      : 'Verify and create account'
                  }
                  loading={busy}
                  disabled={code.length !== 6}
                  onPress={() => void run(verify)}
                />
                <Pressable
                  style={s.link}
                  accessibilityRole="button"
                  accessibilityLabel="Resend verification code"
                  disabled={busy}
                  onPress={() =>
                    void run(async () => {
                      if (Date.now() < resendAt)
                        throw new Error(
                          'Please wait 30 seconds before sending another code',
                        );
                      await sendCode();
                    })
                  }>
                  <Text style={s.linkText}>Send another code</Text>
                </Pressable>
                <Button
                  label="Change account details"
                  variant="secondary"
                  disabled={busy}
                  onPress={() => {
                    setCode('');
                    setMessage('');
                    move('credentials');
                  }}
                />
              </>
            ) : (
              <>
                {mode === 'login' ? (
                  <Input
                    key="login-identifier"
                    label={
                      previewEmailOtp ? 'Email address' : 'Mobile number'
                    }
                    value={identifier}
                    onChangeText={value => {
                      setIdentifier(value);
                      setError('');
                    }}
                    placeholder={
                      previewEmailOtp
                        ? 'you@example.com'
                        : '10-digit mobile number'
                    }
                    autoCapitalize="none"
                    maxLength={254}
                    keyboardType={previewEmailOtp ? 'email-address' : 'phone-pad'}
                    icon={ICONS.profile}
                    onFocus={keyboardScroll.onFocus}
                  />
                ) : (
                  <>
                    {mode === 'create' || !previewEmailOtp ? (
                      <Input
                        key="account-mobile"
                        label="Mobile number"
                        value={form.phoneNumber}
                        onChangeText={value =>
                          field(
                            'phoneNumber',
                            value.replace(/\D/g, '').slice(0, 10),
                          )
                        }
                        placeholder="10-digit mobile number"
                        keyboardType="phone-pad"
                        maxLength={10}
                        icon={ICONS.phone}
                        leading={<Text style={s.prefix}>+91</Text>}
                        onFocus={keyboardScroll.onFocus}
                      />
                    ) : null}
                    {mode === 'create' || local || previewEmailOtp ? (
                      <Input
                        key="account-email"
                        label="Email address"
                        value={form.email}
                        onChangeText={value => field('email', value)}
                        placeholder="you@example.com"
                        keyboardType="email-address"
                        autoCapitalize="none"
                        maxLength={254}
                        icon={ICONS.mail}
                        onFocus={keyboardScroll.onFocus}
                      />
                    ) : null}
                  </>
                )}
                {mode === 'create' ? (
                  <View style={s.consent}>
                    <Pressable
                      accessibilityRole="checkbox"
                      accessibilityLabel="Agree to account data notice"
                      accessibilityState={{checked: form.acceptedTerms}}
                      onPress={() =>
                        field('acceptedTerms', !form.acceptedTerms)
                      }
                      style={s.check}>
                      <Icon
                        name={
                          form.acceptedTerms ? ICONS.check : ICONS.checkboxBlank
                        }
                        size={22}
                        color={form.acceptedTerms ? ClientColors.success : ClientColors.secondaryText}
                      />
                    </Pressable>
                    <Pressable
                      style={{flex: 1}}
                      accessibilityRole="link"
                      accessibilityLabel="Read the account data notice"
                      onPress={() => setNotice(true)}>
                      <Text style={s.noticeText}>
                        I agree to the{' '}
                        <Text style={s.linkText}>account data notice</Text>
                      </Text>
                    </Pressable>
                  </View>
                ) : null}
              </>
            )}
            {error ? (
              <View accessibilityRole="alert" style={[s.feedback, s.errorFeedback]}>
                <Icon name={ICONS.alert} size={18} color={ClientColors.error} />
                <Text style={s.error}>{error}</Text>
              </View>
            ) : null}
            {message ? (
              <View accessibilityRole="alert" style={[s.feedback, s.messageFeedback]}>
                <Icon name={ICONS.mail} size={18} color={ClientColors.information} />
                <Text style={s.message}>{message}</Text>
              </View>
            ) : null}
            {step !== 'verify' ? (
              <Button
                label={
                  mode === 'login'
                    ? local
                      ? 'Login'
                      : 'Send verification code'
                    : local
                    ? 'Create account'
                    : `Verify ${
                        previewEmailOtp ? 'email' : 'mobile'
                      } and create account`
                }
                variant="primary"
                loading={busy}
                onPress={() =>
                  void run(mode === 'login' ? login : create)
                }
              />
            ) : null}
          </View>
        </View>
      </ScrollView>
      <Modal
        visible={notice}
        transparent
        animationType="fade"
        onRequestClose={() => setNotice(false)}>
        <View style={s.backdrop}>
          <View style={s.noticeCard}>
            <Text style={s.title}>Account data notice</Text>
            <ScrollView>
              <Text style={s.subtitle}>{DATA_NOTICE}</Text>
            </ScrollView>
            <Button
              label="I have read the notice"
              onPress={() => {
                field('acceptedTerms', true);
                setNotice(false);
              }}
            />
            <Button
              label="Close"
              variant="secondary"
              onPress={() => setNotice(false)}
            />
          </View>
        </View>
      </Modal>
    </KeyboardAwareView>
  );
}
const s = StyleSheet.create({
  root: {flex: 1, backgroundColor: ClientColors.lightBackground},
  body: {flexGrow: 1},
  brandHeader: {
    backgroundColor: ClientColors.primaryNavy,
    paddingHorizontal: 24,
    paddingBottom: 34,
  },
  compactBrandHeader: {paddingBottom: 22},
  compactLogo: {width: 42, height: 42},
  compactBrand: {fontSize: 18, letterSpacing: 1},
  compactHeaderTitle: {fontSize: 18, lineHeight: 24, marginTop: 12},
  compactHeaderSubtitle: {fontSize: 13, lineHeight: 18},
  headerTitle: {
    fontSize: 20,
    lineHeight: 27,
    fontWeight: '700',
    color: ClientColors.white,
    marginTop: 16,
  },
  headerSubtitle: {
    fontSize: 14,
    lineHeight: 21,
    color: Colors.slate100,
    marginTop: 4,
  },
  accountCard: {
    marginHorizontal: 0,
    marginTop: 0,
    padding: 20,
    paddingTop: 24,
  },
  brandCopy: {flex: 1},
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 0,
  },
  logo: {width: 48, height: 48},
  brand: {fontSize: 22, fontWeight: '800', letterSpacing: 2, color: ClientColors.white},
  tagline: {
    fontSize: 10,
    letterSpacing: 1.2,
    fontWeight: '700',
    color: ClientColors.white,
    marginTop: 5,
  },
  tabs: {
    flexDirection: 'row',
    marginBottom: 24,
    padding: 4,
    borderRadius: 16,
    backgroundColor: Colors.slate100,
  },
  tab: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  activeTab: {backgroundColor: ClientColors.accent},
  tabText: {fontSize: 16, fontWeight: '600', color: ClientColors.secondaryText},
  activeTabText: {color: ClientColors.onAccent, fontWeight: '800'},
  title: {
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '800',
    color: ClientColors.primaryText,
    marginBottom: 8,
  },
  subtitle: {fontSize: 16, lineHeight: 24, color: ClientColors.secondaryText, marginBottom: 20},
  form: {gap: 12},
  field: {marginBottom: 4},
  link: {minHeight: 48, justifyContent: 'center', alignItems: 'flex-end'},
  linkText: {color: ClientColors.accentText, fontWeight: '700', fontSize: 16},
  prefix: {fontSize: 16, color: ClientColors.primaryText, paddingRight: 8},
  eye: {
    minWidth: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  feedback: {flexDirection: 'row', alignItems: 'flex-start', gap: 9, padding: 12, borderRadius: 12, borderWidth: 1},
  errorFeedback: {backgroundColor: '#FFF3F3', borderColor: '#F3C8C8'},
  messageFeedback: {backgroundColor: '#EEF4FB', borderColor: '#D9E5F2'},
  error: {fontSize: 14, lineHeight: 20, color: ClientColors.error, flex: 1},
  message: {fontSize: 14, lineHeight: 20, color: ClientColors.information, flex: 1},
  consent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  check: {
    minWidth: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: ClientColors.white,
  },
  noticeText: {fontSize: 16, lineHeight: 24, color: ClientColors.secondaryText},
  welcomeBody: {
    flexGrow: 1,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  welcomeLogo: {width: 64, height: 64},
  welcomeBrand: {
    fontSize: 19,
    fontWeight: '800',
    letterSpacing: 3,
    color: ClientColors.primaryNavy,
    marginTop: 12,
  },
  successIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.successBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 32,
    marginBottom: 20,
  },
  welcomeTitle: {
    fontSize: 28,
    lineHeight: 36,
    fontWeight: '800',
    color: ClientColors.primaryText,
    textAlign: 'center',
  },
  welcomeSubtitle: {
    fontSize: 16,
    lineHeight: 24,
    color: ClientColors.secondaryText,
    textAlign: 'center',
    marginTop: 10,
  },
  welcomeLocation: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    marginTop: 16,
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: ClientColors.white,
    borderWidth: 1,
    borderColor: ClientColors.border,
    borderRadius: 20,
  },
  locationText: {
    fontSize: 16,
    color: ClientColors.primaryNavy,
    fontWeight: '700',
    flexShrink: 1,
  },
  welcomeButton: {width: '100%', marginTop: 28, minHeight: 52},
  steps: {flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 24},
  stepDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.slate100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  currentDot: {backgroundColor: ClientColors.accentSoft},
  stepNumber: {fontSize: 14, fontWeight: '800', color: ClientColors.primaryNavy},
  stepLabel: {fontSize: 13, fontWeight: '600', color: ClientColors.secondaryText},
  stepLine: {flex: 1, height: 1, backgroundColor: Colors.slate100},
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(17, 31, 53,0.6)',
    justifyContent: 'center',
    padding: 24,
  },
  noticeCard: {
    maxHeight: '85%',
    backgroundColor: ClientColors.white,
    borderRadius: 24,
    padding: 24,
    gap: 14,
  },
});
