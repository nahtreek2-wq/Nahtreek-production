jest.mock('../src/config/runtime', () => ({
  runtimeConfig: {environment: 'production'},
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

it('signs in with a mobile OTP outside Preview', async () => {
  expect(
    screen.root
      .findAllByType(Input)
      .some(node => node.props.label === 'Mobile number'),
  ).toBe(true);
  post.mockResolvedValueOnce({});
  await renderer.act(async () => input('Mobile number', '9000012345'));
  await renderer.act(async () => press('Send verification code'));
  expect(post).toHaveBeenCalledWith('/auth/otp/request', {
    phoneNumber: '+919000012345',
  });
  post.mockResolvedValueOnce({
    accessToken: 'otp.access',
    refreshToken: 'otp.refresh',
    user: {id: 'client-1', fullName: 'OTP Client'},
  });
  await renderer.act(async () => input('Verification code', '123456'));
  await renderer.act(async () => press('Verify and login'));
  expect(post).toHaveBeenCalledWith('/auth/otp/verify', {
    phoneNumber: '+919000012345',
    code: '123456',
  });
  expect(useSessionStore.getState().user).toMatchObject({
    fullName: 'OTP Client',
  });
});

it('rejects a bad mobile number before any request', async () => {
  await renderer.act(async () => input('Mobile number', '123'));
  await renderer.act(async () => press('Send verification code'));
  expect(post).not.toHaveBeenCalled();
  const {Text} = require('react-native');
  expect(
    screen.root
      .findAllByType(Text)
      .some(
        node =>
          node.props.children === 'Enter a valid 10-digit Indian mobile number',
      ),
  ).toBe(true);
});
