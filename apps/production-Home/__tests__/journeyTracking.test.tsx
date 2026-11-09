import React from 'react';
import renderer from 'react-test-renderer';
import {Image, NativeModules, Text} from 'react-native';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {JourneyPanel} from '../../../packages/mobile-booking/JourneyPanel';

const getStaticMapUrl = jest.fn();
(NativeModules as any).NahtreekRuntimeConfig = {getStaticMapUrl};

const journey = (over: Record<string, unknown> = {}) => ({stage: 'EN_ROUTE', revision: 3, mode: 'ASAP',
  recipientName: 'Ravi', recipientPhone: '+9112345', expiresAt: new Date(Date.now() + 3600000).toISOString(),
  quoteAccepted: false, ...over});
const tracking = {latitude: 13.0012, longitude: 80.2008, updatedAt: new Date().toISOString(), stale: false};

function setup(load: () => Promise<any>) {
  const client = new QueryClient({defaultOptions: {queries: {retry: false, refetchInterval: false as any}}});
  let screen!: renderer.ReactTestRenderer;
  const render = async () => {
    await renderer.act(async () => {
      screen = renderer.create(<QueryClientProvider client={client}>
        <JourneyPanel id="req" client load={load} act={jest.fn()} />
      </QueryClientProvider>);
    });
    await renderer.act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
  };
  const texts = () => screen.root.findAllByType(Text)
    .map(t => (Array.isArray(t.props.children) ? t.props.children.join('') : (t.props.children ?? '')).toString()).join('\n');
  const done = () => renderer.act(() => screen.unmount());
  return {render, texts, done, root: () => screen.root};
}

beforeEach(() => jest.clearAllMocks());

it('shows the live map while the professional is on the way', async () => {
  getStaticMapUrl.mockResolvedValue('https://maps.example/pin.png');
  const t = setup(() => Promise.resolve(journey({tracking})));
  await t.render();
  await renderer.act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(t.texts()).toContain('Professional’s latest location');
  expect(t.root().findAllByType(Image)).toHaveLength(1);
  expect(getStaticMapUrl).toHaveBeenCalledWith(13.0012, 80.2008);
  t.done();
});

it('falls back to coordinates with a retry when the map image fails', async () => {
  getStaticMapUrl.mockRejectedValue(new Error('no key'));
  const t = setup(() => Promise.resolve(journey({tracking})));
  await t.render();
  await renderer.act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(t.texts()).toContain('Last position 13.0012, 80.2008');
  const retry = t.root().findByProps({accessibilityLabel: 'Retry loading the tracking map'});
  getStaticMapUrl.mockResolvedValue('https://maps.example/pin.png');
  await renderer.act(async () => { retry.props.onPress(); });
  await renderer.act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(getStaticMapUrl).toHaveBeenCalledTimes(2);
  t.done();
});

it('explains the missing map before departure and while waiting for GPS', async () => {
  const accepted = setup(() => Promise.resolve(journey({stage: 'ACCEPTED'})));
  await accepted.render();
  expect(accepted.texts()).toContain('appears here once the professional starts the journey');
  accepted.done();
  const waiting = setup(() => Promise.resolve(journey({stage: 'EN_ROUTE'})));
  await waiting.render();
  expect(waiting.texts()).toContain('no live location has arrived yet');
  waiting.done();
});

it('shows no tracking card once the booking is closed', async () => {
  const t = setup(() => Promise.resolve(journey({stage: 'COMPLETED'})));
  await t.render();
  expect(t.texts()).not.toContain('live location');
  expect(t.texts()).not.toContain('tracking map');
  t.done();
});
