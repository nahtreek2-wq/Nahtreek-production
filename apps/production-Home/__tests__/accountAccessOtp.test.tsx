jest.mock('../src/config/runtime', () => ({
  runtimeConfig: {environment: 'staging'},
}));
jest.mock('../src/services/config', () => ({isApiConfigured: true}));
jest.mock('../src/services/apiClient', () => ({
  api: {post: jest.fn(), get: jest.fn()},
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));
import React from 'react';
import renderer from 'react-test-renderer';
import {Text} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {AccountAccessScreen} from '../src/screens/AccountAccessScreen';
import {Button, Input} from '../src/components/ui';
import {api} from '../src/services/apiClient';
import {useSessionStore} from '../src/stores/session';

const post = api.post as jest.Mock;
let screen: renderer.ReactTestRenderer;

beforeEach(async () => {
  useSessionStore.getState().clearSession();
  post.mockReset();
  await renderer.act(async () => {
    screen = renderer.create(
      <SafeAreaProvider
        initialMetrics={{
          frame: {x: 0, y: 0, width: 320, height: 640},
          insets: {top: 24, bottom: 0, left: 0, right: 0},
        }}>
        <AccountAccessScreen />
      </SafeAreaProvider>,
    );
  });
});

afterEach(async () => {
  await renderer.act(async () => screen.unmount());
  jest.restoreAllMocks();
});

function input(label: string, value: string) {
  screen.root
    .findAllByType(Input)
    .find(node => node.props.label === label)!
    .props.onChangeText(value);
}

function press(label: string) {
  screen.root
    .findAllByType(Button)
    .find(node => node.props.label === label)!
    .props.onPress();
}

function textShown(content: string) {
  return screen.root
    .findAllByType(Text)
    .some(node => node.props.children === content);
}

const tokens = {
  accessToken: 'otp.access',
  refreshToken: 'otp.refresh',
  user: {id: 'client-1', fullName: 'OTP Client'},
};

it('signs in with an email code and offers no password path', async () => {
  expect(
    screen.root
      .findAllByType(Input)
      .some(node => node.props.label === 'Email address'),
  ).toBe(true);
  expect(
    screen.root
      .findAllByType(Button)
      .some(node => node.props.label === 'Send verification code'),
  ).toBe(true);
  // No password field and no password/OTP switcher anywhere.
  expect(
    screen.root
      .findAllByType(Input)
      .some(node => /password/i.test(node.props.label)),
  ).toBe(false);
  expect(
    screen.root
      .findAllByType(Input)
      .some(node => node.props.secureTextEntry),
  ).toBe(false);
});

it('sends the code to email and signs in on verify', async () => {
  post.mockResolvedValueOnce({});
  await renderer.act(async () => input('Email address', 'qa@example.com'));
  await renderer.act(async () => press('Send verification code'));
  expect(post).toHaveBeenCalledWith('/auth/email-otp/request', {
    email: 'qa@example.com',
  });
  expect(
    screen.root
      .findAllByType(Button)
      .some(node => node.props.label === 'Verify and login'),
  ).toBe(true);
  // The code field hooks into OS autofill (Android sms-otp / iOS oneTimeCode).
  expect(
    screen.root
      .findAllByType(Input)
      .find(node => node.props.label === 'Verification code')!.props,
  ).toMatchObject({autoComplete: 'sms-otp', textContentType: 'oneTimeCode'});
  post.mockResolvedValueOnce(tokens);
  await renderer.act(async () => input('Verification code', '123456'));
  await renderer.act(async () => press('Verify and login'));
  expect(post).toHaveBeenCalledWith('/auth/otp/verify', {
    email: 'qa@example.com',
    code: '123456',
  });
  expect(useSessionStore.getState().user).toMatchObject({
    fullName: 'OTP Client',
  });
});

it('routes unknown users to registration with details prefilled', async () => {
  post.mockResolvedValueOnce({});
  await renderer.act(async () => input('Email address', 'new@example.com'));
  await renderer.act(async () => press('Send verification code'));
  post.mockRejectedValueOnce(
    new Error('Create an account with your client details first'),
  );
  await renderer.act(async () => input('Verification code', '123456'));
  await renderer.act(async () => press('Verify and login'));
  // Landed on create mode with the email carried over.
  expect(
    screen.root
      .findAllByType(Input)
      .find(node => node.props.label === 'Email address')!.props.value,
  ).toBe('new@example.com');
  expect(
    textShown('No account found — complete your details to create one.'),
  ).toBe(true);
});

it('rejects a bad email before any request', async () => {
  await renderer.act(async () => input('Email address', 'not-an-email'));
  await renderer.act(async () => press('Send verification code'));
  expect(post).not.toHaveBeenCalled();
  expect(textShown('Enter your email address for OTP sign-in')).toBe(true);
});

it('rate-limits resends to one code per 30 seconds', async () => {
  post.mockResolvedValueOnce({});
  await renderer.act(async () => input('Email address', 'qa@example.com'));
  await renderer.act(async () => press('Send verification code'));
  expect(post).toHaveBeenCalledTimes(1);
  const resend = screen.root.find(
    node =>
      node.props.accessibilityLabel === 'Resend verification code' &&
      node.props.onPress,
  );
  await renderer.act(async () => resend.props.onPress());
  expect(post).toHaveBeenCalledTimes(1);
  expect(
    textShown('Please wait 30 seconds before sending another code'),
  ).toBe(true);
});
