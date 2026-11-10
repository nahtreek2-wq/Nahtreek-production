import RazorpayCheckout from 'react-native-razorpay';
import {IndiaLocale} from '@nahtreek/design-system';
import {ApiError, api} from './apiClient';

export type AiSubscriptionView = {
  status: string;
  effective: boolean;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  feePaisa: number;
  freeUsed: number;
  freeQuota: number;
};

export function isPaywallError(cause: unknown) {
  return cause instanceof ApiError && cause.status === 402;
}

// The first subscription charge lands seconds after the GPay success screen.
// The server says "still confirming" while it waits — the app polls instead
// of showing a dead-end error.
export function isConfirmingError(cause: unknown) {
  return cause instanceof Error && /still confirming/i.test(cause.message);
}

export function quotaLabel(view: AiSubscriptionView | null): string | null {
  if (!view || view.effective) return null;
  const left = Math.max(0, view.freeQuota - view.freeUsed);
  return left === 1 ? '1 free AI chat left' : `${left} free AI chats left`;
}

export type AiPlanView = {
  feePaisa: number;
  freeMessages: number;
  consultDiscountBps: number;
  consultDiscountCapPaisa: number;
  acceptWindowMs: number;
  arrivalGraceMs: number;
  lateAcceptPenaltyPaisa: number;
  lateArrivalPenaltyPaisa: number;
};

export function fetchAiSubscription() {
  return api.get<AiSubscriptionView>('/ai-billing/me');
}

export function fetchAiPlan() {
  return api.get<AiPlanView>('/ai-billing/plan');
}

export function cancelAiSubscription() {
  return api.post<AiSubscriptionView>('/ai-billing/cancel', {});
}

// Preview builds only: activates AI Pro without real payment. The server
// refuses this outside APP_ENV=preview, so production can never use it.
export function activateDemoAi() {
  return api.post<AiSubscriptionView>('/ai-billing/demo-activate', {});
}

// Runs the Razorpay subscription checkout, then confirms with our API so the
// row only flips ACTIVE after the provider says the mandate is real. When the
// server replays an already-effective subscription (no live checkout to run),
// checkout is skipped and the fresh status is returned instead.
export async function subscribeAi(): Promise<AiSubscriptionView> {
  const started = await api.post<{effective: boolean; keyId: string; subscriptionId: string | null; shortUrl: string | null}>('/ai-billing/subscribe', {});
  if ((started.effective && !started.shortUrl) || !started.subscriptionId) return fetchAiSubscription();
  const plan = await fetchAiPlan().catch(() => null);
  const price = plan ? `${IndiaLocale.formatCurrency(Math.round(plan.feePaisa / 100))}/month` : 'monthly plan';
  await RazorpayCheckout.open({
    key: started.keyId,
    subscription_id: started.subscriptionId,
    name: 'NAHTREEK AI',
    description: `Unlimited AI chats, plans, uploads + Plus booking perks — ${price}`,
    theme: {color: '#FACC15'},
  });
  return api.post<AiSubscriptionView>('/ai-billing/confirm', {});
}

export function confirmAiSubscription() {
  return api.post<AiSubscriptionView>('/ai-billing/confirm', {});
}
