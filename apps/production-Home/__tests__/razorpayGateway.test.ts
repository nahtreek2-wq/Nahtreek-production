import {CHECKOUT_LOGO_URL, CheckoutCancelledError, GatewayUnavailableError, checkoutContact, checkoutEmail, isGatewayAvailable, openCheckout} from '../../../packages/mobile-booking/razorpayGateway';

const mockOpen = jest.fn();
const mockSdkModule: {current: any} = {current: {open: (...args: unknown[]) => (mockOpen as jest.Mock)(...args)}};
jest.mock('react-native-razorpay', () => ({__esModule: true, get default() { return mockSdkModule.current; }}));

afterEach(() => {
  mockOpen.mockReset();
  mockSdkModule.current = {open: (...args: unknown[]) => (mockOpen as jest.Mock)(...args)};
});

const input = {keyId: 'k', orderId: 'o', amountPaisa: 200000, currency: 'INR', name: 'NAHTREEK', description: 'Service booking payment'};

it('opens checkout and maps the success response', async () => {
  mockOpen.mockResolvedValue({razorpay_payment_id: 'pay', razorpay_order_id: 'o', razorpay_signature: 's'});
  expect(isGatewayAvailable()).toBe(true);
  await expect(openCheckout(input)).resolves.toEqual({razorpayOrderId: 'o', razorpayPaymentId: 'pay', razorpaySignature: 's'});
  expect(mockOpen).toHaveBeenCalledWith(expect.objectContaining({key: 'k', order_id: 'o', amount: 200000}));
});

it('opens subscription checkouts for memberships', async () => {
  mockOpen.mockResolvedValue({razorpay_subscription_id: 'sub', razorpay_signature: 's'});
  await expect(openCheckout({keyId: 'k', subscriptionId: 'sub', currency: 'INR', name: 'NAHTREEK Pro', description: 'Pro membership (monthly)'}))
    .resolves.toMatchObject({razorpaySubscriptionId: 'sub'});
  expect(mockOpen).toHaveBeenCalledWith(expect.objectContaining({subscription_id: 'sub'}));
  expect(mockOpen.mock.calls[0][0]).not.toHaveProperty('order_id');
});

it('treats user cancellation as neutral', async () => {
  mockOpen.mockRejectedValue({code: 0, description: 'Payment cancelled by user'});
  await expect(openCheckout(input)).rejects.toBeInstanceOf(CheckoutCancelledError);
});

it('reports a missing native module plainly', async () => {
  mockSdkModule.current = undefined;
  expect(isGatewayAvailable()).toBe(false);
  await expect(openCheckout(input)).rejects.toBeInstanceOf(GatewayUnavailableError);
});

it('rejects incomplete checkout responses', async () => {
  mockOpen.mockResolvedValue({razorpay_payment_id: 'pay'});
  await expect(openCheckout(input)).rejects.toThrow('incomplete');
});

it('limits every checkout to UPI and cards', async () => {
  mockOpen.mockResolvedValue({razorpay_payment_id: 'pay', razorpay_order_id: 'o', razorpay_signature: 's'});
  await openCheckout(input);
  expect(mockOpen).toHaveBeenCalledWith(expect.objectContaining({
    method: {upi: true, card: true, netbanking: false, wallet: false, emi: false, paylater: false},
  }));
  mockOpen.mockReset();
  mockOpen.mockResolvedValue({razorpay_subscription_id: 'sub', razorpay_signature: 's'});
  await openCheckout({keyId: 'k', subscriptionId: 'sub', currency: 'INR', name: 'NAHTREEK Pro', description: 'Pro membership (monthly)'});
  expect(mockOpen).toHaveBeenCalledWith(expect.objectContaining({
    method: expect.objectContaining({upi: true, card: true, netbanking: false}),
  }));
});

it('normalizes account phones for contact prefill', () => {
  expect(checkoutContact('+919876543210')).toBe('9876543210');
  expect(checkoutContact('9876543210')).toBe('9876543210');
  expect(checkoutContact('+91 98765 43210')).toBe('9876543210');
  expect(checkoutContact(undefined)).toBeUndefined();
  expect(checkoutContact('')).toBeUndefined();
  expect(checkoutContact('12345')).toBeUndefined();
});

it('validates account emails for prefill', () => {
  expect(checkoutEmail('Pro@Example.com ')).toBe('pro@example.com');
  expect(checkoutEmail('not-an-email')).toBeUndefined();
  expect(checkoutEmail(undefined)).toBeUndefined();
});

it('brands order and subscription checkouts with the Nahtreek logo', async () => {
  expect(CHECKOUT_LOGO_URL).toMatch(/^https:\/\/.+\.png$/);
  mockOpen.mockResolvedValue({razorpay_payment_id: 'pay', razorpay_order_id: 'o', razorpay_signature: 's'});
  await openCheckout(input);
  expect(mockOpen).toHaveBeenCalledWith(expect.objectContaining({image: CHECKOUT_LOGO_URL}));
  mockOpen.mockReset();
  mockOpen.mockResolvedValue({razorpay_subscription_id: 'sub', razorpay_signature: 's'});
  await openCheckout({keyId: 'k', subscriptionId: 'sub', currency: 'INR', name: 'NAHTREEK Plus', description: 'Plus membership (monthly)'});
  expect(mockOpen).toHaveBeenCalledWith(expect.objectContaining({image: CHECKOUT_LOGO_URL}));
});
