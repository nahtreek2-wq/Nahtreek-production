import {ApiError} from '../src/services/apiClient';
import {activateDemoAi, cancelAiSubscription, confirmAiSubscription, fetchAiSubscription, isConfirmingError, isPaywallError, quotaLabel, subscribeAi} from '../src/services/aiBilling';
import {api} from '../src/services/apiClient';
import RazorpayCheckout from 'react-native-razorpay';

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
jest.mock('react-native-razorpay', () => ({__esModule: true, default: {open: jest.fn()}}));

const mockedApi = api as unknown as {get: jest.Mock; post: jest.Mock};
const mockedCheckout = RazorpayCheckout as unknown as {open: jest.Mock};

beforeEach(() => jest.clearAllMocks());

it.each([
  [null, null],
  [{effective: true, freeUsed: 0, freeQuota: 5}, null],
  [{effective: false, freeUsed: 0, freeQuota: 5}, '5 free AI chats left'],
  [{effective: false, freeUsed: 4, freeQuota: 5}, '1 free AI chat left'],
  [{effective: false, freeUsed: 5, freeQuota: 5}, '0 free AI chats left'],
  [{effective: false, freeUsed: 9, freeQuota: 5}, '0 free AI chats left'],
])('quota label for %j', (view, expected) => {
  expect(quotaLabel(view as any)).toBe(expected);
});

it('detects paywall errors by status code', () => {
  expect(isPaywallError(new ApiError(402, 'pay'))).toBe(true);
  expect(isPaywallError(new ApiError(400, 'bad'))).toBe(false);
  expect(isPaywallError(new Error('nope'))).toBe(false);
});

it('fetches and cancels through the billing endpoints', async () => {
  mockedApi.get.mockResolvedValue({effective: false});
  mockedApi.post.mockResolvedValue({effective: false, cancelAtPeriodEnd: true});
  await expect(fetchAiSubscription()).resolves.toEqual({effective: false});
  expect(mockedApi.get).toHaveBeenCalledWith('/ai-billing/me');
  await cancelAiSubscription();
  expect(mockedApi.post).toHaveBeenCalledWith('/ai-billing/cancel', {});
});

it('runs checkout then confirms with the API', async () => {
  mockedApi.post
    .mockResolvedValueOnce({keyId: 'rzp_test', subscriptionId: 'sub_ai'})
    .mockResolvedValueOnce({effective: true});
  mockedCheckout.open.mockResolvedValue({razorpay_subscription_id: 'sub_ai'});
  await expect(subscribeAi()).resolves.toEqual({effective: true});
  expect(mockedApi.post).toHaveBeenNthCalledWith(1, '/ai-billing/subscribe', {});
  expect(mockedCheckout.open).toHaveBeenCalledWith(expect.objectContaining({key: 'rzp_test', subscription_id: 'sub_ai'}));
  expect(mockedApi.post).toHaveBeenNthCalledWith(2, '/ai-billing/confirm', {});
});

it('does not confirm when checkout is dismissed', async () => {
  mockedApi.post.mockResolvedValueOnce({keyId: 'rzp_test', subscriptionId: 'sub_ai'});
  mockedCheckout.open.mockRejectedValue(new Error('dismissed'));
  await expect(subscribeAi()).rejects.toThrow('dismissed');
  expect(mockedApi.post).toHaveBeenCalledTimes(1);
});

it('activates preview access without opening checkout', async () => {
  mockedApi.post.mockResolvedValue({effective: true});
  await expect(activateDemoAi()).resolves.toEqual({effective: true});
  expect(mockedApi.post).toHaveBeenCalledWith('/ai-billing/demo-activate', {});
  expect(mockedCheckout.open).not.toHaveBeenCalled();
});

it('skips checkout when the server replays an effective subscription', async () => {
  mockedApi.post.mockResolvedValueOnce({effective: true, subscriptionId: 'sub_ai', shortUrl: null});
  mockedApi.get.mockResolvedValue({effective: true, status: 'ACTIVE'});
  await expect(subscribeAi()).resolves.toEqual({effective: true, status: 'ACTIVE'});
  expect(mockedCheckout.open).not.toHaveBeenCalled();
  expect(mockedApi.get).toHaveBeenCalledWith('/ai-billing/me');
});

it('refreshes status instead of crashing on a missing subscription id', async () => {
  mockedApi.post.mockResolvedValueOnce({effective: false, subscriptionId: null, shortUrl: null});
  mockedApi.get.mockResolvedValue({effective: false, status: 'NONE'});
  await expect(subscribeAi()).resolves.toEqual({effective: false, status: 'NONE'});
  expect(mockedCheckout.open).not.toHaveBeenCalled();
});

it('still runs checkout when a demo row starts a real subscription', async () => {
  mockedApi.post
    .mockResolvedValueOnce({effective: true, keyId: 'rzp_test', subscriptionId: 'sub_new', shortUrl: 'https://rzp.io/i/n'})
    .mockResolvedValueOnce({effective: true});
  mockedCheckout.open.mockResolvedValue({razorpay_subscription_id: 'sub_new'});
  await expect(subscribeAi()).resolves.toEqual({effective: true});
  expect(mockedCheckout.open).toHaveBeenCalledWith(expect.objectContaining({subscription_id: 'sub_new'}));
});

it('confirms through the confirm endpoint and detects confirming errors', async () => {
  mockedApi.post.mockResolvedValue({effective: true});
  await expect(confirmAiSubscription()).resolves.toEqual({effective: true});
  expect(mockedApi.post).toHaveBeenCalledWith('/ai-billing/confirm', {});
  expect(isConfirmingError(new Error('Payment is still confirming at Razorpay.'))).toBe(true);
  expect(isConfirmingError(new Error('No money was taken'))).toBe(false);
  expect(isConfirmingError(new ApiError(400, 'still confirming, wait'))).toBe(true);
});
