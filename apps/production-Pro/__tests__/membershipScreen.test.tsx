import React from 'react';
import renderer from 'react-test-renderer';
import {Alert, Text} from 'react-native';
import {NavigationContainer} from '@react-navigation/native';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {MembershipScreen} from '../src/screens/MembershipScreen';
import type {MembershipHooks, MembershipView} from '../src/screens/MembershipScreen';
import {CheckoutCancelledError} from '../../../packages/mobile-booking/razorpayGateway';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));
jest.mock('@react-navigation/bottom-tabs', () => ({
  useBottomTabBarHeight: () => 0,
}));

const terms = {memberFeeBps: 700, standardFeeBps: 1000, memberDuesBlockPaisa: 200000,
  standardDuesBlockPaisa: 50000, freeJobsPerMonth: 1};
const none: MembershipView = {status: 'NONE', effective: false, currentPeriodStart: null,
  currentPeriodEnd: null, cancelAtPeriodEnd: false, feePaisa: 39900, currency: 'INR', terms};
const active: MembershipView = {...none, status: 'ACTIVE', effective: true,
  currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString()};

function setup(hooks: MembershipHooks) {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  let screen!: renderer.ReactTestRenderer;
  const render = async () => {
    await renderer.act(async () => {
      screen = renderer.create(<NavigationContainer><QueryClientProvider client={client}>
        <MembershipScreen hooks={hooks} />
      </QueryClientProvider></NavigationContainer>);
    });
    await renderer.act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  };
  const texts = () => screen.root.findAllByType(Text)
    .map(t => (Array.isArray(t.props.children) ? t.props.children.join('') : (t.props.children ?? '')).toString()).join('\n');
  const press = async (label: string) => {
    const button = screen.root.findByProps({accessibilityLabel: label});
    await renderer.act(async () => { button.props.onPress(); });
    await renderer.act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  };
  const done = () => renderer.act(() => screen.unmount());
  return {render, texts, press, done};
}

it('subscribes through checkout and confirm', async () => {
  const hooks: MembershipHooks = {
    load: jest.fn().mockResolvedValue(none),
    subscribe: jest.fn().mockResolvedValue({...none, status: 'PENDING', keyId: 'k', subscriptionId: 'sub', shortUrl: 'u'}),
    confirm: jest.fn().mockResolvedValue(active),
    cancel: jest.fn(),
    checkout: jest.fn().mockResolvedValue({razorpaySubscriptionId: 'sub'}),
  };
  const t = setup(hooks);
  await t.render();
  expect(t.texts()).toContain('7% commission, not 10%');
  await t.press('Subscribe to Pro membership');
  expect(hooks.subscribe).toHaveBeenCalledTimes(1);
  expect(hooks.checkout).toHaveBeenCalledWith(expect.objectContaining({keyId: 'k', subscriptionId: 'sub'}));
  expect(hooks.confirm).toHaveBeenCalledTimes(1);
  t.done();
});

it('renders fallback terms when an old backend omits them', async () => {
  const {terms: _drop, ...legacy} = none;
  const hooks: MembershipHooks = {load: jest.fn().mockResolvedValue(legacy),
    subscribe: jest.fn(), confirm: jest.fn(), cancel: jest.fn(), checkout: jest.fn()};
  const t = setup(hooks);
  await t.render();
  expect(t.texts()).toContain('7% commission, not 10%');
  await t.done();
});

it('offers resubscribe during the cancelled paid tail', async () => {
  const tail: MembershipView = {...active, status: 'CANCELLED', cancelAtPeriodEnd: true};
  const hooks: MembershipHooks = {load: jest.fn().mockResolvedValue(tail),
    subscribe: jest.fn().mockResolvedValue(tail), confirm: jest.fn().mockResolvedValue(tail),
    cancel: jest.fn(), checkout: jest.fn()};
  const t = setup(hooks);
  await t.render();
  expect(t.texts()).toContain('no double charge');
  await t.press('Resubscribe to Pro membership');
  expect(hooks.subscribe).toHaveBeenCalled();
  await t.done();
});

