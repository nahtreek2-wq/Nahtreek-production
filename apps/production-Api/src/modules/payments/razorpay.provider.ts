import {Injectable} from '@nestjs/common';
import {createHmac, timingSafeEqual} from 'crypto';

export class RazorpayError extends Error {
  constructor(message: string, readonly status: number, readonly retryable: boolean) {
    super(message);
  }
}

export type RazorpayPlan = {id: string; amount: number; currency: string; period: string};
export type RazorpaySubscription = {id: string; status: string; short_url?: string; current_start?: number; current_end?: number};
export type RazorpayOrder = {id: string; amount: number; currency: string; status: string};
export type RazorpayPayment = {id: string; order_id: string; amount: number; currency: string; status: string};
export type RazorpayTransfer = {id: string; status?: string; on_hold?: boolean};
export type RazorpayRefund = {id: string; status: string};

// Thin Razorpay REST client over fetch (no SDK dependency). Money methods
// throw RazorpayError; signature helpers return booleans.
@Injectable()
export class RazorpayProvider {
  get enabled() {
    return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
  }

  get keyId() {
    return process.env.RAZORPAY_KEY_ID ?? '';
  }

  // Razorpay key prefixes are the only reliable test/live signal. Production
  // must never run on test keys (no real money moves) and preview must never
  // run on live keys (real charges from a demo build).
  get keyMode(): 'test' | 'live' | 'missing' {
    const id = process.env.RAZORPAY_KEY_ID ?? '';
    if (!id || !process.env.RAZORPAY_KEY_SECRET) return 'missing';
    return id.startsWith('rzp_live_') ? 'live' : 'test';
  }

  assertKeyMode() {
    const mode = this.keyMode;
    if (mode === 'missing') return; // requireEnabled() reports this per-call.
    const env = process.env.APP_ENV ?? '';
    if (env === 'production' && mode === 'test')
      throw new Error('FATAL: production is configured with Razorpay TEST keys — real payments cannot move');
    if ((env === 'preview' || env === 'development') && mode === 'live')
      throw new Error(`FATAL: ${env} is configured with Razorpay LIVE keys — demo builds must never charge real money`);
  }

