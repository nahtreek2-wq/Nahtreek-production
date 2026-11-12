jest.mock('../src/config/runtime', () => ({
  runtimeConfig: {environment: 'staging', apiBaseUrl: undefined},
  isApiConfigured: false,
}));
import {NativeModules} from 'react-native';
import {isValidEmail, loginLocalProfessional, registerLocalProfessional} from '../src/services/localAccounts';

let stored: string | null;

beforeEach(() => {
  stored = null;
  NativeModules.NahtreekRuntimeConfig = {
    getLocalAccounts: jest.fn(async () => stored),
    setLocalAccounts: jest.fn(async (payload: string) => {stored = payload;}),
    getLocalProfile: jest.fn(async () => null),
  };
});

it('creates and restores a credential-free device-local service professional account', async () => {
  const created = await registerLocalProfessional({
    phoneNumber: '9876543210',
    email: 'professional@example.com',
    professionalType: 'SERVICE_PROFESSIONAL',
  });
  expect(created.user).toMatchObject({
    phoneNumber: '+919876543210',
    roles: ['SERVICE_PROVIDER'],
    needsProfessionalProfile: true,
  });
  expect(stored).not.toContain('password');
  const restored = await loginLocalProfessional('professional@example.com');
  expect(restored.user.id).toBe(created.user.id);
});

it('does not open a missing local professional account', async () => {
  await registerLocalProfessional({
    phoneNumber: '9876543211',
    email: 'engineer@example.com',
    professionalType: 'CIVIL_ENGINEER',
  });
  await expect(loginLocalProfessional('9876543219')).rejects.toThrow('No device account was found');
});

it('detects wrong email patterns before any request', async () => {
  expect(isValidEmail('pro@example.com')).toBe(true);
  for (const bad of ['not-an-email', 'pro@', '@example.com', 'pro@example', 'pro @example.com', 'pro@example..com', '']) {
    expect(isValidEmail(bad)).toBe(false);
  }
  await expect(registerLocalProfessional({
    phoneNumber: '9876543212',
    email: 'bad-email',
    professionalType: 'CIVIL_ENGINEER',
  })).rejects.toThrow('valid email');
});
