import React from 'react';
import renderer from 'react-test-renderer';
import {NativeModules, Text} from 'react-native';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';

const mockGetStaticMapUrl = jest.fn().mockResolvedValue('https://maps.example/static.png');
let mockParams: Record<string, unknown> = {};

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({goBack: jest.fn()}),
  useRoute: () => ({params: mockParams}),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));
jest.mock('../src/services/apiClient', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  api: {get: jest.fn(), post: jest.fn()},
}));

let MapPreviewScreen: React.ComponentType;
let mockedApi: {get: jest.Mock};

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {latitude: 11.0, longitude: 77.0, address: 'Home Street 1'};
  // The screen reads the native bridge at module load, so it must be
  // required lazily, after the bridge is installed.
  (NativeModules as Record<string, unknown>).NahtreekRuntimeConfig = {
    getStaticMapUrl: mockGetStaticMapUrl,
  };
  MapPreviewScreen = require('../src/screens/MapPreviewScreen').MapPreviewScreen;
  mockedApi = require('../src/services/apiClient').api;
  mockedApi.get.mockResolvedValue({stage: 'EN_ROUTE', tracking: null});
});

function setup() {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  let screen!: renderer.ReactTestRenderer;
  const render = async () => {
    await renderer.act(async () => {
      screen = renderer.create(<QueryClientProvider client={client}>
        <MapPreviewScreen />
      </QueryClientProvider>);
    });
    await renderer.act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  };
  const texts = () => screen.root.findAllByType(Text)
    .map(t => (Array.isArray(t.props.children) ? t.props.children.join('') : (t.props.children ?? '')).toString()).join('\n');
  const done = () => renderer.act(() => screen.unmount());
  return {render, texts, done};
}

it('shows a static destination pin with no booking attached', async () => {
  const t = setup();
  await t.render();
  expect(t.texts()).toContain('Home Street 1');
  expect(t.texts()).not.toContain('Live professional location');
  expect(mockGetStaticMapUrl).toHaveBeenCalledWith(11.0, 77.0);
  expect(mockedApi.get).not.toHaveBeenCalled();
  t.done();
});

it('follows the professional live location for travelling bookings', async () => {
  mockParams = {...mockParams, requestId: 'req-1'};
  mockedApi.get.mockResolvedValue({
    stage: 'EN_ROUTE',
    tracking: {latitude: 11.05, longitude: 77.05, updatedAt: new Date().toISOString(), stale: false},
  });
  const t = setup();
  await t.render();
  expect(t.texts()).toContain('Professional is on the way');
  expect(t.texts()).toContain('Live professional location');
  expect(mockGetStaticMapUrl).toHaveBeenCalledWith(11.05, 77.05);
  t.done();
});

it('flags stale tracking instead of pretending it is live', async () => {
  mockParams = {...mockParams, requestId: 'req-1'};
  mockedApi.get.mockResolvedValue({
    stage: 'EN_ROUTE',
    tracking: {latitude: 11.05, longitude: 77.05, updatedAt: new Date(Date.now() - 600000).toISOString(), stale: true},
  });
  const t = setup();
  await t.render();
  expect(t.texts()).toContain('Location is stale');
  t.done();
});

it('says tracking starts on departure when the pro has not left yet', async () => {
  mockParams = {...mockParams, requestId: 'req-1'};
  mockedApi.get.mockResolvedValue({stage: 'ACCEPTED', tracking: null});
  const t = setup();
  await t.render();
  expect(t.texts()).toContain('Live tracking starts when the professional heads your way.');
  expect(mockGetStaticMapUrl).toHaveBeenCalledWith(11.0, 77.0);
  t.done();
});
