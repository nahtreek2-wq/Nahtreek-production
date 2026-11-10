import React from 'react';
import renderer from 'react-test-renderer';
import {Text} from 'react-native';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {PaymentSection} from '../../../packages/mobile-booking/PaymentSection';
import type {PaymentHooks} from '../../../packages/mobile-booking/PaymentSection';
import {CheckoutCancelledError} from '../../../packages/mobile-booking/razorpayGateway';

function setup(hooks: PaymentHooks, props?: {requestKind?: 'service' | 'engineer'; quoteAmount?: number;
  receiptEmail?: string | null; onSaveReceiptEmail?: (email: string) => Promise<unknown>; isPlus?: boolean;
  plusDiscount?: {percent: number; capPaisa: number} | null}) {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  let screen!: renderer.ReactTestRenderer;
  const render = async () => {
    await renderer.act(async () => {
      screen = renderer.create(<QueryClientProvider client={client}>
        <PaymentSection requestId="req" quoteAmount={props?.quoteAmount ?? 2000} requestKind={props?.requestKind}
          hooks={hooks} receiptEmail={props?.receiptEmail} onSaveReceiptEmail={props?.onSaveReceiptEmail}
          isPlus={props?.isPlus} plusDiscount={props?.plusDiscount} />
      </QueryClientProvider>);
    });
    await renderer.act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  };
  const texts = () => screen.root.findAllByType(Text)
    .map(t => (Array.isArray(t.props.children) ? t.props.children.join('') : (t.props.children ?? '')).toString()).join('\n');
  const pressPay = async () => {
    const button = screen.root.findByProps({accessibilityRole: 'button'});
    await renderer.act(async () => { button.props.onPress(); });
  };
  const done = () => renderer.act(() => screen.unmount());
  const buttons = () => screen.root.findAllByProps({accessibilityRole: 'button'});
  const findButton = (label: string) => screen.root.findByProps({accessibilityRole: 'button', accessibilityLabel: label});
  const root = () => screen.root;
  return {render, texts, pressPay, done, buttons, findButton, root};
}

const order = {paymentId: 'p', keyId: 'k', razorpayOrderId: 'o', amountPaisa: 200000, currency: 'INR'};
const checkoutResult = {razorpayOrderId: 'o', razorpayPaymentId: 'pay', razorpaySignature: 's'};

it('pays an approved quote through order, checkout and verify', async () => {
  const hooks: PaymentHooks = {
    createOrder: jest.fn().mockResolvedValue(order),
    verify: jest.fn().mockResolvedValue({status: 'HELD', amountPaisa: 200000, currency: 'INR'}),
    loadStatus: jest.fn().mockResolvedValue(null),
    checkout: jest.fn().mockResolvedValue(checkoutResult),
  };
  const t = setup(hooks);
  await t.render();
  expect(t.texts()).toContain('Pay ₹2,000 securely');
  await t.pressPay();
  expect(hooks.createOrder).toHaveBeenCalledTimes(1);
  expect(hooks.checkout).toHaveBeenCalledWith(expect.objectContaining({orderId: 'o', amountPaisa: 200000, keyId: 'k'}));
  expect(hooks.verify).toHaveBeenCalledWith(checkoutResult);
  t.done();
});

it('shows the held state with a release note and no pay button', async () => {
  const hooks: PaymentHooks = {
    createOrder: jest.fn(), verify: jest.fn(),
    loadStatus: jest.fn().mockResolvedValue({status: 'HELD', amountPaisa: 200000, currency: 'INR'}),
    checkout: jest.fn(),
  };
  const t = setup(hooks);
  await t.render();
  expect(t.texts()).toContain('Paid ₹2,000');
  expect(t.texts()).toContain('releases to the professional when you confirm the completed work');
  expect(t.buttons()).toHaveLength(0);
  t.done();
});

it('treats checkout cancellation as neutral, without verifying', async () => {
  const hooks: PaymentHooks = {
    createOrder: jest.fn().mockResolvedValue(order),
    verify: jest.fn(),
    loadStatus: jest.fn().mockResolvedValue(null),
    checkout: jest.fn().mockRejectedValue(new CheckoutCancelledError()),
  };
  const t = setup(hooks);
  await t.render();
  await t.pressPay();
  expect(hooks.verify).not.toHaveBeenCalled();
  expect(t.texts()).toContain('No money moved');
  t.done();
});

