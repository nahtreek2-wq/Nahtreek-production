jest.mock('../src/config/runtime', () => ({
  runtimeConfig: {environment: 'staging'},
}));
jest.mock('../src/services/config', () => ({isApiConfigured: false}));
import {NativeModules} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  isValidEmail,
  loginLocalAccount,
  registerLocalAccount,
  syncLocalAccountProfile,
  validateRegistration,
  type ClientRegistration,
} from '../src/services/localCredentials';
const form: ClientRegistration = {
  fullName: 'Client QA',
  address: '12 Test Street',
  city: 'Chennai',
  state: 'Tamil Nadu',
  postalCode: '600001',
  phoneNumber: '9000012345',
  email: 'qa@example.com',
  acceptedTerms: true,
};
let stored: string | null = null;
beforeEach(async () => {
  stored = null;
  await AsyncStorage.clear();
  NativeModules.NahtreekRuntimeConfig = {
    getLocalAccounts: jest.fn(async () => stored),
    setLocalAccounts: jest.fn(async (raw: string) => {
      stored = raw;
    }),
  };
});
it('requires contact details and consent before profile setup', () => {
  expect(validateRegistration(form)).toBeNull();
  expect(validateRegistration({...form, acceptedTerms: false})).toContain(
    'notice',
  );
  expect(validateRegistration({...form, postalCode: '123'})).toBeNull();
});
it('stores a credential-free device profile and signs in by email or mobile', async () => {
  await registerLocalAccount(form);
  expect(stored).not.toContain('password');
  expect(stored).not.toContain('salt');
  expect(stored).not.toContain('hash');
  await expect(loginLocalAccount('QA@example.com')).resolves.toMatchObject({
    user: {
      homeCity: 'Chennai',
      email: 'qa@example.com',
      address: '12 Test Street',
      postalCode: '600001',
    },
  });
  await expect(loginLocalAccount('9000011999')).rejects.toThrow(
    'No device account found',
  );
});
it('does not overwrite an existing mobile or email account', async () => {
  await registerLocalAccount(form);
  await expect(
    registerLocalAccount({...form, fullName: 'Other client'}),
  ).rejects.toThrow('already exists');
});
it('synchronizes edited contact details with device-login identifiers', async () => {
  const account = await registerLocalAccount(form);
  await syncLocalAccountProfile(account.user.id, {
    fullName: form.fullName,
    email: 'new@example.com',
  });
  await expect(loginLocalAccount('new@example.com')).resolves.toBeTruthy();
  await expect(loginLocalAccount(form.email)).rejects.toThrow();
});
it('fails closed when the native account service is missing', async () => {
  NativeModules.NahtreekRuntimeConfig = undefined;
  await expect(registerLocalAccount(form)).rejects.toThrow('unavailable');
});
it('detects wrong email patterns before any request', () => {
  expect(isValidEmail('qa@example.com')).toBe(true);
  expect(isValidEmail('  QA@Example.COM  ')).toBe(true);
  for (const bad of ['not-an-email', 'qa@', '@example.com', 'qa@example', 'qa @example.com', 'qa@ex ample.com', 'qa..x@example.com', 'qa@example..com', '', 'x'.repeat(250) + '@e.co']) {
    expect(isValidEmail(bad)).toBe(false);
  }
  expect(validateRegistration({...form, email: 'bad-email'})).toContain('valid email');
});
