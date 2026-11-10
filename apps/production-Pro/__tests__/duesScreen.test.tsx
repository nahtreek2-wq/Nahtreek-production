import React from 'react';
import renderer from 'react-test-renderer';
import {Alert, Text} from 'react-native';
import {NavigationContainer} from '@react-navigation/native';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {DuesScreen} from '../src/screens/DuesScreen';
import type {DuesHooks, DuesView} from '../src/screens/DuesScreen';
import {CheckoutCancelledError} from '../../../packages/mobile-booking/razorpayGateway';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));
jest.mock('@react-navigation/bottom-tabs', () => ({
  useBottomTabBarHeight: () => 0,
}));
jest.spyOn(Alert, 'alert').mockImplementation(((title: string, message?: string, buttons?: {text: string; onPress?: () => void}[]) => {
  buttons?.find(b => b.text.startsWith('Pay'))?.onPress?.();
}) as any);

const terms = {memberFeeBps: 700, standardFeeBps: 1000, memberDuesBlockPaisa: 200000,
  standardDuesBlockPaisa: 50000, freeJobsPerMonth: 1};
const empty: DuesView = {duesPaisa: 0, blocked: false, blockThresholdPaisa: 50000, jobs: [], terms};
const owed: DuesView = {duesPaisa: 25000, blocked: false, blockThresholdPaisa: 50000, terms, jobs: [
  {id: 'a', serviceRequestId: 'req-aaa', amountPaisa: 200000, platformFeePaisa: 20000, createdAt: '2026-11-01T00:00:00Z'},
  {id: 'b', serviceRequestId: 'req-bbb', amountPaisa: 50000, platformFeePaisa: 5000, createdAt: '2026-11-02T00:00:00Z'},
]};
const blocked: DuesView = {...owed, duesPaisa: 50000, blocked: true};

function setup(hooks: DuesHooks) {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  let screen!: renderer.ReactTestRenderer;
  const render = async () => {
    await renderer.act(async () => {
      screen = renderer.create(<NavigationContainer><QueryClientProvider client={client}>
        <DuesScreen hooks={hooks} />
      </QueryClientProvider></NavigationContainer>);
    });
    await renderer.act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  };
  const texts = () => screen.root.findAllByType(Text)
    .map(t => (Array.isArray(t.props.children) ? t.props.children.join('') : (t.props.children ?? '')).toString()).join('\n');
  const pressPay = async () => {
    const button = screen.root.findByProps({accessibilityLabel: 'Settle dues'});
    await renderer.act(async () => { button.props.onPress(); });
    await renderer.act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  };
  const done = () => renderer.act(() => screen.unmount());
  return {render, texts, pressPay, done};
}

const order = {settlementId: 'stl', keyId: 'k', orderId: 'o', amountPaisa: 25000, currency: 'INR'};
const checkoutResult = {razorpayOrderId: 'o', razorpayPaymentId: 'pay', razorpaySignature: 's'};

it('shows empty dues with no pay button', async () => {
  const hooks: DuesHooks = {load: jest.fn().mockResolvedValue(empty),
    order: jest.fn(), verify: jest.fn(), checkout: jest.fn()};
  const t = setup(hooks);
  await t.render();
  expect(t.texts()).toContain('No dues');
  expect(() => t.texts()).not.toThrow();
  t.done();
});

it('warns when dues block new jobs', async () => {
  const hooks: DuesHooks = {load: jest.fn().mockResolvedValue(blocked),
    order: jest.fn(), verify: jest.fn(), checkout: jest.fn()};
  const t = setup(hooks);
  await t.render();
  expect(t.texts()).toContain('New jobs are paused');
  expect(t.texts()).toContain('₹500');
  t.done();
});

it('settles dues through order, checkout and verify', async () => {
  const hooks: DuesHooks = {load: jest.fn().mockResolvedValue(owed),
    order: jest.fn().mockResolvedValue(order), verify: jest.fn().mockResolvedValue({settled: true}),
    checkout: jest.fn().mockResolvedValue(checkoutResult)};
  const t = setup(hooks);
  await t.render();
  expect(t.texts()).toContain('₹250');
  await t.pressPay();
  expect(hooks.order).toHaveBeenCalledTimes(1);
  expect(hooks.checkout).toHaveBeenCalledWith(expect.objectContaining({orderId: 'o', amountPaisa: 25000, keyId: 'k'}));
  expect(hooks.verify).toHaveBeenCalledWith({settlementId: 'stl', ...checkoutResult});
  t.done();
});

it('treats a cancelled checkout as no charge', async () => {
  const hooks: DuesHooks = {load: jest.fn().mockResolvedValue(owed),
    order: jest.fn().mockResolvedValue(order), verify: jest.fn(),
    checkout: jest.fn().mockRejectedValue(new CheckoutCancelledError())};
  const t = setup(hooks);
  await t.render();
  await t.pressPay();
  expect(hooks.verify).not.toHaveBeenCalled();
  expect(t.texts()).toContain('Nothing was charged');
  t.done();
});

it('shows members their rupee savings from the 7% rate', async () => {
  const memberView: DuesView = {duesPaisa: 17500, blocked: false, blockThresholdPaisa: 50000, isMember: true, terms,
    memberSavingsPaisa: 7500, jobs: [
      {id: 'a', serviceRequestId: 'req-aaa', amountPaisa: 200000, platformFeePaisa: 14000, createdAt: '2026-11-01T00:00:00Z'},
      {id: 'b', serviceRequestId: 'req-bbb', amountPaisa: 50000, platformFeePaisa: 3500, createdAt: '2026-11-02T00:00:00Z'},
    ]};
  const hooks: DuesHooks = {load: jest.fn().mockResolvedValue(memberView),
    order: jest.fn(), verify: jest.fn(), checkout: jest.fn()};
  const t = setup(hooks);
  await t.render();
  expect(t.texts()).toContain('Membership saved you ₹75');
  t.done();
});

