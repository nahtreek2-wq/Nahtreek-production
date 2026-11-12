jest.mock('../src/services/apiClient', () => ({
  api: {get: jest.fn(), post: jest.fn(), patch: jest.fn()},
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));
const navState = {params: {id: 'req-1', kind: 'engineering'}};
jest.mock('@react-navigation/native', () => ({
  useRoute: () => navState,
  useNavigation: () => ({goBack: jest.fn(), navigate: jest.fn(), getParent: jest.fn()}),
}));
jest.mock('../src/components/TravelToJobCard', () => {
  const {Text} = require('react-native');
  return {TravelToJobCard: () => <Text>TRAVEL-CARD</Text>};
});
jest.mock('../src/components/CollectPaymentCard', () => ({CollectPaymentCard: () => null}));
jest.mock('../src/components/JobContextVisual', () => ({JobContextVisual: () => null}));
jest.mock('../src/components/ScrollMotionBar', () => ({
  ScrollMotionBar: () => null,
  useScrollMotion: () => ({offset: {value: 0}, reducedMotion: true, onScroll: jest.fn()}),
}));
import React from 'react';
import renderer from 'react-test-renderer';
import {Text} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {RequestDetailScreen} from '../src/screens/RequestDetailScreen';
import {api} from '../src/services/apiClient';

const get = api.get as jest.Mock;
let screen: renderer.ReactTestRenderer;

const detail = (over: Record<string, unknown> = {}) => ({
  id: 'req-1',
  projectTitle: 'Wall crack',
  projectDescription: 'Fix it',
  clientName: 'Veda',
  locationAddress: '10d Salem Main Rd',
  latitude: 13.0,
  longitude: 80.2,
  status: 'ACCEPTED',
  createdAt: new Date().toISOString(),
  statusHistory: [],
  ...over,
});

async function renderDetail(status: string) {
  get.mockResolvedValue(detail({status}));
  navState.params = {id: 'req-1', kind: 'engineering'} as any;
  const client = new QueryClient({
    defaultOptions: {queries: {retry: false}},
  });
  await renderer.act(async () => {
    screen = renderer.create(
      <SafeAreaProvider
        initialMetrics={{
          frame: {x: 0, y: 0, width: 320, height: 640},
          insets: {top: 24, bottom: 0, left: 0, right: 0},
        }}>
        <QueryClientProvider client={client}>
          <RequestDetailScreen />
        </QueryClientProvider>
      </SafeAreaProvider>,
    );
  });
  await renderer.act(async () => {
    await new Promise(resolve => setTimeout(resolve, 30));
  });
}

afterEach(async () => {
  await renderer.act(async () => screen.unmount());
  jest.restoreAllMocks();
});

function textOrder(): string {
  return screen.root
    .findAllByType(Text)
    .map(t =>
      (Array.isArray(t.props.children)
        ? t.props.children.join('')
        : t.props.children ?? ''
      ).toString(),
    )
    .join('\n');
}

it('shows the travel card instead of a duplicate map section once accepted', async () => {
  await renderDetail('ACCEPTED');
  const text = textOrder();
  expect(text).toContain('TRAVEL-CARD');
  expect(text).not.toContain('Where to go');
});

it('shows the map section before acceptance', async () => {
  await renderDetail('PENDING');
  const text = textOrder();
  expect(text).not.toContain('TRAVEL-CARD');
  expect(text).toContain('Where to go');
});

it('orders primary action before chat', async () => {
  await renderDetail('ACCEPTED');
  const text = textOrder();
  expect(text.indexOf('Start this job')).toBeGreaterThanOrEqual(0);
  expect(text.indexOf('Chat with customer')).toBeGreaterThan(
    text.indexOf('Start this job'),
  );
});
