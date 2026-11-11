import React from 'react';
import renderer from 'react-test-renderer';
import {Text, TextInput} from 'react-native';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';

const mockSendMutate = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({goBack: jest.fn()}),
  useRoute: () => ({params: {conversationId: 'c1', title: 'Ananya', subtitle: 'Re: consult', avatarUrl: null}}),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));
jest.mock('../src/stores/session', () => ({
  useSessionStore: (selector: (state: {user: {id: string; fullName: string}; accessToken: string | null}) => unknown) =>
    selector({user: {id: 'me', fullName: 'Client'}, accessToken: null}),
}));
jest.mock('../src/stores/toast', () => ({useToast: () => jest.fn()}));
jest.mock('../src/services/apiClient', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  api: {get: jest.fn().mockResolvedValue([]), post: jest.fn()},
}));
jest.mock('../src/services/queries', () => {
  const actual = jest.requireActual('../src/services/queries');
  return {
    ...actual,
    // NOTE: useMessagesList stays real on purpose — the optimistic bubble
    // lands in the query cache, and a stubbed return value would hide it.
    useSendMessage: () => ({mutate: mockSendMutate, isPending: false}),
    useMarkConversationRead: () => ({mutate: jest.fn()}),
  };
});
jest.mock('../src/services/chatSocket', () => ({openChatSocket: () => null}));
jest.mock('../src/services/config', () => ({isApiConfigured: true}));

import {ChatScreen} from '../src/screens/ChatScreen';

type MutationHandlers = {onSuccess?: (message: object) => void; onError?: () => void; onSettled?: () => void};

function setup() {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  let screen!: renderer.ReactTestRenderer;
  const render = async () => {
    await renderer.act(async () => {
      screen = renderer.create(<QueryClientProvider client={client}>
        <ChatScreen />
      </QueryClientProvider>);
    });
  };
  const texts = () => screen.root.findAllByType(Text)
    .map(t => (Array.isArray(t.props.children) ? t.props.children.join('') : (t.props.children ?? '')).toString());
  const done = () => renderer.act(() => screen.unmount());
  return {render, texts, done, root: () => screen.root};
}

beforeEach(() => jest.clearAllMocks());

async function sendDraft(t: ReturnType<typeof setup>, draft: string) {
  let captured: MutationHandlers = {};
  mockSendMutate.mockImplementationOnce((_vars: object, handlers: MutationHandlers) => {
    captured = handlers;
  });
  await renderer.act(async () => {
    t.root().findByType(TextInput).props.onChangeText(draft);
  });
  await renderer.act(async () => {
    t.root().findByProps({accessibilityLabel: 'Send message'}).props.onPress();
  });
  return captured;
}

it('shows the message instantly, then replaces the local bubble on success', async () => {
  const t = setup();
  await t.render();
  const captured = await sendDraft(t, 'hello there');
  // Optimistic bubble is visible before any server round-trip.
  expect(t.texts()).toContain('hello there');
  const serverMessage = {id: 'm1', conversationId: 'c1', senderUserId: 'me',
    senderName: 'Client', content: 'hello there', createdAt: new Date().toISOString()};
  await renderer.act(async () => {
    captured.onSuccess?.(serverMessage);
    captured.onSettled?.();
  });
  // Exactly one bubble: the local id was swapped for the server id.
  expect(t.texts().filter(copy => copy === 'hello there')).toHaveLength(1);
  t.done();
});

it('pulls the bubble back and restores the draft when sending fails', async () => {
  const t = setup();
  await t.render();
  const captured = await sendDraft(t, 'try again');
  expect(t.texts()).toContain('try again');
  await renderer.act(async () => {
    captured.onError?.();
    captured.onSettled?.();
  });
  expect(t.texts()).not.toContain('try again');
  // Draft restored into the composer so the user can retry without retyping.
  expect(t.root().findByType(TextInput).props.value).toBe('try again');
  t.done();
});