it('explains plainly when payments are not enabled yet', async () => {
  const hooks: PaymentHooks = {
    createOrder: jest.fn().mockRejectedValue(Object.assign(new Error('Service Unavailable'), {status: 503})),
    verify: jest.fn(),
    loadStatus: jest.fn().mockResolvedValue(null),
    checkout: jest.fn(),
  };
  const t = setup(hooks);
  await t.render();
  await t.pressPay();
  expect(t.texts()).toContain('Online payments are not available yet');
  expect(hooks.checkout).not.toHaveBeenCalled();
  t.done();
});

it('shows refund and dispute states without a pay button', async () => {
  for (const [status, snippet] of [['REFUNDED', 'Refunded ₹2,000'], ['DISPUTED', 'Under review']] as const) {
    const hooks: PaymentHooks = {
      createOrder: jest.fn(), verify: jest.fn(),
      loadStatus: jest.fn().mockResolvedValue({status, amountPaisa: 200000, currency: 'INR'}),
      checkout: jest.fn(),
    };
    const t = setup(hooks);
    await t.render();
    expect(t.texts()).toContain(snippet);
    expect(screenHasPayButton(t)).toBe(false);
    t.done();
  }
  function screenHasPayButton(t: {texts: () => string}) {
    return t.texts().includes('Pay ₹');
  }
});

it('pays a consultation fee with engineer copy and checkout description', async () => {
  const engOrder = {paymentId: 'p', keyId: 'k', razorpayOrderId: 'o', amountPaisa: 350000, currency: 'INR'};
  const hooks: PaymentHooks = {
    createOrder: jest.fn().mockResolvedValue(engOrder),
    verify: jest.fn().mockResolvedValue({status: 'PAID', amountPaisa: 350000, currency: 'INR'}),
    loadStatus: jest.fn().mockResolvedValue(null),
    checkout: jest.fn().mockResolvedValue(checkoutResult),
  };
  const t = setup(hooks, {requestKind: 'engineer', quoteAmount: 3500});
  await t.render();
  expect(t.texts()).toContain('Pay ₹3,500 consultation fee');
  await t.pressPay();
  expect(hooks.createOrder).toHaveBeenCalledTimes(1);
  expect(hooks.checkout).toHaveBeenCalledWith(expect.objectContaining({description: 'Consultation fee payment'}));
  expect(hooks.verify).toHaveBeenCalledWith(checkoutResult);
  t.done();
});

it('tells Plus members their consultation discount applies at checkout', async () => {
  const hooks: PaymentHooks = {
    createOrder: jest.fn(), verify: jest.fn(),
    loadStatus: jest.fn().mockResolvedValue(null),
    checkout: jest.fn(),
  };
  const plus = setup(hooks, {requestKind: 'engineer', quoteAmount: 3500, isPlus: true,
    plusDiscount: {percent: 2, capPaisa: 10000}});
  await plus.render();
  expect(plus.texts()).toContain('Your Plus 2% discount (up to ₹100) applies automatically at checkout.');
  plus.done();
  const noPlan = setup(hooks, {requestKind: 'engineer', quoteAmount: 3500, isPlus: true});
  await noPlan.render();
  // Plan endpoint unreachable: generic sentence, never stale hard numbers.
  expect(noPlan.texts()).toContain('Your Plus discount applies automatically at checkout.');
  expect(noPlan.texts()).not.toContain('2% discount (up to');
  noPlan.done();
  const regular = setup(hooks, {requestKind: 'engineer', quoteAmount: 3500});
  await regular.render();
  expect(regular.texts()).not.toContain('Plus discount');
  regular.done();
});

it('shows the engineer held state with a review note and no pay button', async () => {
  const hooks: PaymentHooks = {
    createOrder: jest.fn(), verify: jest.fn(),
    loadStatus: jest.fn().mockResolvedValue({status: 'HELD', amountPaisa: 350000, currency: 'INR'}),
    checkout: jest.fn(),
  };
  const t = setup(hooks, {requestKind: 'engineer', quoteAmount: 3500});
  await t.render();
  expect(t.texts()).toContain('Paid ₹3,500');
  expect(t.texts()).toContain('releases to the engineer after review');
  expect(t.buttons()).toHaveLength(0);
  t.done();
});

it('shows direct settlement without a pay button', async () => {
  for (const status of ['COLLECTED_UNSETTLED', 'SETTLED']) {
    const hooks: PaymentHooks = {
      createOrder: jest.fn(), verify: jest.fn(),
      loadStatus: jest.fn().mockResolvedValue({status, amountPaisa: 350000, currency: 'INR'}),
      checkout: jest.fn(),
    };
    const t = setup(hooks, {requestKind: 'engineer', quoteAmount: 3500});
    await t.render();
    expect(t.texts()).toContain('Paid directly ₹3,500');
    expect(t.buttons()).toHaveLength(0);
    t.done();
  }
});