it('renders price and rates from server terms, not hardcoded figures', async () => {
  const custom = {...none, feePaisa: 49900,
    terms: {...terms, memberFeeBps: 500, memberDuesBlockPaisa: 300000}};
  const hooks: MembershipHooks = {
    load: jest.fn().mockResolvedValue(custom),
    subscribe: jest.fn(), confirm: jest.fn(), cancel: jest.fn(), checkout: jest.fn(),
  };
  const t = setup(hooks);
  await t.render();
  expect(t.texts()).toContain('₹499');
  expect(t.texts()).toContain('5% commission, not 10%');
  expect(t.texts()).toContain('₹3,000 dues room, not ₹500');
  t.done();
});

it('shows active benefits and cancels with confirmation', async () => {
  const hooks: MembershipHooks = {
    load: jest.fn().mockResolvedValue(active),
    subscribe: jest.fn(), confirm: jest.fn(),
    cancel: jest.fn().mockResolvedValue({...active, status: 'CANCELLED', cancelAtPeriodEnd: true}),
    checkout: jest.fn(),
  };
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(((...args: any[]) => {
    const buttons = args[2] as {text: string; onPress?: () => void}[];
    buttons.find(button => button.text === 'Cancel membership')?.onPress?.();
  }) as any);
  try {
    const t = setup(hooks);
    await t.render();
    expect(t.texts()).toContain('PRO MEMBER');
    await t.press('Cancel membership');
    expect(hooks.cancel).toHaveBeenCalledTimes(1);
    t.done();
  } finally {
    alert.mockRestore();
  }
});

it('proves lifetime savings to active members', async () => {
  const hooks: MembershipHooks = {
    load: jest.fn().mockResolvedValue({...active, lifetimeSavingsPaisa: 10500, jobsAtMemberRate: 3}),
    subscribe: jest.fn(), confirm: jest.fn(), cancel: jest.fn(), checkout: jest.fn(),
  };
  const t = setup(hooks);
  await t.render();
  expect(t.texts()).toContain('You have saved ₹105 so far');
  expect(t.texts()).toContain('3 jobs billed below the 10% standard rate');
  t.done();
});

it('treats checkout cancellation as neutral', async () => {
  const hooks: MembershipHooks = {
    load: jest.fn().mockResolvedValue(none),
    subscribe: jest.fn().mockResolvedValue({...none, status: 'PENDING', keyId: 'k', subscriptionId: 'sub', shortUrl: 'u'}),
    confirm: jest.fn(),
    cancel: jest.fn(),
    checkout: jest.fn().mockRejectedValue(new CheckoutCancelledError()),
  };
  const t = setup(hooks);
  await t.render();
  await t.press('Subscribe to Pro membership');
  expect(hooks.confirm).not.toHaveBeenCalled();
  expect(t.texts()).toContain('Nothing was charged');
  t.done();
});

it('cancels a stuck pending checkout', async () => {
  const pending: MembershipView = {...none, status: 'PENDING'};
  const hooks: MembershipHooks = {
    load: jest.fn().mockResolvedValue(pending),
    subscribe: jest.fn(), confirm: jest.fn(),
    cancel: jest.fn().mockResolvedValue(none),
    checkout: jest.fn(),
  };
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(((...args: any[]) => {
    const buttons = args[2] as {text: string; onPress?: () => void}[];
    buttons.find(button => button.text === 'Cancel checkout')?.onPress?.();
  }) as any);
  try {
    const t = setup(hooks);
    await t.render();
    expect(t.texts()).toContain('Complete authorization');
    await t.press('Cancel this checkout');
    expect(hooks.cancel).toHaveBeenCalledTimes(1);
    t.done();
  } finally {
    alert.mockRestore();
  }
});

