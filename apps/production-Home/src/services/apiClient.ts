import {API_BASES} from './config';
import {useSessionStore} from '../stores/session';

export class ApiError extends Error {
  constructor(public status: number, message: string, public kind?: 'timeout' | 'network') { super(message); }
}

const HEADERS = {'Content-Type': 'application/json'};
let refreshPromise: Promise<boolean> | null = null;
const REFRESH_SKEW_MS = 5 * 60 * 1000;

function base64UrlToBytes(input: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  let bits = 0;
  let value = 0;
  let output = '';
  for (const char of normalized) {
    if (char === '=') {break;}
    const index = alphabet.indexOf(char);
    if (index < 0) {throw new Error('invalid token encoding');}
    value = (value << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output += String.fromCharCode((value >>> bits) & 0xff);
    }
  }
  return output;
}

export function getAccessTokenExpiry(token: string): number | null {
  try {
    const match = /"exp"\s*:\s*(\d+)/.exec(base64UrlToBytes(token.split('.')[1] ?? ''));
    return match ? Number(match[1]) * 1000 : null;
  } catch {
    return null;
  }
}

export async function ensureFreshSession(): Promise<boolean> {
  const session = useSessionStore.getState();
  if (!API_BASES.length || !session.accessToken || !session.refreshToken || !session.user) {
    return true;
  }
  const expiry = getAccessTokenExpiry(session.accessToken);
  if (expiry === null || expiry - Date.now() > REFRESH_SKEW_MS) {
    return true;
  }
  try {
    if (!refreshPromise) {refreshPromise = refresh().finally(() => {refreshPromise = null;});}
    return await refreshPromise;
  } catch {
    return Boolean(useSessionStore.getState().accessToken);
  }
}

function timeoutFor(url: string, options: RequestInit): number {
  if (url.includes('/ai/')) return 35_000;
  // Account creation validates an OTP, writes the account and issues a session.
  // Give that one atomic flow room for a cold serverless/database connection.
  if (/\/auth\/(register|professionals\/register|email-otp\/request|otp\/request|otp\/verify)$/.test(url)) return 45_000;
  if (/\/auth\/(login|professionals\/login|refresh)$/.test(url)) return 35_000;
  return options.method && options.method !== 'GET' ? 25_000 : 12_000;
}

function messageFor(status: number): string {
  if (status === 401) return 'Your sign-in has expired. Please sign in again.';
  if (status === 403) return 'This action is not available for your account.';
  if (status === 404) return 'This item is no longer available.';
  if (status === 409) return 'This action was already completed or the item has changed. Refresh and try again.';
  if (status === 429) return 'Please wait a moment before trying again.';
  if (status === 503 || status === 504) return 'The service is temporarily unavailable. Your sign-in is safe. Check your requests before repeating a booking.';
  if (status === 400 || status === 422) return 'Please check your details and try again.';
  return 'We could not complete this action right now. Please try again.';
}

async function timedFetch(url: string, options: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutFor(url, options));
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort);
  if (options.signal?.aborted) controller.abort();
  try {
    return await fetch(url, {...options, signal: controller.signal});
  } catch {
    const timedOut = controller.signal.aborted && !options.signal?.aborted;
    throw new ApiError(0, timedOut
      ? 'The connection took too long. Please try again.'
      : 'Could not connect. Check your internet connection and try again.',
    timedOut ? 'timeout' : 'network');
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}

async function refresh(): Promise<boolean> {
  const session = useSessionStore.getState();
  if (!session.refreshToken) return false;
  const response = await timedFetch(API_BASES[0] + '/auth/refresh', {
    method: 'POST', headers: HEADERS, body: JSON.stringify({refreshToken: session.refreshToken}),
  });
  if (useSessionStore.getState().sessionEpoch !== session.sessionEpoch) return false;
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) session.clearSession();
    throw new ApiError(response.status, messageFor(response.status));
  }
  const body = await response.json();
  if (useSessionStore.getState().sessionEpoch !== session.sessionEpoch) return false;
  if (!body?.accessToken || !body?.refreshToken || body.user?.id !== session.user?.id) {
    throw new ApiError(502, 'Could not restore your sign-in. Please try again.');
  }
  session.setSession(body);
  return true;
}

async function request<T>(path: string, options: RequestInit = {}, retried = false): Promise<T> {
  if (!API_BASES.length) throw new ApiError(0, 'Service is not connected yet. Please try again later.');
  const session = useSessionStore.getState();
  const response = await timedFetch(API_BASES[0] + path, {
    ...options,
    headers: {...HEADERS, ...(session.accessToken ? {Authorization: 'Bearer ' + session.accessToken} : {}), ...options.headers},
  });
  if (session.accessToken && useSessionStore.getState().user?.id !== session.user?.id) {
    throw new ApiError(401, 'Please sign in to continue.');
  }
  if (response.status === 401 && session.accessToken && !path.startsWith('/auth/')) {
    if (!retried) {
      if (useSessionStore.getState().accessToken !== session.accessToken) return request<T>(path, options, true);
      if (!refreshPromise) refreshPromise = refresh().finally(() => { refreshPromise = null; });
      if (await refreshPromise) return request<T>(path, options, true);
    } else {
      useSessionStore.getState().clearSession();
    }
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const detail = Array.isArray(body?.message) ? body.message.join('\n') : body?.message;
    // Expose only known, user-safe routing guidance from the service workflow;
    // continue masking arbitrary server errors (including other 503 responses).
    const safeRoutingDetails = [
      'Arrival estimates are unavailable. Please schedule a visit.',
      'Could not estimate the journey. Try again or schedule a visit.',
    ];
    const safeBillingDetails = [
      'Demo mode: AI billing activates once Razorpay test keys and the AI plan ID are added',
    ];
    const safeDetail =
      ([400, 401, 402, 409, 422].includes(response.status) &&
        typeof detail === 'string' && detail.length <= 500) ||
      (response.status === 503 &&
        typeof detail === 'string' &&
        (safeRoutingDetails.includes(detail) || safeBillingDetails.includes(detail)));
    throw new ApiError(response.status, safeDetail ? detail : messageFor(response.status));
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, {signal}),
  post: <T>(path: string, payload?: unknown) => request<T>(path, {method: 'POST', body: JSON.stringify(payload ?? {})}),
  patch: <T>(path: string, payload?: unknown) => request<T>(path, {method: 'PATCH', body: JSON.stringify(payload ?? {})}),
  delete: <T>(path: string, payload?: unknown) => request<T>(path, payload === undefined ? {method: 'DELETE'} : {method: 'DELETE', body: JSON.stringify(payload)}),
};
