import React from 'react';
import renderer from 'react-test-renderer';
import {Text, TextInput} from 'react-native';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {CollectPaymentCard} from '../src/components/CollectPaymentCard';
import type {CollectHooks, CollectStatusView} from '../src/components/CollectPaymentCard';
import {api} from '../src/services/apiClient';

jest.mock('../src/services/apiClient', () => ({
  api: {get: jest.fn(), post: jest.fn()},
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

function setup(hooks: CollectHooks, onViewDues = jest.fn()) {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  let screen!: renderer.ReactTestRenderer;
  const render = async () => {
    await renderer.act(async () => {
      screen = renderer.create(<QueryClientProvider client={client}>
        <CollectPaymentCard requestId="req" hooks={hooks} onViewDues={onViewDues} />
      </QueryClientProvider>);
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
  const typeAmount = async (value: string) => {
    await renderer.act(async () => {
      screen.root.findByType(TextInput).props.onChangeText(value);
    });
  };
  const done = () => renderer.act(() => screen.unmount());
  return {render, texts, press, typeAmount, done, onViewDues};
}

const declared: CollectStatusView = {status: 'COLLECTED_UNSETTLED', amountPaisa: 350000,
  platformFeePaisa: 35000, professionalAmountPaisa: 315000, currency: 'INR', collectionMode: 'AT_HOME'};

it('declares a direct collection and shows the dues note', async () => {
  const hooks: CollectHooks = {
    loadStatus: jest.fn().mockResolvedValue(null),
    declare: jest.fn().mockResolvedValue(declared),
  };
  const t = setup(hooks);
  await t.render();
  expect(t.texts()).toContain('No payment recorded yet');
  await t.press('I collected cash or UPI');
  await t.typeAmount('3500');
  await t.press('Collected by UPI');
  await t.press('Declare collection');
  // React Query v5 calls mutationFn(variables, context): assert the variables, ignore the context.
  expect(hooks.declare).toHaveBeenCalledWith({amount: 3500, method: 'UPI'}, expect.anything());
  await renderer.act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(t.texts()).toContain('You declared ₹3,500 collected directly');
  expect(t.texts()).toContain('₹350 commission is waiting in your dues');
  t.done();
});

it('rejects an empty amount without calling declare', async () => {
  const hooks: CollectHooks = {
    loadStatus: jest.fn().mockResolvedValue(null),
    declare: jest.fn(),
  };
  const t = setup(hooks);
  await t.render();
  await t.press('I collected cash or UPI');
  await t.press('Declare collection');
  expect(hooks.declare).not.toHaveBeenCalled();
  t.done();
});

it('shows a recorded direct collection with a dues link', async () => {
  const hooks: CollectHooks = {
    loadStatus: jest.fn().mockResolvedValue(declared),
    declare: jest.fn(),
  };
  const t = setup(hooks);
  await t.render();
  expect(t.texts()).toContain('You declared ₹3,500 collected directly');
  await t.press('View commission dues');
  expect(t.onViewDues).toHaveBeenCalledTimes(1);
  t.done();
});

it('offers a manual recheck while no payment is recorded', async () => {
  const loadStatus = jest.fn().mockResolvedValue(null);
  const t = setup({loadStatus, declare: jest.fn()});
  await t.render();
  expect(t.texts()).toContain('Check again for an in-app payment');
  const callsBefore = loadStatus.mock.calls.length;
  await t.press('Check again for an in-app payment');
  expect(loadStatus.mock.calls.length).toBeGreaterThan(callsBefore);
  t.done();
});

it('shows refunds as returning to the customer, never releasing', async () => {
  const pending = setup({loadStatus: jest.fn().mockResolvedValue({...declared, status: 'REFUND_PENDING', collectionMode: 'ONLINE'}), declare: jest.fn()});
  await pending.render();
  expect(pending.texts()).toContain('refund in progress');
  expect(pending.texts()).not.toContain('releases after review');
  pending.done();
  const done = setup({loadStatus: jest.fn().mockResolvedValue({...declared, status: 'REFUNDED', collectionMode: 'ONLINE'}), declare: jest.fn()});
  await done.render();
  expect(done.texts()).toContain('refunded in full to the customer');
  expect(done.texts()).not.toContain('releases after review');
  done.done();
});

it('shows an online payment as releasing after review', async () => {
  const hooks: CollectHooks = {
    loadStatus: jest.fn().mockResolvedValue({...declared, status: 'HELD', collectionMode: 'ONLINE'}),
    declare: jest.fn(),
  };
  const t = setup(hooks);
  await t.render();
  expect(t.texts()).toContain('Paid online ₹3,500');
  expect(t.texts()).toContain('releases after review');
  t.done();
});

it('reconciles before declaring and skips the declare when the client paid online', async () => {
  const online: CollectStatusView = {...declared, status: 'PAID', collectionMode: 'ONLINE'};
  const hooks: CollectHooks = {
    loadStatus: jest.fn().mockResolvedValue(null),
    declare: jest.fn(),
    sync: jest.fn().mockResolvedValue(online),
  };
  const t = setup(hooks);
  await t.render();
  await t.press('I collected cash or UPI');
  await t.typeAmount('3500');
  await t.press('Declare collection');
  expect(hooks.sync).toHaveBeenCalledTimes(1);
  expect(hooks.declare).not.toHaveBeenCalled();
  await renderer.act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(t.texts()).toContain('Paid online ₹3,500');
  t.done();
});

it('shows the consultation fee as the declare reference', async () => {
  const hooks: CollectHooks = {
    loadStatus: jest.fn().mockResolvedValue({...declared, status: 'NOT_STARTED', collectionMode: 'ONLINE',
      expectedAmountPaisa: 350000}),
    declare: jest.fn(),
  };
  const t = setup(hooks);
  await t.render();
  expect(t.texts()).toContain('Consultation fee ₹3,500');
  t.done();
});

it('shows a scannable payment QR for the customer', async () => {
  const hooks: CollectHooks = {
    loadStatus: jest.fn().mockResolvedValue(null),
    declare: jest.fn(),
  };
  (api.get as jest.Mock).mockResolvedValue({
    qrPng: 'data:image/png;base64,QR',
    title: 'Wall crack',
    expectedAmountPaisa: 350000,
  });
  const t = setup(hooks);
  await t.render();
  await t.press('Show payment QR');
  await renderer.act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(api.get).toHaveBeenCalledWith('/payments/collect-qr?engineerRequestId=req');
  expect(t.texts()).toContain('Customer scan to pay');
  expect(t.texts()).toContain('₹3,500 due');
  t.done();
});