it('skips checkout when the server replays an effective membership', async () => {
  const hooks: MembershipHooks = {
    load: jest.fn().mockResolvedValue(none),
    subscribe: jest.fn().mockResolvedValue({...active, keyId: 'k', subscriptionId: 'sub', shortUrl: null}),
    confirm: jest.fn().mockResolvedValue(active),
    cancel: jest.fn(),
    checkout: jest.fn(),
  };
  const t = setup(hooks);
  await t.render();
  await t.press('Subscribe to Pro membership');
  expect(hooks.checkout).not.toHaveBeenCalled();
  expect(hooks.confirm).toHaveBeenCalledTimes(1);
  t.done();
});

it('explains a failed mandate instead of fake-activating', async () => {
  const hooks: MembershipHooks = {
    load: jest.fn().mockResolvedValue(none),
    subscribe: jest.fn().mockResolvedValue({...none, status: 'PENDING', keyId: 'k', subscriptionId: 'sub', shortUrl: 'u'}),
    confirm: jest.fn().mockResolvedValue({...none, status: 'PAST_DUE'}),
    cancel: jest.fn(),
    checkout: jest.fn().mockResolvedValue({razorpaySubscriptionId: 'sub'}),
  };
  const t = setup(hooks);
  await t.render();
  await t.press('Subscribe to Pro membership');
  expect(t.texts()).toContain('No money was taken');
  t.done();
});

it('confirms instead of failing when a checkout error hides an active membership', async () => {
  const load = jest.fn()
    .mockResolvedValueOnce(none)
    .mockResolvedValue(active);
  const hooks: MembershipHooks = {
    load,
    subscribe: jest.fn().mockResolvedValue({...none, status: 'PENDING', keyId: 'k', subscriptionId: 'sub', shortUrl: 'u'}),
    confirm: jest.fn(),
    cancel: jest.fn(),
    checkout: jest.fn().mockRejectedValue(new Error('Bridge result lost')),
  };
  const t = setup(hooks);
  await t.render();
  await t.press('Subscribe to Pro membership');
  await renderer.act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(t.texts()).toContain('Your Pro benefits are active');
  expect(t.texts()).not.toContain('Bridge result lost');
  t.done();
});

it('lets the user check now during activation instead of watching the poll', async () => {
  const pending: MembershipView = {...none, status: 'PENDING'};
  const hooks: MembershipHooks = {
    load: jest.fn()
      .mockResolvedValueOnce(none)
      .mockResolvedValueOnce(none)
      .mockResolvedValue(active),
    subscribe: jest.fn().mockResolvedValue({...pending, keyId: 'k', subscriptionId: 'sub', shortUrl: 'u'}),
    confirm: jest.fn()
      .mockResolvedValueOnce(pending)
      .mockResolvedValue(active),
    cancel: jest.fn(),
    checkout: jest.fn().mockResolvedValue({razorpaySubscriptionId: 'sub'}),
  };
  const t = setup(hooks);
  await t.render();
  await t.press('Subscribe to Pro membership');
  expect(t.texts()).toContain('activating your membership');
  await t.press('Check membership now');
  await renderer.act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(hooks.confirm).toHaveBeenCalledTimes(2);
  expect(t.texts()).toContain('Your Pro benefits are active');
  t.done();
});

it('explains plainly when billing is not enabled yet', async () => {
  const hooks: MembershipHooks = {
    load: jest.fn().mockResolvedValue(none),
    subscribe: jest.fn().mockRejectedValue(Object.assign(new Error('Service Unavailable'), {status: 503})),
    confirm: jest.fn(),
    cancel: jest.fn(),
    checkout: jest.fn(),
  };
  const t = setup(hooks);
  await t.render();
  await t.press('Subscribe to Pro membership');
  expect(t.texts()).toContain('Membership billing is not available yet');
  expect(hooks.checkout).not.toHaveBeenCalled();
  t.done();
});
