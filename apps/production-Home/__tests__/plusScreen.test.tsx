jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));
const mockGoBack = jest.fn();
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({goBack: mockGoBack, navigate: mockNavigate}),
}));
import React from 'react';
import renderer from 'react-test-renderer';
import {Text} from 'react-native';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {PlusScreen, type PlusHooks} from '../src/screens/PlusScreen';
import type {AiPlanView, AiSubscriptionView} from '../src/services/aiBilling';
import {__resetConfirmForTests, useConfirmStore} from '../src/stores/confirm';

beforeEach(__resetConfirmForTests);

const plan: AiPlanView = {feePaisa: 12900, freeMessages: 5, consultDiscountBps: 200,
  consultDiscountCapPaisa: 10000, acceptWindowMs: 15 * 60 * 1000, arrivalGraceMs: 10 * 60 * 1000,
  lateAcceptPenaltyPaisa: 2500, lateArrivalPenaltyPaisa: 5000};
const none: AiSubscriptionView = {status: 'NONE', effective: false, currentPeriodEnd: null,
  cancelAtPeriodEnd: false, feePaisa: 12900, freeUsed: 5, freeQuota: 5};
const active: AiSubscriptionView = {...none, status: 'ACTIVE', effective: true,
  currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString()};

function setup(hooks: PlusHooks) {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}, mutations: {retry: false}}});
  let screen!: renderer.ReactTestRenderer;
  const render = async () => {
    await renderer.act(async () => {
      screen = renderer.create(<QueryClientProvider client={client}><PlusScreen hooks={hooks} /></QueryClientProvider>);
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

async function answerConfirm(value: boolean) {
  await renderer.act(async () => { useConfirmStore.getState().answer(value); });
  await renderer.act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
}

function hooksFor(over: Partial<PlusHooks> = {}): PlusHooks {
  return {load: jest.fn().mockResolvedValue(none), plan: jest.fn().mockResolvedValue(plan),
    subscribe: jest.fn(), confirm: jest.fn(), cancel: jest.fn(), demoActivate: jest.fn(), ...over};
}

it('renders the plan price with benefits and a subscribe action', async () => {
  const hooks = hooksFor({subscribe: jest.fn().mockResolvedValue(active)});
  const t = setup(hooks);
  await t.render();
  expect(t.texts()).toContain('₹129/month');
  expect(t.texts()).toContain('2% off engineer consultations (up to ₹100)');
  expect(t.texts()).toContain('15-minute accept promise on home services');
  await t.press('Subscribe for ₹129/month');
  expect(hooks.subscribe).toHaveBeenCalledTimes(1);
  t.done();
});

it('completes a pending checkout and cancels it with confirmation', async () => {
  const pending: AiSubscriptionView = {...none, status: 'PENDING'};
  const hooks = hooksFor({load: jest.fn().mockResolvedValue(pending),
    cancel: jest.fn().mockResolvedValue(none)});
  const t = setup(hooks);
  await t.render();
  expect(t.texts()).toContain('Complete authorization');
  await t.press('Cancel this checkout');
  expect(useConfirmStore.getState().current).toMatchObject({title: 'Cancel this checkout?'});
  await answerConfirm(true);
  expect(hooks.cancel).toHaveBeenCalledTimes(1);
  t.done();
});

it('shows active benefits with the end date and cancels with confirmation', async () => {
  const hooks = hooksFor({load: jest.fn().mockResolvedValue(active),
    cancel: jest.fn().mockResolvedValue({...active, status: 'CANCELLED', cancelAtPeriodEnd: true})});
  const t = setup(hooks);
  await t.render();
  expect(t.texts()).toContain('PLUS MEMBER');
  expect(t.texts()).toContain('Your Plus benefits are active');
  await t.press('Cancel Plus');
  expect(useConfirmStore.getState().current).toMatchObject({title: 'Cancel Plus?'});
  await answerConfirm(true);
  expect(hooks.cancel).toHaveBeenCalledTimes(1);
  t.done();
});

it('offers resubscribe during the cancelled paid tail', async () => {
  const tail: AiSubscriptionView = {...active, status: 'CANCELLED', cancelAtPeriodEnd: true};
  const hooks = hooksFor({load: jest.fn().mockResolvedValue(tail),
    subscribe: jest.fn().mockResolvedValue(tail)});
  const t = setup(hooks);
  await t.render();
  expect(t.texts()).toContain('no double charge');
  await t.press('Resubscribe for ₹129/month');
  expect(hooks.subscribe).toHaveBeenCalledTimes(1);
  t.done();
});

it('explains a failed mandate and offers a fresh subscribe', async () => {
  const pastDue: AiSubscriptionView = {...none, status: 'PAST_DUE'};
  const hooks = hooksFor({load: jest.fn().mockResolvedValue(pastDue),
    subscribe: jest.fn().mockResolvedValue(active)});
  const t = setup(hooks);
  await t.render();
  expect(t.texts()).toContain('Your last Plus payment failed');
  await t.press('Subscribe again for ₹129/month');
  expect(hooks.subscribe).toHaveBeenCalledTimes(1);
  t.done();
});

it('retries when loading fails', async () => {
  const load = jest.fn().mockRejectedValue(new Error('offline'));
  const hooks = hooksFor({load});
  const t = setup(hooks);
  await t.render();
  // One component-level retry with backoff before the error state settles.
  await renderer.act(async () => { await new Promise(resolve => setTimeout(resolve, 1500)); });
  expect(t.texts()).toContain('Plus could not load');
  t.done();
});