it('shows non-members what membership would have saved', async () => {
  const hooks: DuesHooks = {load: jest.fn().mockResolvedValue({...owed, isMember: false}),
    order: jest.fn(), verify: jest.fn(), checkout: jest.fn()};
  const t = setup(hooks);
  await t.render();
  // First job free (₹200) plus 10%-minus-7% on the second (₹15) = ₹215.
  expect(t.texts()).toContain('Members would have saved up to ₹215 here');
  t.done();
});

it('lists Plus penalties inside dues with plain reasons', async () => {
  const view: DuesView = {duesPaisa: 5000, blocked: false, blockThresholdPaisa: 50000, jobs: [], terms,
    penalties: [{id: 'pen-1', serviceRequestId: 'req-abcdef', amountPaisa: 5000, reason: 'LATE_ARRIVAL', createdAt: '2026-11-03T00:00:00Z'}]};
  const hooks: DuesHooks = {load: jest.fn().mockResolvedValue(view),
    order: jest.fn(), verify: jest.fn(), checkout: jest.fn()};
  const t = setup(hooks);
  await t.render();
  expect(t.texts()).toContain('₹50 penalty');
  expect(t.texts()).toContain('Late arrival to a Plus booking');
  expect(t.texts()).toContain('Settle ₹50');
  t.done();
});

it('refreshes dues after a failed verify so the pay button never shows stale dues', async () => {
  const load = jest.fn().mockResolvedValue(owed);
  const hooks: DuesHooks = {load,
    order: jest.fn().mockResolvedValue(order), verify: jest.fn().mockRejectedValue(new Error('Network failed')),
    checkout: jest.fn().mockResolvedValue(checkoutResult)};
  const t = setup(hooks);
  await t.render();
  const loadsBefore = load.mock.calls.length;
  await t.pressPay();
  expect(hooks.verify).toHaveBeenCalledWith({settlementId: 'stl', ...checkoutResult});
  expect(t.texts()).toContain('Network failed');
  expect(load.mock.calls.length).toBeGreaterThan(loadsBefore);
  t.done();
});

it('polls verify while Razorpay capture lags instead of failing', async () => {
  // Fake timers from the start: the shared setup() helper sleeps on real
  // timeouts, so this test renders manually and flushes with empty acts.
  jest.useFakeTimers();
  try {
    const notCaptured = Object.assign(new Error('Payment not captured yet at Razorpay'), {status: 409});
    const load = jest.fn().mockResolvedValue(owed);
    const hooks: DuesHooks = {load,
      order: jest.fn().mockResolvedValue(order), verify: jest.fn().mockRejectedValue(notCaptured),
      checkout: jest.fn().mockResolvedValue(checkoutResult)};
    const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
    let screen!: renderer.ReactTestRenderer;
    await renderer.act(async () => {
      screen = renderer.create(<NavigationContainer><QueryClientProvider client={client}>
        <DuesScreen hooks={hooks} />
      </QueryClientProvider></NavigationContainer>);
    });
    // advanceTimersByTimeAsync also flushes faked microtasks (React Query
    // notifies through queueMicrotask), which empty acts cannot release.
    const flush = async () => { await renderer.act(async () => { await jest.advanceTimersByTimeAsync(10); }); };
    await flush();
    await renderer.act(async () => {
      screen.root.findByProps({accessibilityLabel: 'Settle dues'}).props.onPress();
    });
    await flush();
    const texts = () => screen.root.findAllByType(Text)
      .map(t => (Array.isArray(t.props.children) ? t.props.children.join('') : (t.props.children ?? '')).toString()).join('\n');
    expect(texts()).toContain('Payment received — confirming with Razorpay');
    expect(texts()).not.toContain('Settle ₹250');
    await renderer.act(async () => { await jest.advanceTimersByTimeAsync(41000); });
    // 1 inline verify + 10 polls, then the dues-total fallback check.
    expect(hooks.verify).toHaveBeenCalledTimes(11);
    expect(load.mock.calls.length).toBeGreaterThan(1);
    expect(texts()).toContain('Wait a minute, then reopen this screen — do not pay again.');
    await renderer.act(() => screen.unmount());
  } finally {
    jest.useRealTimers();
  }
});

it('shows non-lag 409s as errors without polling', async () => {
  const mismatch = Object.assign(new Error('Signature mismatch for this settlement'), {status: 409});
  const hooks: DuesHooks = {load: jest.fn().mockResolvedValue(owed),
    order: jest.fn().mockResolvedValue(order), verify: jest.fn().mockRejectedValue(mismatch),
    checkout: jest.fn().mockResolvedValue(checkoutResult)};
  const t = setup(hooks);
  await t.render();
  await t.pressPay();
  expect(hooks.verify).toHaveBeenCalledTimes(1);
  expect(t.texts()).toContain('Signature mismatch for this settlement');
  expect(t.texts()).toContain('Settle ₹250');
  t.done();
});

it('labels engineering dues rows without crashing on a null service id', async () => {
  const view: DuesView = {duesPaisa: 35000, blocked: false, blockThresholdPaisa: 50000, terms, jobs: [
    {id: 'e', serviceRequestId: null, engineerRequestId: 'eng-12345678', amountPaisa: 350000, platformFeePaisa: 35000, createdAt: '2026-11-03T00:00:00Z'},
  ]};
  const hooks: DuesHooks = {load: jest.fn().mockResolvedValue(view),
    order: jest.fn(), verify: jest.fn(), checkout: jest.fn()};
  const t = setup(hooks);
  await t.render();
  expect(t.texts()).toContain('engineering job eng-1234');
  t.done();
});
