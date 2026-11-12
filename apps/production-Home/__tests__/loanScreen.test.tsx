jest.mock('../src/services/apiClient', () => ({
  api: {post: jest.fn(), get: jest.fn()},
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));
import React from 'react';
import renderer from 'react-test-renderer';
import {Text} from 'react-native';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {LoanScreen} from '../src/screens/LoanScreen';
import {Button, Input} from '../src/components/ui';
import {api} from '../src/services/apiClient';
import {useSessionStore} from '../src/stores/session';

const post = api.post as jest.Mock;
const mockGoBack = jest.fn();
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({goBack: mockGoBack, navigate: mockNavigate}),
}));

const USER = {
  id: 'client-1',
  fullName: 'Loan QA',
  phoneNumber: '+919000012345',
  roles: ['CLIENT'],
  homeCity: 'Chennai',
};

let screen: renderer.ReactTestRenderer;

async function renderLoan() {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  await renderer.act(async () => {
    screen = renderer.create(
      <QueryClientProvider client={client}>
        <LoanScreen />
      </QueryClientProvider>,
    );
  });
}

beforeEach(() => {
  useSessionStore.setState({user: USER} as any);
  post.mockReset();
  mockGoBack.mockReset();
  mockNavigate.mockReset();
});

afterEach(async () => {
  await renderer.act(async () => screen.unmount());
  jest.restoreAllMocks();
});

function texts() {
  return screen.root
    .findAllByType(Text)
    .map(t =>
      (Array.isArray(t.props.children) ? t.props.children.join('') : t.props.children ?? '').toString(),
    )
    .join('\n');
}

function press(label: string) {
  screen.root
    .findAllByType(Button)
    .find(node => node.props.label === label)!
    .props.onPress();
}

it('explains the assistance and files a callback ticket', async () => {
  post.mockResolvedValue({id: 'ticket-1'});
  await renderLoan();
  expect(texts()).toContain('Buying, building, or renovating?');
  await renderer.act(async () => {
    screen.root
      .findAllByType(Input)
      .find(node => node.props.label === 'Loan amount (₹ lakh, optional)')!
      .props.onChangeText('25');
  });
  await renderer.act(async () => press('Request callback'));
  await renderer.act(async () => {
    await new Promise(resolve => setTimeout(resolve, 20));
  });
  expect(post).toHaveBeenCalledWith('/support/tickets', {
    subject: 'Home loan assistance',
    message: expect.stringContaining('around ₹25 lakh'),
  });
  expect(post).toHaveBeenCalledWith('/support/tickets', {
    subject: 'Home loan assistance',
    message: expect.stringContaining('Loan QA'),
  });
  await renderer.act(async () => {});
  expect(texts()).toContain('Request received');
});

it('asks signed-out users to sign in instead of showing the form', async () => {
  useSessionStore.setState({user: null} as any);
  await renderLoan();
  expect(texts()).toContain('Sign in to continue');
  await renderer.act(async () => press('Login or create account'));
  expect(mockNavigate).toHaveBeenCalledWith('Login');
  expect(post).not.toHaveBeenCalled();
});
