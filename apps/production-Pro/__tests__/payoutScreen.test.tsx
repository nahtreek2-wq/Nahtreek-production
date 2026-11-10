import React from 'react';
import renderer from 'react-test-renderer';
import {Text, TextInput} from 'react-native';
import {NavigationContainer} from '@react-navigation/native';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {PayoutScreen} from '../src/screens/PayoutScreen';
import type {PayoutHooks, PayoutAccountView} from '../src/screens/PayoutScreen';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));

const fresh: PayoutAccountView = {status: 'NOT_SUBMITTED', accountHolderName: null, bankName: null,
  accountLast4: null, maskedAccountNumber: null, ifsc: null, upiId: null, rejectionReason: null, updatedAt: null};
const saved: PayoutAccountView = {status: 'PENDING', accountHolderName: 'Veda', bankName: 'HDFC',
  accountLast4: '9012', maskedAccountNumber: '••••9012', ifsc: 'HDFC0001234', upiId: 'veda@upi',
  rejectionReason: null, updatedAt: '2026-11-10T00:00:00Z'};

function setup(hooks: PayoutHooks) {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  let screen!: renderer.ReactTestRenderer;
  const render = async () => {
    await renderer.act(async () => {
      screen = renderer.create(<NavigationContainer><QueryClientProvider client={client}>
        <PayoutScreen hooks={hooks} />
      </QueryClientProvider></NavigationContainer>);
    });
    await renderer.act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  };
  const texts = () => screen.root.findAllByType(Text)
    .map(t => (Array.isArray(t.props.children) ? t.props.children.join('') : (t.props.children ?? '')).toString()).join('\n');
  const fill = (label: string, value: string) => {
    const input = screen.root.findByProps({accessibilityLabel: label});
    renderer.act(() => { input.props.onChangeText(value); });
  };
  const disabled = (label: string) => {
    const button = screen.root.findByProps({accessibilityRole: 'button', accessibilityLabel: label});
    return Boolean(button.props.accessibilityState?.disabled);
  };
  const press = async (label: string) => {
    const button = screen.root.findByProps({accessibilityRole: 'button', accessibilityLabel: label});
    await renderer.act(async () => { button.props.onPress(); });
    await renderer.act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  };
  const done = () => renderer.act(() => screen.unmount());
  return {render, texts, fill, press, disabled, done};
}

it('shows masked details and never the full account number', async () => {
  const hooks: PayoutHooks = {load: jest.fn().mockResolvedValue(saved), submit: jest.fn()};
  const t = setup(hooks);
  await t.render();
  expect(t.texts()).toContain('••••9012');
  expect(t.texts()).toContain('Pending verification');
  expect(t.texts()).not.toContain('123456789012');
  await t.done();
});

it('submits a valid form', async () => {
  const hooks: PayoutHooks = {load: jest.fn().mockResolvedValue(fresh),
    submit: jest.fn().mockResolvedValue(saved)};
  const t = setup(hooks);
  await t.render();
  t.fill('Account holder name', 'Veda');
  t.fill('Account number', '123456789012');
  t.fill('Confirm account number', '123456789012');
  t.fill('IFSC', 'HDFC0001234');
  t.fill('UPI ID', 'veda@upi');
  await t.press('Save payout details');
  expect(hooks.submit).toHaveBeenCalledWith({accountHolderName: 'Veda', accountNumber: '123456789012',
    ifsc: 'HDFC0001234', upiId: 'veda@upi'});
  await t.done();
});

it('blocks mismatched account numbers', async () => {
  const hooks: PayoutHooks = {load: jest.fn().mockResolvedValue(fresh), submit: jest.fn()};
  const t = setup(hooks);
  await t.render();
  t.fill('Account holder name', 'Veda');
  t.fill('Account number', '123456789012');
  t.fill('Confirm account number', '123456789000');
  t.fill('IFSC', 'HDFC0001234');
  expect(t.texts()).toContain('Account numbers do not match.');
  await t.done();
});

it('disables save until the form is valid', async () => {
  const hooks: PayoutHooks = {load: jest.fn().mockResolvedValue(fresh), submit: jest.fn()};
  const t = setup(hooks);
  await t.render();
  const disabled = t.disabled('Save payout details');
  expect(disabled).toBe(true);
  t.fill('Account holder name', 'Veda');
  t.fill('Account number', '123456789012');
  t.fill('Confirm account number', '123456789012');
  t.fill('IFSC', 'HDFC0001234');
  expect(t.disabled('Save payout details')).toBe(false);
  await t.done();
});
