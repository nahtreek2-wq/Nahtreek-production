export type CheckoutResult = {razorpayOrderId?: string; razorpaySubscriptionId?: string; razorpayPaymentId?: string; razorpaySignature?: string};
export type CheckoutInput = {keyId: string; orderId?: string; subscriptionId?: string; amountPaisa?: number; currency: string; name: string; description: string; prefill?: {email?: string; contact?: string}};

// Brand mark shown on the Razorpay checkout header (orders + subscriptions).
// Hosted in the public preview bucket; Razorpay requires an absolute HTTPS URL.
export const CHECKOUT_LOGO_URL = 'https://gnlquwusgocnlgefpfob.supabase.co/storage/v1/object/public/nahtreek-avatars/brand/nahtreek-checkout-logo.png';

export class GatewayUnavailableError extends Error {
  constructor() { super('Online payments are not available in this build yet.'); }
}

export class CheckoutCancelledError extends Error {
  constructor() { super('Payment cancelled. No money moved.'); }
}

// Dynamic id on purpose: Metro must bundle apps that do not ship the native
// Razorpay SDK (the professional app). Resolution happens at runtime; a
// missing module becomes GatewayUnavailableError instead of a bundle failure.
// eslint-disable-next-line no-underscore-dangle
const MODULE_ID = 'react-native-' + 'razorpay';

function sdk(): {open: (options: Record<string, unknown>) => Promise<any>} {
  try {
    const mod = require(MODULE_ID);
    const checkout = mod?.default ?? mod;
    if (typeof checkout?.open !== 'function') throw new Error('missing native module');
    return checkout;
  } catch {
    throw new GatewayUnavailableError();
  }
}

export function isGatewayAvailable() {
  try {
    sdk();
    return true;
  } catch {
    return false;
  }
}

// Normalize an account phone number for Razorpay contact prefill: the
// 10-digit subscriber number (Razorpay adds the +91 country selector
// itself — a prefixed 12-digit value is rejected and the contact screen
// stays). Returns undefined when there is nothing usable — the checkout
// then asks for contact details as before.
export function checkoutContact(phoneNumber?: string): string | undefined {
  const digits = (phoneNumber ?? '').replace(/\D/g, '');
  if (digits.length === 10) return digits;
  if (digits.length > 10) return digits.slice(-10);
  return undefined;
}

// Email for the same prefill: Razorpay skips its contact screen only when
// BOTH contact and email arrive valid. Anything else falls back to asking.
export function checkoutEmail(email?: string): string | undefined {
  const value = (email ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : undefined;
}

export async function openCheckout(input: CheckoutInput): Promise<CheckoutResult> {
  if (!input.orderId && !input.subscriptionId) throw new Error('Checkout needs an order or a subscription.');
  let result: any;
  try {
    result = await sdk().open({key: input.keyId,
      ...(input.orderId ? {order_id: input.orderId, amount: input.amountPaisa} : {subscription_id: input.subscriptionId}),
      currency: input.currency, name: input.name, description: input.description, image: CHECKOUT_LOGO_URL,
      // UPI + cards only: netbanking, wallets, EMI and pay-later add choice
      // overload and support load without meaningful conversion. One place —
      // every membership, dues and booking checkout inherits it.
      method: {upi: true, card: true, netbanking: false, wallet: false, emi: false, paylater: false},
      prefill: input.prefill ?? {}, theme: {color: '#111F35'}});
  } catch (error: any) {
    if (error instanceof GatewayUnavailableError) throw error;
    const code = String(error?.code ?? '');
    const description = String(error?.description ?? error?.message ?? '');
    if (code === '0' || /cancel/i.test(code) || /cancel/i.test(description)) throw new CheckoutCancelledError();
    throw error instanceof Error ? error : new Error(description || 'The payment could not be completed.');
  }
  if (input.orderId && (!result?.razorpay_payment_id || !result?.razorpay_order_id || !result?.razorpay_signature))
    throw new Error('The payment response was incomplete. Check the booking status before retrying.');
  if (input.subscriptionId && !result?.razorpay_subscription_id)
    throw new Error('The authorization response was incomplete. Check the membership status before retrying.');
  return {razorpayOrderId: result?.razorpay_order_id, razorpaySubscriptionId: result?.razorpay_subscription_id,
    razorpayPaymentId: result?.razorpay_payment_id, razorpaySignature: result?.razorpay_signature};
}