  private auth() {
    const id = process.env.RAZORPAY_KEY_ID;
    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!id || !secret) throw new RazorpayError('Razorpay credentials are not configured', 503, false);
    return `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;
  }

  private async call(method: string, path: string, body?: unknown): Promise<any> {
    let response: Response;
    try {
      response = await fetch(`https://api.razorpay.com/v1${path}`, {method, signal: AbortSignal.timeout(10000),
        headers: {Authorization: this.auth(), 'Content-Type': 'application/json'},
        body: body === undefined ? undefined : JSON.stringify(body)});
    } catch {
      throw new RazorpayError('Razorpay request failed', 503, true);
    }
    const data = (await response.json().catch(() => ({}))) as any;
    if (!response.ok) {
      const message = data?.error?.description || data?.error?.code || `Razorpay rejected the request (${response.status})`;
      throw new RazorpayError(message, response.status, response.status >= 500 || response.status === 429);
    }
    return data;
  }

  verifyPaymentSignature(orderId: string, paymentId: string, signature: string) {
    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret || !signature) return false;
    const expected = createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  verifyWebhookSignature(rawBody: Buffer | string, signature: string) {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret || !signature) return false;
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  async createOrder(input: {amountPaisa: number; currency: string; receipt: string; notes: Record<string, string>}) {
    const data = await this.call('POST', '/orders', {amount: input.amountPaisa, currency: input.currency,
      receipt: input.receipt.slice(0, 40), notes: input.notes});
    if (!data?.id) throw new RazorpayError('Razorpay returned no order id', 502, true);
    return {id: data.id, amount: data.amount, currency: data.currency, status: data.status} as RazorpayOrder;
  }

  async fetchPayment(paymentId: string) {
    const data = await this.call('GET', `/payments/${encodeURIComponent(paymentId)}`);
    return data as RazorpayPayment;
  }

  // Reconciliation: when the checkout callback is lost (dismissed, retried
  // inside the SDK, bridge promise hung), the app can still ask what Razorpay
  // actually captured for our order instead of risking a double charge.
  async fetchOrderPayments(orderId: string) {
    const data = await this.call('GET', `/orders/${encodeURIComponent(orderId)}/payments`);
    const items = (Array.isArray(data?.items) ? data.items : []) as RazorpayPayment[];
    return items.filter(item => item && typeof item.id === 'string');
  }

  // Route transfer held from settlement until released after completion.
  async createOnHoldTransfer(paymentId: string, linkedAccountId: string, amountPaisa: number, currency: string) {
    const data = await this.call('POST', `/payments/${encodeURIComponent(paymentId)}/transfers`,
      {transfers: [{account: linkedAccountId, amount: amountPaisa, currency, on_hold: true}]});
    const item = (data?.items ?? [data])[0];
    if (!item?.id) throw new RazorpayError('Razorpay returned no transfer id', 502, true);
    return item as RazorpayTransfer;
  }

  async createDirectTransfer(paymentId: string, linkedAccountId: string, amountPaisa: number, currency: string) {
    const data = await this.call('POST', `/payments/${encodeURIComponent(paymentId)}/transfers`,
      {transfers: [{account: linkedAccountId, amount: amountPaisa, currency, on_hold: false}]});
    const item = (data?.items ?? [data])[0];
    if (!item?.id) throw new RazorpayError('Razorpay returned no transfer id', 502, true);
    return item as RazorpayTransfer;
  }

  async releaseTransfer(transferId: string) {
    return (await this.call('PATCH', `/transfers/${encodeURIComponent(transferId)}`, {on_hold: false})) as RazorpayTransfer;
  }

  async createRefund(paymentId: string, amountPaisa: number) {
    const data = await this.call('POST', `/payments/${encodeURIComponent(paymentId)}/refund`, {amount: amountPaisa});
    if (!data?.id) throw new RazorpayError('Razorpay returned no refund id', 502, true);
    return data as RazorpayRefund;
  }

  // Retry guard: list existing refunds before creating another, so a retried
  // REFUND_PENDING never double-refunds a payment Razorpay already refunded.
  async fetchRefunds(paymentId: string) {
    const data = await this.call('GET', `/payments/${encodeURIComponent(paymentId)}/refunds`);
    const items = (data?.items ?? []) as {id: string; status: string; amount: number}[];
    return items;
  }

  async fetchPlan(planId: string) {
    const data = await this.call('GET', `/plans/${encodeURIComponent(planId)}`);
    const amount = data?.item?.amount ?? data?.amount;
    if (!data?.id || typeof amount !== 'number') throw new RazorpayError('Razorpay returned no plan', 502, true);
    return {id: data.id, amount, currency: data?.item?.currency ?? data?.currency, period: data?.period} as RazorpayPlan;
  }

  async createSubscription(input: {planId: string; totalCount: number; notes: Record<string, string>; startAt?: number}) {
    const data = await this.call('POST', '/subscriptions', {plan_id: input.planId, quantity: 1,
      total_count: input.totalCount, customer_notify: 1, notes: input.notes,
      ...(input.startAt ? {start_at: input.startAt} : {})});
    if (!data?.id) throw new RazorpayError('Razorpay returned no subscription id', 502, true);
    return data as RazorpaySubscription;
  }

  async fetchSubscription(subscriptionId: string) {
    return (await this.call('GET', `/subscriptions/${encodeURIComponent(subscriptionId)}`)) as RazorpaySubscription;
  }

  async cancelSubscription(subscriptionId: string) {
    return (await this.call('POST', `/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`,
      {cancel_at_cycle_end: 1})) as RazorpaySubscription;
  }
}
