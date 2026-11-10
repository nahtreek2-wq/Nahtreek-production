import {createHmac} from 'crypto';
import {RazorpayError, RazorpayProvider} from './razorpay.provider';

describe('razorpay provider', () => {
  const priorEnv = {...process.env};
  const realFetch = global.fetch;
  const fetchMock = jest.fn();
  beforeEach(() => {
    global.fetch = fetchMock as any;
    fetchMock.mockReset();
    process.env.RAZORPAY_KEY_ID = 'rzp_test_id';
    process.env.RAZORPAY_KEY_SECRET = 'test_secret';
    process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_test';
  });
  afterEach(() => {
    global.fetch = realFetch;
    process.env = {...priorEnv};
  });

  it('reports enabled only with both credentials', () => {
    expect(new RazorpayProvider().enabled).toBe(true);
    delete process.env.RAZORPAY_KEY_SECRET;
    expect(new RazorpayProvider().enabled).toBe(false);
  });
  it('detects key mode and refuses cross-mode deploys', () => {
    expect(new RazorpayProvider().keyMode).toBe('test');
    process.env.RAZORPAY_KEY_ID = 'rzp_live_id';
    expect(new RazorpayProvider().keyMode).toBe('live');
    process.env.APP_ENV = 'production';
    process.env.RAZORPAY_KEY_ID = 'rzp_test_id';
    expect(() => new RazorpayProvider().assertKeyMode()).toThrow(/TEST keys/);
    process.env.APP_ENV = 'preview';
    process.env.RAZORPAY_KEY_ID = 'rzp_live_id';
    expect(() => new RazorpayProvider().assertKeyMode()).toThrow(/LIVE keys/);
    process.env.RAZORPAY_KEY_ID = 'rzp_test_id';
    expect(() => new RazorpayProvider().assertKeyMode()).not.toThrow();
  });
  it('lists refunds for the retry guard', async () => {
    fetchMock.mockResolvedValue({ok: true, json: async () => ({items: [{id: 'rfnd_1', status: 'processed', amount: 200000}]})});
    await expect(new RazorpayProvider().fetchRefunds('pay_1')).resolves.toEqual(
      [{id: 'rfnd_1', status: 'processed', amount: 200000}]);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.razorpay.com/v1/payments/pay_1/refunds');
  });
  it('creates orders with basic auth and paisa amounts', async () => {
    fetchMock.mockResolvedValue({ok: true, json: async () => ({id: 'order_1', amount: 200000, currency: 'INR', status: 'created'})});
    const order = await new RazorpayProvider().createOrder({amountPaisa: 200000, currency: 'INR', receipt: 'pay', notes: {a: 'b'}});
    expect(order).toMatchObject({id: 'order_1', amount: 200000});
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.razorpay.com/v1/orders');
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('rzp_test_id:test_secret').toString('base64')}`);
    expect(JSON.parse(init.body)).toMatchObject({amount: 200000, currency: 'INR'});
  });
  it('manages plan and subscription calls', async () => {
    fetchMock.mockResolvedValue({ok: true, json: async () => ({id: 'plan_1', item: {amount: 39900, currency: 'INR'}, period: 'monthly'})});
    await expect(new RazorpayProvider().fetchPlan('plan_1')).resolves.toMatchObject({amount: 39900, period: 'monthly'});
    fetchMock.mockResolvedValue({ok: true, json: async () => ({id: 'sub_1', status: 'created', short_url: 'u'})});
    await expect(new RazorpayProvider().createSubscription({planId: 'plan_1', totalCount: 120, notes: {}})).resolves.toMatchObject({id: 'sub_1'});
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.razorpay.com/v1/subscriptions');
    fetchMock.mockResolvedValue({ok: true, json: async () => ({id: 'sub_1', status: 'active'})});
    await expect(new RazorpayProvider().fetchSubscription('sub_1')).resolves.toMatchObject({status: 'active'});
    fetchMock.mockResolvedValue({ok: true, json: async () => ({id: 'sub_1', status: 'cancelled'})});
    await expect(new RazorpayProvider().cancelSubscription('sub_1')).resolves.toMatchObject({status: 'cancelled'});
    expect(JSON.parse(fetchMock.mock.calls[3][1].body)).toMatchObject({cancel_at_cycle_end: 1});
  });
  it('marks transport failures retryable and client errors final', async () => {
    fetchMock.mockRejectedValue(new Error('socket hangup'));
    await expect(new RazorpayProvider().fetchPayment('pay_1')).rejects.toMatchObject({status: 503, retryable: true});
    fetchMock.mockResolvedValue({ok: false, status: 400, json: async () => ({error: {description: 'Bad amount'}})});
    const error = await new RazorpayProvider().fetchPayment('pay_1').catch(e => e);
    expect(error).toBeInstanceOf(RazorpayError);
    expect(error).toMatchObject({status: 400, retryable: false});
  });
  it('verifies checkout and webhook signatures', () => {
    const provider = new RazorpayProvider();
    const checkout = createHmac('sha256', 'test_secret').update('order_1|pay_1').digest('hex');
    expect(provider.verifyPaymentSignature('order_1', 'pay_1', checkout)).toBe(true);
    expect(provider.verifyPaymentSignature('order_1', 'pay_1', '0'.repeat(64))).toBe(false);
    const body = Buffer.from('{"id":"e1"}');
    const hook = createHmac('sha256', 'whsec_test').update(body).digest('hex');
    expect(provider.verifyWebhookSignature(body, hook)).toBe(true);
    expect(provider.verifyWebhookSignature(body, 'nope')).toBe(false);
  });
});