it('reports a problem on a held payment and refreshes to disputed', async () => {
  const hooks: PaymentHooks = {
    createOrder: jest.fn(), verify: jest.fn(),
    loadStatus: jest.fn()
      .mockResolvedValueOnce({status: 'HELD', amountPaisa: 350000, currency: 'INR'})
      .mockResolvedValue({status: 'DISPUTED', amountPaisa: 350000, currency: 'INR'}),
    checkout: jest.fn(),
    dispute: jest.fn().mockResolvedValue({status: 'DISPUTED', amountPaisa: 350000, currency: 'INR'}),
  };
  const t = setup(hooks, {requestKind: 'engineer', quoteAmount: 3500});
  await t.render();
  expect(t.texts()).toContain('Report a problem');
  const {TextInput} = jest.requireActual('react-native');
  await renderer.act(async () => {
    t.findButton('Report a problem with this payment').props.onPress();
  });
  await renderer.act(async () => {
    t.root().findByType(TextInput).props.onChangeText('The engineer never visited the site');
  });
  await renderer.act(async () => {
    t.findButton('Submit problem report').props.onPress();
  });
  expect(hooks.dispute).toHaveBeenCalledWith('The engineer never visited the site');
  await renderer.act(async () => {});
  expect(t.texts()).toContain('Under review');
  t.done();
});

describe('receipt email capture', () => {
  const unpaid = (): PaymentHooks => ({
    createOrder: jest.fn().mockResolvedValue(order),
    verify: jest.fn().mockResolvedValue({status: 'HELD', amountPaisa: 200000, currency: 'INR'}),
    loadStatus: jest.fn().mockResolvedValue(null),
    checkout: jest.fn().mockResolvedValue(checkoutResult),
  });
  const typeEmail = async (t: {root: () => renderer.ReactTestRenderer['root']}, value: string) => {
    await renderer.act(async () => {
      t.root().findByProps({accessibilityLabel: 'Receipt email'}).props.onChangeText(value);
    });
  };

  it('saves the receipt email before paying', async () => {
    const hooks = unpaid();
    const onSaveReceiptEmail = jest.fn().mockResolvedValue(undefined);
    const t = setup(hooks, {receiptEmail: null, onSaveReceiptEmail});
    await t.render();
    expect(t.texts()).toContain('Receipt email');
    await typeEmail(t, 'client@example.com');
    await t.pressPay();
    await renderer.act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    expect(onSaveReceiptEmail).toHaveBeenCalledWith('client@example.com');
    expect(hooks.createOrder).toHaveBeenCalledTimes(1);
    t.done();
  });

  it('blocks pay on an invalid address but skips cleanly when blank', async () => {
    const hooks = unpaid();
    const onSaveReceiptEmail = jest.fn().mockResolvedValue(undefined);
    const t = setup(hooks, {receiptEmail: null, onSaveReceiptEmail});
    await t.render();
    await typeEmail(t, 'not-an-email');
    await t.pressPay();
    await renderer.act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    expect(t.texts()).toContain('Enter a valid email for the receipt');
    expect(hooks.createOrder).not.toHaveBeenCalled();
    await typeEmail(t, '');
    await t.pressPay();
    await renderer.act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    expect(onSaveReceiptEmail).not.toHaveBeenCalled();
    expect(hooks.createOrder).toHaveBeenCalledTimes(1);
    t.done();
  });

  it('hides the field when the account already has an email', async () => {
    const hooks = unpaid();
    const t = setup(hooks, {receiptEmail: 'known@example.com', onSaveReceiptEmail: jest.fn()});
    await t.render();
    expect(t.texts()).not.toContain('Receipt email');
    t.done();
  });

  it('still pays when the email save fails, with a warning', async () => {
    const hooks = unpaid();
    const onSaveReceiptEmail = jest.fn().mockRejectedValue(new Error('offline'));
    const t = setup(hooks, {receiptEmail: null, onSaveReceiptEmail});
    await t.render();
    await typeEmail(t, 'client@example.com');
    await t.pressPay();
    await renderer.act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    expect(hooks.createOrder).toHaveBeenCalledTimes(1);
    expect(t.texts()).toContain('could not be saved');
    t.done();
  });
});
